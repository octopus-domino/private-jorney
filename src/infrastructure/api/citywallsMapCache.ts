import type { CitywallsPoint } from './citywallsMap';
import type { SuccessCache } from '../../shared/persistentSuccessCache';
import { PersistentSuccessCache } from '../../shared/persistentSuccessCache';

type PointRow = [number, number, number, string];
const MAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function decodeRows(raw: unknown): PointRow[] | undefined {
  if (!Array.isArray(raw) || raw.length > 100000) return undefined;
  const valid = raw.every(row => Array.isArray(row) && row.length === 4
    && Number.isInteger(row[0]) && row[0] > 0 && Number.isFinite(row[1]) && Math.abs(row[1]) <= 90
    && Number.isFinite(row[2]) && Math.abs(row[2]) <= 180 && typeof row[3] === 'string');
  return valid ? raw as PointRow[] : undefined;
}

/** Cache-Aside: compact map indexes avoid repeating multi-megabyte downloads on mobile connections. */
export class CitywallsMapCache implements SuccessCache<CitywallsPoint[]> {
  constructor(private readonly rows: SuccessCache<PointRow[]> = new PersistentSuccessCache(
    'private-walks/cache/citywalls-map/v1', MAP_TTL_MS, decodeRows,
    () => globalThis.localStorage, Date.now, 2,
  )) {}

  get(key: string): CitywallsPoint[] | undefined {
    return this.rows.get(key)?.map(([id, lat, lng, title]) => ({ id, lat, lng, title }));
  }

  set(key: string, points: CitywallsPoint[]): void {
    this.rows.set(key, points.map(point => [point.id, point.lat, point.lng, point.title]));
  }
}
