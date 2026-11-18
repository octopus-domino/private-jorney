import { z } from 'zod';
import type { BuildingMaintenance, BuildingMaintenanceWork } from '../../domain/BuildingMaintenance';
import { PersistentSuccessCache } from '../../shared/persistentSuccessCache';
import { QueryCache } from '../../shared/queryCache';
import { SharedRequestPool } from '../../shared/sharedRequestPool';
import type { MoscowDataClient } from './moscowDataClient';

type Client = Pick<MoscowDataClient, 'get'>;
interface RepairIndex { version: number; release: number; houses: Record<string, number[][]> }
const PAGE_SIZE = 250;
const DAY_MS = 86400000;
export const MOSCOW_REPAIR_SOURCE = 'https://data.mos.ru/opendata/62963';
export const maintenanceWorkSchema = z.object({
  name: z.string().min(1), status: z.enum(['completed', 'in-progress', 'planned', 'cancelled', 'unknown']),
  plannedStart: z.string().optional(), plannedEnd: z.string().optional(),
  actualStart: z.string().optional(), actualEnd: z.string().optional(), year: z.number().int().optional(),
});
export const maintenanceSchema = z.object({ works: z.array(maintenanceWorkSchema), sourceUrl: z.string().url(),
  sourceName: z.string(), fetchedAt: z.string().datetime() });
const repairCells = z.object({ ObjectAddress: z.array(z.object({ UNOM: z.union([z.number(), z.string()]), is_deleted: z.number().optional() })),
  WorkName: z.string().nullable().optional(), WorkEssence: z.string().nullable().optional(), WorkStatus: z.string().nullable().optional(),
  YearOfWork: z.number().nullable().optional(), StartDate: z.string().nullable().optional(), EndDate: z.string().nullable().optional(),
  StartDateActual: z.string().nullable().optional(), EndDateActual: z.string().nullable().optional() });
const rowsSchema = z.array(z.object({ global_id: z.number(), Cells: repairCells }));
type Row = z.infer<typeof rowsSchema>[number];

/** Returns an ISO calendar date only after checking the original day, month and year. */
function calendarDate(raw?: string | null): string | undefined {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw ?? '');
  if (!match) return undefined;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number(year) >= 1800 && date.getUTCDate() === Number(day) && date.getUTCMonth() + 1 === Number(month)
    ? `${year}-${month}-${day}` : undefined;
}

function workStatus(raw: string): BuildingMaintenanceWork['status'] {
  if (/отмен|расторг/i.test(raw)) return 'cancelled';
  if (/^(завершена|завершено|завершены|выполнена|выполнено|выполнены)$/i.test(raw.trim())) return 'completed';
  if (/в работе|выполня|в процессе|ведутся|начата/i.test(raw)) return 'in-progress';
  return /план|не начат/i.test(raw) ? 'planned' : 'unknown';
}

function toWork(row: Row): BuildingMaintenanceWork | null {
  const cells = row.Cells, name = (cells.WorkName || cells.WorkEssence || '').trim();
  if (!name || /^(0|-|нет)$/i.test(name)) return null;
  return { name, status: workStatus(cells.WorkStatus ?? ''), plannedStart: calendarDate(cells.StartDate),
    plannedEnd: calendarDate(cells.EndDate), actualStart: calendarDate(cells.StartDateActual),
    actualEnd: calendarDate(cells.EndDateActual), year: cells.YearOfWork && cells.YearOfWork >= 1800 ? cells.YearOfWork : undefined };
}

/** Adapter + Cache-Aside: reads only indexed pages, validates UNOM and never caches contracts or personal data. */
export class MoscowMaintenanceRepository {
  private readonly requests = new SharedRequestPool<BuildingMaintenance>();
  private readonly pages = new QueryCache<Row[]>({ ttlMs: DAY_MS, maxEntries: 8 });
  private readonly cache = new PersistentSuccessCache<BuildingMaintenance>('private-walks/cache/moscow-maintenance/v1', DAY_MS,
    raw => { const parsed = maintenanceSchema.safeParse(raw); return parsed.success ? parsed.data : undefined; });

  constructor(private readonly client: Client,
    private readonly loadIndex: () => Promise<RepairIndex> = async () => (await import('../data/moscowRepairIndex.json')).default) {}

  /** Missing index entries mean no record in this snapshot, never that a house has had no repairs. */
  async lookup(unom: number, signal?: AbortSignal): Promise<BuildingMaintenance> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cached = this.cache.get(String(unom));
    if (cached) return cached;
    return this.requests.run(String(unom), shared => this.load(unom, shared), signal);
  }

  private async load(unom: number, signal: AbortSignal): Promise<BuildingMaintenance> {
    const index = await this.loadIndex(), references = index.houses[String(unom)] ?? [];
    const offsets = [...new Set(references.map(([position]) => Math.floor(position / PAGE_SIZE) * PAGE_SIZE))];
    const rows: Row[] = [];
    for (const offset of offsets) rows.push(...await this.page(offset, index, signal));
    const byId = new Map(rows.map(row => [row.global_id, row]));
    const works = this.verifiedWorks(references, byId, unom);
    const result = { works, sourceUrl: MOSCOW_REPAIR_SOURCE, sourceName: 'Работы по капремонту · Открытые данные Москвы', fetchedAt: new Date().toISOString() };
    this.cache.set(String(unom), result);
    return result;
  }

  private page(offset: number, index: RepairIndex, signal: AbortSignal): Promise<Row[]> {
    return this.pages.getAbortable(`${index.version}:${index.release}:${offset}`, async shared => rowsSchema.parse(
      await this.client.get(62963, 'rows', { '$skip': String(offset), '$top': String(PAGE_SIZE),
        versionNumber: String(index.version), releaseNumber: String(index.release) }, shared)), signal);
  }

  private verifiedWorks(references: number[][], rows: Map<number, Row>, unom: number): BuildingMaintenanceWork[] {
    try {
      return references.flatMap(([, id]) => this.matchedWork(rows.get(id), unom));
    } catch (error) {
      this.pages.clear();
      throw error;
    }
  }

  private matchedWork(row: Row | undefined, unom: number): BuildingMaintenanceWork[] {
    if (!row || !row.Cells.ObjectAddress.some(address => Number(address.UNOM) === unom && address.is_deleted !== 1)) {
      throw new Error('Не удалось подтвердить принадлежность работ выбранному дому.');
    }
    const work = toWork(row);
    return work ? [work] : [];
  }
}
