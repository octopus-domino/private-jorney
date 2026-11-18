// src/infrastructure/api/httpPlaceInfoRepository.ts
import type { PlaceInfoRepository } from '../../application/ports/PlaceInfoRepository';
import type { Geocoder } from '../../application/ports/Geocoder';
import type { PlaceInfo } from '../../domain/PlaceInfo';
import { QueryCache } from '../../shared/queryCache';
import { publishedSourceUrl } from './publishedSourceUrl';

/**
 * Карточка «узнать о месте» меняется очень редко. Кэш 24 ч.
 * v2: раньше в этой версии кэш записывал `null` при abort или сетевой
 * ошибке, из-за чего точка «отравлялась» на 24 часа. v2 эти ошибки
 * не кэширует, `null` попадает в кэш только при реальном «ничего не нашли».
 */
const INFO_CACHE = new QueryCache<PlaceInfo | null>({
  name: 'placeinfo',
  ttlMs: 24 * 60 * 60 * 1000,
  maxEntries: 100,
  persist: true,
  storageKey: 'private-walks/cache/placeinfo/v2',
});

function quantizeLatLng(lat: number, lng: number, precision = 4): string {
  const p = 10 ** precision;
  return `${Math.round(lat * p) / p},${Math.round(lng * p) / p}`;
}

interface WikiPage {
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
}

interface WikiResponse {
  query?: { pages?: WikiPage[] };
}

export class HttpPlaceInfoRepository implements PlaceInfoRepository {
  constructor(
    private readonly geocoder: Geocoder,
    private readonly wikiBase: string = 'https://ru.wikipedia.org',
  ) {}

  async lookup(
    lat: number,
    lng: number,
    signal?: AbortSignal,
  ): Promise<PlaceInfo | null> {
    const key = quantizeLatLng(lat, lng);

    return INFO_CACHE.getAbortable(key, async (signal) => {
      // Быстрая проверка: если signal уже аборчен до запросов,
      // сразу выходим без кэширования null.
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const [wikiResult, reverseResult] = await Promise.allSettled([
        this.fetchWikipedia(lat, lng, signal),
        this.geocoder.reverse(lat, lng, signal),
      ]);

      // Abort мог произойти во время запросов — тоже не кэшируем.
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const bothRejected =
        wikiResult.status === 'rejected' && reverseResult.status === 'rejected';

      // Оба источника упали не из-за abort (сеть, 5xx, таймаут).
      // Не кэшируем null — при следующем клике попробуем снова.
      if (bothRejected) {
        throw new Error('place-info-unavailable');
      }

      const wikiData = wikiResult.status === 'fulfilled' ? wikiResult.value : null;
      const reverseLabel =
        reverseResult.status === 'fulfilled'
          ? reverseResult.value.label
          : undefined;

      if (wikiData) {
        return {
          lat,
          lng,
          title: wikiData.title,
          subtitle: reverseLabel,
          extract: wikiData.extract,
          thumbnailUrl: wikiData.thumbnailUrl,
          wikipediaUrl: wikiData.url,
          source: 'wikipedia',
        };
      }

      if (reverseLabel && reverseLabel.trim().length > 0) {
        const firstPart = reverseLabel.split(',')[0]?.trim() || reverseLabel;
        return {
          lat,
          lng,
          title: firstPart,
          subtitle: reverseLabel,
          source: 'reverse',
        };
      }

      // Реально ничего не нашли — кэш уместен (TTL 24 ч).
      return null;
    }, signal);
  }

  private async fetchWikipedia(
    lat: number,
    lng: number,
    signal?: AbortSignal,
  ): Promise<{ title: string; extract: string; thumbnailUrl?: string; url: string } | null> {
    const url = new URL(`${this.wikiBase}/w/api.php`);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('generator', 'geosearch');
    url.searchParams.set('ggscoord', `${lat}|${lng}`);
    url.searchParams.set('ggsradius', '200');
    url.searchParams.set('ggslimit', '1');
    url.searchParams.set('prop', 'extracts|pageimages|coordinates');
    url.searchParams.set('exintro', '1');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('exsentences', '3');
    url.searchParams.set('piprop', 'thumbnail');
    url.searchParams.set('pithumbsize', '320');
    url.searchParams.set('origin', '*');

    const response = await fetch(publishedSourceUrl(url.toString()), { signal });
    if (!response.ok) return null;
    const data = (await response.json()) as WikiResponse;
    const page = data.query?.pages?.[0];
    if (!page) return null;

    const title = String(page.title ?? '').trim();
    const extract = String(page.extract ?? '').trim();
    if (!title || !extract) return null;

    return {
      title,
      extract: extract.length > 600 ? `${extract.slice(0, 599)}…` : extract,
      thumbnailUrl: page.thumbnail?.source,
      url: `${this.wikiBase}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    };
  }
}
