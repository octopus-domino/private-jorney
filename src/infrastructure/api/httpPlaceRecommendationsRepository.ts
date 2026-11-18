// src/infrastructure/api/httpPlaceRecommendationsRepository.ts
import type {
  PlaceRepository,
  PlaceResultDto,
  PlaceSearchParams,
} from '../../application/ports/PlaceRepository';
import { QueryCache } from '../../shared/queryCache';
import { config } from '../config';
import { codocFetch, type CodocFetch } from './codocHttp';

/** Area results are cached independently of legacy limited route recommendations. */
const THEMED_CACHE = new QueryCache<PlaceResultDto>({
  name: 'themed',
  ttlMs: 60 * 60 * 1000,
  maxEntries: 50,
  persist: true,
  storageKey: 'private-walks/cache/themed/v2',
});

/** Обычные attractions: 1 час. */
const ATTRACTIONS_CACHE = new QueryCache<PlaceResultDto>({
  name: 'attractions',
  ttlMs: 60 * 60 * 1000,
  maxEntries: 50,
  persist: true,
  storageKey: 'private-walks/cache/attractions/v1',
});

/** Список тем — in-memory, на всю сессию. */
let themesCache: string[] | null = null;

function quantizeLatLng(lat: number, lng: number, precision = 4): string {
  const p = 10 ** precision;
  return `${Math.round(lat * p) / p},${Math.round(lng * p) / p}`;
}

function joinUrl(base: string, path: string): string {
  return base ? `${base.replace(/\/+$/, '')}${path}` : path;
}

export class HttpPlaceRecommendationsRepository implements PlaceRepository {
  constructor(private readonly baseUrl: string = config.codocApiUrl, private readonly http: CodocFetch = codocFetch) {}

  async search(params: PlaceSearchParams): Promise<PlaceResultDto> {
    return params.theme || params.themes?.length
      ? this.searchThemed(params)
      : this.searchAttractions(params);
  }

  private async searchThemed(
    params: PlaceSearchParams,
  ): Promise<PlaceResultDto> {
    const themes = [...new Set(params.themes ?? [])].sort();
    const theme = params.theme ?? '';
    const key = [
        themes.length ? 'area' : 'recommendation',
      quantizeLatLng(params.lon, params.lat),
      themes.join(',') || theme,
      themes.length ? String(params.radiusKm ?? 1.5) : String(params.maxStops ?? ''),
      params.language,
      params.visitTime ?? '',
      params.maxSitelinks != null ? String(params.maxSitelinks) : '',
    ].join('|');

    return THEMED_CACHE.getAbortable(key, async signal => {
      const query = new URLSearchParams({
        longitude: String(params.lon),
        latitude: String(params.lat),
        language: params.language,
      });
      if (themes.length) {
        query.set('themes', themes.join(','));
        query.set('radiusKm', String(params.radiusKm ?? 1.5));
      } else {
        query.set('theme', theme);
        if (params.maxStops !== undefined) query.set('maxStops', String(params.maxStops));
      }
      if (params.visitTime) query.set('visitTime', params.visitTime);
      if (params.maxSitelinks != null) {
        query.set('maxSitelinks', String(params.maxSitelinks));
      }
      const url = joinUrl(
        this.baseUrl,
        `/api/journeys/routes/places/themed?${query}`,
      );
      return this.fetchPlaceResult(url, signal);
    }, params.signal);
  }

  private async searchAttractions(
    params: PlaceSearchParams,
  ): Promise<PlaceResultDto> {
    const kind = params.kind ?? 'attractions';
    const key = [quantizeLatLng(params.lon, params.lat), kind, params.language].join('|');

    return ATTRACTIONS_CACHE.getAbortable(key, async signal => {
      const query = new URLSearchParams({
        longitude: String(params.lon),
        latitude: String(params.lat),
        kind,
        language: params.language,
      });
      const url = joinUrl(
        this.baseUrl,
        `/api/journeys/routes/places?${query}`,
      );
      return this.fetchPlaceResult(url, signal);
    }, params.signal);
  }

  private async fetchPlaceResult(
    url: string,
    signal?: AbortSignal,
  ): Promise<PlaceResultDto> {
    const response = await this.http(url, {
      signal,
      headers: config.codocAuthToken
        ? { Accept: 'application/json', Authorization: `Bearer ${config.codocAuthToken}` }
        : { Accept: 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let body: { error?: unknown } | null = null;
      try {
        body = JSON.parse(text) as { error?: unknown };
      } catch {
        /* не JSON */
      }
      const code =
        body && typeof body === 'object' && 'error' in body
          ? String(body.error)
          : text || `places: ${response.status}`;
      console.error('[places] failed', {
        url,
        status: response.status,
        responseBody: text,
      });
      throw new Error(`${response.status} ${code}`);
    }

    const data = (await response.json()) as PlaceResultDto;
    if (!data.available) throw new Error('places unavailable');
    return data;
  }

  async themes(signal?: AbortSignal): Promise<string[]> {
    if (themesCache) return themesCache;
    const url = joinUrl(this.baseUrl, '/api/journeys/routes/places/themes');
    const response = await this.http(url, {
      signal,
      headers: config.codocAuthToken
        ? { Accept: 'application/json', Authorization: `Bearer ${config.codocAuthToken}` }
        : { Accept: 'application/json' },
    });
    if (!response.ok) return [];
    themesCache = (await response.json()) as string[];
    return themesCache;
  }
}
