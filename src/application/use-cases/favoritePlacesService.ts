import type { FavoritesRepository, FavoritePlace } from '../ports/FavoritesRepository';
import type { Geocoder } from '../ports/Geocoder';
import type { Poi } from '../../domain/Poi';
import { resolveCity } from './resolveCity';

/** Coordinates city resolution and persistence through injected ports. */
export class FavoritePlacesService {
  constructor(private readonly repository: FavoritesRepository, private readonly geocoder: Geocoder) {}

  /** Restores the complete city-filterable collection. */
  list(): FavoritePlace[] { return this.repository.list(); }

  /** Resolves the city before writing, preserving any favorites added during that request. */
  async add(poi: Poi): Promise<FavoritePlace[]> {
    const city = await resolveCity(poi, this.geocoder, poi.details?.address);
    const address = poi.details?.address ?? (await this.geocoder.reverse(poi.lat, poi.lng)).label;
    const snapshot: Poi = { ...poi, details: { ...poi.details, address },
      name: poi.name === 'Выбранный дом' ? address.split(',')[0] : poi.name };
    const items = this.repository.list();
    const next = items.some(item => item.id === poi.id) ? items
      : [...items, { id: poi.id, city, poi: snapshot, savedAt: new Date().toISOString() }];
    this.repository.save(next);
    return next;
  }

  /** Removal persists immediately and never deletes the point from a saved route. */
  remove(id: string): FavoritePlace[] {
    const items = this.repository.list().filter(item => item.id !== id);
    this.repository.save(items);
    return items;
  }
}
