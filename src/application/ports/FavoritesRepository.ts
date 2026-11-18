import type { Poi } from '../../domain/Poi';

export interface FavoritePlace { id: string; city: string; poi: Poi; savedAt: string }

/** Keeps favorites independent from route membership and route history. */
export interface FavoritesRepository {
  list(): FavoritePlace[];
  save(items: FavoritePlace[]): void;
}
