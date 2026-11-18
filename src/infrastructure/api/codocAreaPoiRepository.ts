import type { Poi } from '../../domain/Poi';
import { POI_CATEGORIES } from '../../domain/PoiCategory';
import type { PoiRepository, PoiSearchParams } from '../../application/ports/PoiRepository';
import type { HistoricalHouseRepository } from '../../application/ports/HistoricalHouseRepository';
import type { PlaceRepository } from '../../application/ports/PlaceRepository';
import { historicalHouseToPoi } from '../../application/use-cases/historicalHouseToPoi';
import { placeToPoi } from '../../application/use-cases/placeToPoi';
import { haversineMeters } from '../../shared/geo';

// CoDoc has a single search permit; separate anchors must not contend with each other.
const MAX_CONCURRENT_REQUESTS = 1;
const HOUSE_LIMIT = 200;

/** Adapter: every discovery category comes exclusively from codoc.site, around every selected anchor. */
export class CodocAreaPoiRepository implements PoiRepository {
  constructor(private readonly houses: HistoricalHouseRepository, private readonly places: PlaceRepository) {}

  /** Bounded workers publish partial successes without letting one slow source block every other category. */
  async search(params: PoiSearchParams): Promise<Poi[]> {
    const categories = [...new Set(params.categoryIds)].filter(id => id !== 'custom');
    const places = categories.filter(id => id !== 'historical-house');
    const tasks = params.anchors.flatMap(anchor => [
      ...(categories.includes('historical-house') ? [() => this.loadHouses(anchor, params)] : []),
      ...(places.length ? [() => this.loadPlaces(anchor, places, params)] : []),
    ]);
    const points = new Map<string, Poi>();
    let next = 0, successes = 0;
    const worker = async () => {
      while (next < tasks.length && !params.signal?.aborted) {
        const task = tasks[next++];
        try { this.merge(points, await task()); successes++; params.onPartial?.([...points.values()]); }
        catch (error) {
          if (params.signal?.aborted) throw error;
          console.info('codoc discovery query unavailable; retaining other successful categories', error);
        }
      }
    };
    await Promise.allSettled(Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, tasks.length) }, worker));
    if (params.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (tasks.length && !successes) throw new Error('Не удалось загрузить места с codoc.site. Повторите поиск.');
    return [...points.values()].filter(point => params.anchors.some(anchor => haversineMeters(anchor, point) <= params.radiusMeters + 10));
  }

  private async loadHouses(anchor: { lat: number; lng: number }, params: PoiSearchParams): Promise<Poi[]> {
    return (await this.houses.nearby({ lat: anchor.lat, lon: anchor.lng,
      radiusKm: params.radiusMeters / 1000, limit: HOUSE_LIMIT, beforeYear: 0, signal: params.signal })).map(historicalHouseToPoi);
  }

  private async loadPlaces(anchor: { lat: number; lng: number }, categories: string[], params: PoiSearchParams): Promise<Poi[]> {
    const selected = POI_CATEGORIES.filter(item => categories.includes(item.id));
    const themes = selected.map(item => item.backendTheme ?? 'attractions');
    const result = await this.places.search({ lat: anchor.lat, lon: anchor.lng, themes,
      radiusKm: params.radiusMeters / 1000, language: 'ru', signal: params.signal });
    if (!result.available && !result.places.length) throw new Error('Источник мест временно недоступен.');
    return result.places.flatMap(place => {
      const matched = (place.meta?.themes ?? place.meta?.theme ?? (themes.length === 1 ? themes[0] : '')).split(',');
      const applicable = selected.filter(item => matched.includes(item.backendTheme ?? 'attractions'));
      if (!applicable.length) return [];
      return [{ ...placeToPoi(place, applicable[0].id), categoryIds: applicable.map(item => item.id) }];
    });
  }

  private merge(target: Map<string, Poi>, points: Poi[]) {
    for (const point of points) {
      const existing = target.get(point.id);
      target.set(point.id, existing ? { ...existing, categoryIds: [...new Set([...existing.categoryIds, ...point.categoryIds])],
        facts: [...new Set([...existing.facts, ...point.facts])] } : point);
    }
  }
}
