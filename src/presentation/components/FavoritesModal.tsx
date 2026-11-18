import { useState } from 'react';
import type { Poi } from '../../domain/Poi';
import { useFavoritesStore } from '../state/favoritesStore';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';

/** Presents local favorites by city, including deletion and opening a saved point on the map. */
export function FavoritesModal({ onClose, onOpen, initialCity }: {
  onClose(): void; onOpen(poi: Poi): void; initialCity?: string;
}) {
  const sheetRef = useSwipeDismiss<HTMLDivElement>(onClose);
  const { items, error, remove } = useFavoritesStore();
  const cities = [...new Set(items.map(item => item.city))].sort((a, b) => a.localeCompare(b, 'ru'));
  const [city, setCity] = useState(initialCity ?? cities[0] ?? '');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const activeCity = cities.includes(city) ? city : cities[0] ?? '';

  const deletePlace = (id: string) => {
    try { remove(id); setRemoveError(null); }
    catch { setRemoveError('Не удалось удалить место из хранилища.'); }
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <div ref={sheetRef} className="modal modal--saved" role="dialog" aria-modal="true" aria-label="Избранные места" onClick={event => event.stopPropagation()}>
      <header className="modal__head"><h2>Избранные места</h2><button type="button" className="modal__close" aria-label="Закрыть избранное" onClick={onClose}>×</button></header>
      {(error || removeError) && <p role="alert">{removeError ?? error}</p>}
      {cities.length > 0 && <label className="favorites-city">Город<select aria-label="Город избранного" value={activeCity} onChange={event => setCity(event.target.value)}>{cities.map(name => <option key={name}>{name}</option>)}</select></label>}
      {!items.length && !error && <p>В избранном пока нет мест. Добавляйте их звёздочкой в карточке.</p>}
      <div className="saved-routes">{items.filter(item => item.city === activeCity).map(item => <div className="saved-route" key={item.id}>
        <button type="button" className="saved-route__body" onClick={() => onOpen(item.poi)}><strong>{item.poi.name}</strong><span className="saved-route__meta">{item.poi.details?.address ?? item.city}</span></button>
        <button type="button" className="saved-route__trash" aria-label={`Удалить ${item.poi.name} из избранного`} onClick={() => deletePlace(item.id)}>×</button>
      </div>)}</div>
    </div>
  </div>;
}
