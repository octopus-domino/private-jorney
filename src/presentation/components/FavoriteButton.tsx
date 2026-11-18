import { useState } from 'react';
import type { Poi } from '../../domain/Poi';
import { useFavoritesStore } from '../state/favoritesStore';

/** Saves a complete point snapshot; the star confirms persistence rather than only a visual toggle. */
export function FavoriteButton({ poi }: { poi: Poi }) {
  const selected = useFavoritesStore(state => state.items.some(item => item.id === poi.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const store = useFavoritesStore.getState();
      if (selected) store.remove(poi.id);
      else await store.add(poi);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить избранное.'); }
    finally { setBusy(false); }
  };

  return <div className="favorite-control">
    <button type="button" className="btn favorite-star" disabled={busy} onClick={toggle} aria-pressed={selected}
      aria-label={selected ? 'Удалить из избранного' : 'Добавить в избранное'}>{selected ? '★' : '☆'}</button>
    {error && <p className="source-state" role="alert">{error}</p>}
  </div>;
}
