import { z } from 'zod';
import type { TrackPoint } from '../../domain/RecordedWalk';
import type { RoadWay } from '../../domain/walkGraph';
import { thinTrack } from '../../domain/pathGeometry';
import { QueryCache } from '../../shared/queryCache';
import { readExternalPage } from '../api/readExternalPage';

const roadSchema = z.object({ id: z.number(), nodes: z.array(z.number()),
  geometry: z.array(z.object({ lat: z.number(), lon: z.number() })), tags: z.record(z.string()).optional() });
const MAX_BATCH_POINTS = 50;

/** Fetches a bounded walking corridor after stop; GPS callbacks never trigger a network request. */
export class TrackCorridorRepository {
  private readonly cache = new QueryCache<RoadWay[]>({ ttlMs: 86400000, maxEntries: 8,
    persist: true, storageKey: 'private-walks/cache/road-corridors/v1' });

  constructor(private readonly read = readExternalPage) {}

  /** Sequential batches respect the public source and keep memory and URL size bounded. */
  async roads(points: TrackPoint[], signal?: AbortSignal): Promise<RoadWay[]> {
    const sampled = thinTrack(points, 25, 200);
    const ways: RoadWay[] = [];
    for (let start = 0; start < sampled.length - 1; start += MAX_BATCH_POINTS - 1)
      ways.push(...await this.batch(sampled.slice(start, start + MAX_BATCH_POINTS), signal));
    return [...new Map(ways.map(way => [way.id, way])).values()];
  }

  private batch(points: TrackPoint[], signal?: AbortSignal): Promise<RoadWay[]> {
    const coordinates = points.map(point => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(',');
    return this.cache.getAbortable(coordinates, async abort => {
      const url = new URL('https://overpass-api.de/api/interpreter');
      url.searchParams.set('data', `[out:json][timeout:20];way[highway][highway!~"^(motorway|motorway_link|trunk|trunk_link|construction|proposed)$"](around:90,${coordinates});out geom 500;`);
      const payload: unknown = JSON.parse(await this.read(url.href, abort));
      const parsed = z.object({ elements: z.array(z.unknown()), remark: z.string().optional() }).parse(payload);
      if (parsed.remark) throw new Error(parsed.remark);
      return parsed.elements.flatMap(item => {
        const row = roadSchema.safeParse(item);
        return row.success ? [{ ...row.data, geometry: row.data.geometry.map(point => ({ lat: point.lat, lng: point.lon })) }] : [];
      });
    }, signal);
  }
}
