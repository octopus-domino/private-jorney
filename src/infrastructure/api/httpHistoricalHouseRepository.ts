// src/infrastructure/api/httpHistoricalHouseRepository.ts
import type {
  BuildingSearchParams,
  HistoricalHouseRepository,
} from '../../application/ports/HistoricalHouseRepository';
import type { HistoricalHouseDto } from '../../domain/HistoricalHouse';
import { QueryCache } from '../../shared/queryCache';
import { config } from '../config';
import { codocFetch, type CodocFetch } from './codocHttp';

/**
 * Здания меняются редко — держим 24 часа.
 * Persist в localStorage: при перезапуске приложения точки старта
 * с историческими домами показываются мгновенно, без сети.
 */
const CACHE = new QueryCache<HistoricalHouseDto[]>({
  name: 'buildings',
  ttlMs: 24 * 60 * 60 * 1000,
  maxEntries: 10, // ~1 MB при полных 200 домах на запись
  persist: true,
  storageKey: 'private-walks/cache/buildings/v1',
});

/** Округляем координаты до ~11 м (4 знака). Джиттер GPS ≤ 10 м даёт cache hit. */
function quantizeLatLng(lat: number, lng: number, precision = 4): string {
  const p = 10 ** precision;
  return `${Math.round(lat * p) / p},${Math.round(lng * p) / p}`;
}

/**
 * Bucket радиуса. Запрос с любым radiusKm ≤ bucket вернёт данные для bucket,
 * клиент отфильтрует по настоящему радиусу (withinRadius в usePoisQuery).
 * Даёт cache hit при мелких изменениях ползунка (800→900→1000).
 */
function bucketRadiusKm(radiusKm: number): number {
  const buckets = [0.5, 1, 2, 3, 5, 8, 10];
  for (const b of buckets) if (radiusKm <= b) return b;
  return 10;
}

function joinUrl(base: string, path: string): string {
  return base ? `${base.replace(/\/+$/, '')}${path}` : path;
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.codocAuthToken) headers.Authorization = `Bearer ${config.codocAuthToken}`;
  return headers;
}

/** Соответствует проверке в BuildingHistoryService.nearby (после правки бэка). */
const MAX_LIMIT = 500;
const MAX_RADIUS_KM = 10;

export class HttpHistoricalHouseRepository implements HistoricalHouseRepository {
  constructor(private readonly baseUrl: string = config.codocApiUrl, private readonly http: CodocFetch = codocFetch) {}

  async nearby(params: BuildingSearchParams): Promise<HistoricalHouseDto[]> {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), MAX_LIMIT);
    const bucket = bucketRadiusKm(
      Math.min(Math.max(params.radiusKm ?? 1.5, 0.1), MAX_RADIUS_KM),
    );
    const beforeYear = params.beforeYear ?? 0;
    const q = params.q?.slice(0, 100) ?? '';

    const key = [
      quantizeLatLng(params.lon, params.lat),
      String(bucket),
      String(limit),
      String(beforeYear),
      q,
    ].join('|');

    return CACHE.getAbortable(key, async signal => {
      const query = new URLSearchParams({
        lon: String(params.lon),
        lat: String(params.lat),
        limit: String(limit),
        radiusKm: String(bucket),
        beforeYear: String(beforeYear),
      });
      if (q) query.set('q', q);

      const url = joinUrl(
        this.baseUrl,
        `/api/journeys/buildings/nearby?${query}`,
      );
      const response = await this.http(url, {
        signal,
        headers: authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`buildings/nearby: ${response.status}`);
      }
      return (await response.json()) as HistoricalHouseDto[];
    }, params.signal);
  }

  async byPoint(
    lon: number,
    lat: number,
    signal?: AbortSignal,
  ): Promise<HistoricalHouseDto | null> {
    const query = new URLSearchParams({ lon: String(lon), lat: String(lat) });
    const url = joinUrl(this.baseUrl, `/api/journeys/buildings?${query}`);
    const response = await this.http(url, { signal, headers: authHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`buildings: ${response.status}`);
    return (await response.json()) as HistoricalHouseDto;
  }
}
