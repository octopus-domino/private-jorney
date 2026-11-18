import { create } from 'zustand';
import type { FavoritePlace } from '../../application/ports/FavoritesRepository';
import type { Poi } from '../../domain/Poi';
import { favoritePlaces } from '../../infrastructure';

interface FavoritesState {
  items: FavoritePlace[];
  error: string | null;
  load(): void;
  add(poi: Poi): Promise<void>;
  remove(id: string): void;
}

/** Observer: synchronizes stars and the city list after a successful persistence operation. */
export const useFavoritesStore = create<FavoritesState>((set) => ({
  items: [], error: null,
  load() {
    try { set({ items: favoritePlaces.list(), error: null }); }
    catch { set({ error: 'Не удалось прочитать избранное из хранилища.' }); }
  },
  async add(poi) { set({ items: await favoritePlaces.add(poi), error: null }); },
  remove(id) { set({ items: favoritePlaces.remove(id), error: null }); },
}));
