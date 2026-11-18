import { z } from 'zod';
import type { PlaceHistory, PlaceHistoryRepository } from '../../application/ports/PlaceHistoryRepository';
import type { Poi } from '../../domain/Poi';
import { PersistentSuccessCache } from '../../shared/persistentSuccessCache';
import { haversineMeters } from '../../shared/geo';
import { matchHouseAddress } from '../../shared/address';
import { readExternalPage } from './readExternalPage';
import type { SuccessCache } from '../../shared/persistentSuccessCache';

const SITE = 'https://um.mos.ru';
const DAY_MS = 24 * 60 * 60 * 1000;
const pointSchema = z.object({ id: z.number().int().positive(), slug: z.string().regex(/^[a-zA-Z\d_-]+$/),
  name: z.string(), coordinates: z.tuple([z.number().finite(), z.number().finite()]), entitySlug: z.literal('houses') });
type MoscowPoint = z.infer<typeof pointSchema>;
const historySchema = z.object({ sourceName: z.literal('Узнай Москву'), title: z.string(), excerpt: z.string().min(30),
  sourceUrl: z.string().regex(/^https:\/\/um\.mos\.ru\/houses\/[\w-]+\/$/),
  imageUrl: z.string().regex(/^https:\/\/um\.mos\.ru\/content\//).optional() });
const houseSchema = z.object({ data: z.object({ slug: z.string(), name: z.string(), address: z.string(),
  coordinates: z.tuple([z.number(), z.number()]), mainImage: z.string().nullable(),
  textBlocks: z.array(z.object({ textText: z.string().nullable().optional() })), announce: z.string().nullable() }) });

function createIndexCache(): SuccessCache<MoscowPoint[]> {
  return new PersistentSuccessCache<MoscowPoint[]>('private-walks/cache/moscow-map/v1', DAY_MS,
    raw => { const result = z.array(pointSchema).safeParse(raw); return result.success ? result.data : undefined; });
}

function createHistoryCache(): SuccessCache<PlaceHistory> {
  return new PersistentSuccessCache<PlaceHistory>('private-walks/cache/moscow-history/v1', 7 * DAY_MS,
    raw => { const result = historySchema.safeParse(raw); return result.success ? result.data : undefined; });
}

function readHouseData(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const raw = JSON.parse(doc.querySelector('#__NEXT_DATA__')?.textContent ?? '{}');
  const queries: unknown = raw?.props?.pageProps?.initialState?.mainService?.queries;
  if (!queries || typeof queries !== 'object') throw new Error('Moscow building data unavailable');
  const entry = Object.entries(queries).find(([name]) => name.startsWith('getItem('));
  return houseSchema.parse(entry?.[1]).data;
}

/** Adapter: reads the public map index and server-rendered JSON without executing remote scripts. */
export class MoscowHistoryRepository implements PlaceHistoryRepository {

  /** Injects the same cancellable transport used by the Petersburg sources. */
  constructor(private readonly read = readExternalPage,
    private readonly cache: SuccessCache<PlaceHistory> = createHistoryCache(),
    private readonly index: SuccessCache<MoscowPoint[]> = createIndexCache()) {}

  /** Limits this strategy to the Moscow area; matching still requires a nearby catalogue building. */
  supports(poi: Poi): boolean { return poi.lat > 55.1 && poi.lat < 56.15 && poi.lng > 36.6 && poi.lng < 38.4; }

  /** Metadata/title changes cannot cancel an ongoing request for the same location. */
  requestKey(poi: Poi): string { return `${poi.lat}:${poi.lng}`; }

  /** Matches coordinates and, when supplied, the street/house address before exposing history. */
  async lookup(poi: Poi, signal?: AbortSignal): Promise<PlaceHistory | null> {
    if (!this.supports(poi)) return null;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const key = this.requestKey(poi);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const nearby = (await this.points(signal)).map(point => ({ point,
      distance: haversineMeters(poi, { lat: point.coordinates[0], lng: point.coordinates[1] }) }))
      .filter(item => item.distance <= 100).sort((a, b) => a.distance - b.distance).slice(0, 3);
    for (const candidate of nearby) {
      const history = await this.loadMatched(poi, candidate.point, candidate.distance, nearby, signal);
      if (history) { this.cache.set(key, history); return history; }
    }
    return null;
  }

  private async points(signal?: AbortSignal): Promise<MoscowPoint[]> {
    const cached = this.index.get('houses');
    if (cached) return cached;
    const raw: unknown = JSON.parse(await this.read(`${SITE}/api/v2/points?filter%5Btype%5D=house`, signal));
    if (!Array.isArray(raw)) throw new Error('Moscow map format changed');
    const points = raw.flatMap(item => { const result = pointSchema.safeParse(item); return result.success ? [result.data] : []; });
    if (!points.length) throw new Error('Moscow map returned no building coordinates');
    const unique = [...new Map(points.map(point => [point.id, point])).values()];
    this.index.set('houses', unique);
    return unique;
  }

  private async loadMatched(poi: Poi, point: MoscowPoint, distance: number,
    nearby: { point: MoscowPoint; distance: number }[], signal?: AbortSignal): Promise<PlaceHistory | null> {
    const sourceUrl = `${SITE}/houses/${point.slug}/`;
    const data = readHouseData(await this.read(sourceUrl, signal));
    if (data.slug !== point.slug || haversineMeters(poi, { lat: data.coordinates[0], lng: data.coordinates[1] }) > 100) return null;
    const address = poi.details?.address;
    const ambiguous = nearby.some(item => item.point.id !== point.id && Math.abs(item.distance - distance) < 15);
    if (address ? !matchHouseAddress(address, data.address, distance) : distance > 35 || ambiguous) return null;
    return this.history(data, sourceUrl);
  }

  private history(data: { name: string; mainImage: string | null; announce: string | null; textBlocks: { textText?: string | null }[] }, sourceUrl: string): PlaceHistory | null {
    const doc = new DOMParser().parseFromString(data.textBlocks.map(block => block.textText ?? '').join('') || data.announce || '', 'text/html');
    const excerpt = [...doc.querySelectorAll('p')].map(p => p.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(text => text.length >= 60).slice(0, 2).join('\n\n');
    if (excerpt.length < 30) return null;
    const image = data.mainImage ? new URL(data.mainImage, SITE) : null;
    const imageUrl = image?.origin === SITE && image.pathname.startsWith('/content/') ? image.href : undefined;
    return { title: data.name, excerpt, sourceUrl, imageUrl, sourceName: 'Узнай Москву' };
  }
}
