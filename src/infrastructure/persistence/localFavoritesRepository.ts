import { z } from 'zod';
import type { FavoritePlace, FavoritesRepository } from '../../application/ports/FavoritesRepository';
import { poiSchema } from './savedWalkSchema';
import { russianAddress } from '../../shared/russianAddress';

const KEY = 'private-walks/favorites/v1';
const favoriteSchema = z.object({ id: z.string(), city: z.string().min(1), poi: poiSchema, savedAt: z.string().datetime() });

/** Stores favorite snapshots locally without altering or depending on the active route. */
export class LocalFavoritesRepository implements FavoritesRepository {
  /** Storage is injected for isolated tests and alternative platform storage adapters. */
  constructor(private readonly storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => localStorage) {}
  /** Validates entries individually so one damaged record cannot hide all other favorites. */
  list(): FavoritePlace[] {
    const raw = this.storage().getItem(KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Не удалось прочитать избранное.');
    return data.flatMap(item => { const parsed = favoriteSchema.safeParse(item); return parsed.success ? [{ ...parsed.data, city: russianAddress(parsed.data.city) } as FavoritePlace] : []; });
  }

  /** Propagates quota/storage errors so the interface does not falsely confirm saving. */
  save(items: FavoritePlace[]): void { this.storage().setItem(KEY, JSON.stringify(items)); }
}
