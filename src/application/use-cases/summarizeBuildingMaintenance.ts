import type { BuildingMaintenance, BuildingMaintenanceWork } from '../../domain/BuildingMaintenance';
import type { BuildingFact } from './summarizeBuildingProfile';

const GROUPS = [
  ['Крыша', /крыш|кровл/i], ['Вода и канализация', /водоснабжен|канализац|водоотведен/i],
  ['Отопление', /отоплен|теплоснабжен/i], ['Электрика', /электроснабжен|электрооборуд/i],
  ['Фасад', /фасад/i], ['Фундамент', /фундамент/i], ['Лестницы', /лестниц/i],
  ['Лифтовое оборудование', /лифт/i], ['Газоснабжение', /газоснабжен|газопровод/i],
] as const;
const dateLabel = (iso: string) => iso.split('-').reverse().join('.');

function statusLabel(work: BuildingMaintenanceWork): string {
  if (work.status === 'completed') return `Ремонт завершён${work.actualEnd ? ` в ${work.actualEnd.slice(0, 4)} году` : work.year ? ` в ${work.year} году` : ''}`;
  if (work.status === 'in-progress') return 'В источнике работы отмечены как выполняемые';
  if (work.status === 'planned') return work.plannedEnd && work.plannedEnd < new Date().toISOString().slice(0, 10)
    ? 'Плановый срок прошёл; выполнение не подтверждено' : 'Ремонт запланирован';
  return work.status === 'cancelled' ? 'Работы отменены' : 'Есть запись о работах; выполнение не подтверждено';
}

function workDetail(work: BuildingMaintenanceWork): string {
  return [`${work.name}: ${statusLabel(work)}.`,
    work.actualStart ? `Фактическое начало: ${dateLabel(work.actualStart)}.` : '',
    work.actualEnd ? `Фактическое завершение: ${dateLabel(work.actualEnd)}.` : '',
    work.plannedStart ? `Плановое начало: ${dateLabel(work.plannedStart)}.` : '',
    work.plannedEnd ? `Плановое завершение: ${dateLabel(work.plannedEnd)}.` : '',
  ].filter(Boolean).join(' ');
}

function representative(works: BuildingMaintenanceWork[]): BuildingMaintenanceWork {
  return works.find(work => work.status === 'in-progress') ?? works.find(work => work.status === 'planned')
    ?? [...works].sort((a, b) => (b.actualEnd ?? String(b.year ?? '')).localeCompare(a.actualEnd ?? String(a.year ?? '')))[0];
}

/** Uses published work status, never estimates condition or a repair interval from age alone. */
export function summarizeBuildingMaintenance(maintenance: BuildingMaintenance): BuildingFact[] {
  const works = maintenance.works.filter(work => work.name && work.status !== 'cancelled');
  if (!works.length) return [];
  const facts: BuildingFact[] = GROUPS.flatMap(([label, pattern]) => {
    const matching = works.filter(work => pattern.test(work.name));
    return matching.length ? [{ label, value: statusLabel(representative(matching)),
      detail: `${matching.map(workDetail).join(' ')} Ремонт не подтверждает полную замену элемента или его нынешнее состояние.` }] : [];
  });
  facts.push({ label: 'Капремонт', value: works.some(work => work.status === 'in-progress') ? 'Есть выполняемые работы'
    : works.some(work => work.status === 'planned') ? 'Есть запланированные работы'
    : works.some(work => work.status === 'completed') ? 'Есть завершённые работы по дому' : 'Выполнение работ не подтверждено',
  detail: `${works.map(workDetail).join(' ')} Это сведения об отдельных работах, а не подтверждение полного капремонта. Без показателей износа оценить необходимость нового ремонта нельзя.` });
  return facts;
}
