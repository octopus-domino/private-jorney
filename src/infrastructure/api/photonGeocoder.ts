// src/infrastructure/api/photonGeocoder.ts
import type { GeocodeHit, Geocoder } from '../../application/ports/Geocoder';
import { config } from '../config';
import { publishedSourceUrl } from './publishedSourceUrl';
import { QueryCache } from '../../shared/queryCache';
import { russianAddress, russianCountry } from '../../shared/russianAddress';
import { withRequestDeadline } from '../../shared/withRequestDeadline';

const REVERSE_TIMEOUT_MS = 10000;

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
}

/**
 * Photon (komoot):
 *   search:  https://photon.komoot.io/api/?q=...
 *   reverse: https://photon.komoot.io/reverse?lat=…
 *
 * Публичный инстанс поддерживает только lang=en|de|fr|it — lang=ru даёт 400,
 * поэтому параметр lang НЕ передаём. Без lang Photon вернёт локальное название.
 */
export class PhotonGeocoder implements Geocoder {
  private readonly reverseCache = new QueryCache<{ label: string; city?: string }>({ ttlMs: 5 * 60 * 1000, maxEntries: 100 });
  private readonly searchBase: string;
  private readonly reverseBase: string;

  constructor(baseUrl: string = config.photonUrl) {
    const normalized = baseUrl.replace(/\/+$/, '');
    this.searchBase = `${normalized}/`;
    this.reverseBase = `${normalized.replace(/\/api$/, '')}/reverse`;
  }

  async search(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];

    const url = new URL(this.searchBase);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('limit', '5');

    const response = await fetch(publishedSourceUrl(url.toString()), {
      signal,
      headers: { Accept: 'application/json', 'Accept-Language': 'ru-RU,ru;q=0.9' },
    });
    if (!response.ok) {
      if (response.status === 400) return [];
      throw new Error(`Photon: ${response.status}`);
    }

    const data = (await response.json()) as { features?: PhotonFeature[] };
    return (data.features ?? []).flatMap((f) => {
      const [lon, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
      const candidates = [
        f.properties.name,
        [f.properties.street, f.properties.housenumber].filter(Boolean).join(' '),
        f.properties.city,
        f.properties.state,
        russianCountry(f.properties.country, f.properties.countrycode),
      ];
      const parts: string[] = [];
      for (const c of candidates) {
        const v = (c ?? '').trim();
        if (v.length > 0) parts.push(v);
      }
      if (parts.length === 0) return [];
      return [{ lat, lng: lon, label: russianAddress(parts.join(', ')) }];
    });
  }

  async reverse(lat: number, lng: number, signal?: AbortSignal): Promise<{ label: string; city?: string }> {
    return this.reverseCache.getAbortable(`${lat}:${lng}`,
      shared => withRequestDeadline(bounded => this.fetchReverse(lat, lng, bounded), REVERSE_TIMEOUT_MS, shared), signal);
  }

  private async fetchReverse(lat: number, lng: number, signal: AbortSignal): Promise<{ label: string; city?: string }> {
    const url = new URL(this.reverseBase);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    const response = await fetch(publishedSourceUrl(url.toString()), { signal, headers: { 'Accept-Language': 'ru-RU,ru;q=0.9' } });
    if (!response.ok) throw new Error(`Photon reverse unavailable: ${response.status}`);
    const data = (await response.json()) as { features?: PhotonFeature[] };
    const first = data.features?.[0];
    if (!first) return { label: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    const p = first.properties;
    const streetAddress = [p.street, p.housenumber].filter(Boolean).join(' ');
    return { label: russianAddress([streetAddress || p.name, p.city, russianCountry(p.country, p.countrycode)].filter(Boolean).join(', ')), city: p.city ? russianAddress(p.city) : undefined };
  }
}
