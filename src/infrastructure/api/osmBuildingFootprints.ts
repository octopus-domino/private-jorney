import { z } from 'zod';
import { resolveBuildingFootprint, type BuildingFootprint, type FootprintPoint, type FootprintMatch } from '../../domain/BuildingFootprint';
import { PersistentSuccessCache } from '../../shared/persistentSuccessCache';
import { SharedRequestPool } from '../../shared/sharedRequestPool';
import { withRequestDeadline } from '../../shared/withRequestDeadline';
import { parseOsmBuildingFootprints } from './parseOsmBuildingFootprints';
import { readExternalPage } from './readExternalPage';

const AREA_LATITUDE = 0.002, AREA_LONGITUDE = 0.004, MARGIN = 0.0003;
const DAY_MS = 86400000, REQUEST_TIMEOUT_MS = 10000;
const pointSchema = z.object({ lat: z.number().finite(), lng: z.number().finite() });
const footprintsSchema = z.array(z.object({ id: z.string(), address: z.string(),
  facts: z.object({ year: z.string().optional(), levels: z.string().optional(), material: z.string().optional(),
    height: z.string().optional() }).optional(), polygons: z.array(z.array(z.array(pointSchema).min(4)).min(1)).min(1) }));

/** Cache-Aside: a small interactive map area is read once; only building addresses and outlines are retained. */
export class OsmBuildingFootprints {
  private readonly requests = new SharedRequestPool<BuildingFootprint[]>();
  private readonly cache = new PersistentSuccessCache<BuildingFootprint[]>('private-walks/cache/building-footprints/v2', DAY_MS,
    raw => { const parsed = footprintsSchema.safeParse(raw); return parsed.success ? parsed.data : undefined; }, undefined, undefined, 12);

  constructor(private readonly read = readExternalPage) {}

  /** A cached long outline remains usable at its far end, even outside the original request rectangle. */
  async lookup(point: FootprintPoint, signal?: AbortSignal): Promise<FootprintMatch> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const known = resolveBuildingFootprint(point, this.cache.values().flat());
    if (known.building || known.excluded) return known;
    const lat = Math.floor(point.lat / AREA_LATITUDE) * AREA_LATITUDE;
    const lng = Math.floor(point.lng / AREA_LONGITUDE) * AREA_LONGITUDE;
    const key = `${lat}:${lng}`, cached = this.cache.get(key);
    const buildings = cached ?? await this.requests.run(key, shared => this.load(lat, lng, key, shared), signal);
    return resolveBuildingFootprint(point, buildings);
  }

  private async load(lat: number, lng: number, key: string, signal: AbortSignal): Promise<BuildingFootprint[]> {
    const url = new URL('https://api.openstreetmap.org/api/0.6/map');
    url.searchParams.set('bbox', [lng - MARGIN, lat - MARGIN, lng + AREA_LONGITUDE + MARGIN, lat + AREA_LATITUDE + MARGIN].join(','));
    const body = await withRequestDeadline(bounded => this.read(url.href, bounded), REQUEST_TIMEOUT_MS, signal);
    const buildings = parseOsmBuildingFootprints(body);
    this.cache.set(key, buildings);
    return buildings;
  }
}
