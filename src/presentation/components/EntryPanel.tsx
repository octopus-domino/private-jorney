// src/presentation/components/EntryPanel.tsx
import { useEffect, useRef, useState } from 'react';
import { geocoder } from '../../infrastructure';
import type { GeocodeHit } from '../../application/ports/Geocoder';
import type { AnchorPoint } from '../../domain/SearchArea';
import { newId } from '../../shared/id';

interface EntryPanelProps {
  onAddAnchor(anchor: AnchorPoint): void;
  onLocate(lat: number, lng: number): void;
}

export function EntryPanel({ onAddAnchor, onLocate }: EntryPanelProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (query.trim().length < 3) {
      setHits([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    const timer = window.setTimeout(() => {
      geocoder
        .search(query, controller.signal)
        .then((result) => {
          setHits(result);
          setStatus('idle');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setStatus('error');
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!focused) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [focused]);

  function addFromHit(hit: GeocodeHit) {
    onAddAnchor({ id: newId('anchor'), lat: hit.lat, lng: hit.lng, label: hit.label });
    setQuery('');
    setHits([]);
    setFocused(false);
  }

  function addFromGeolocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Геолокация недоступна');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onLocate(position.coords.latitude, position.coords.longitude);
      },
      () => setGeoError('Не удалось получить координаты'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const showHits = focused && (hits.length > 0 || status !== 'idle' || geoError);

  return (
    <div className="entry" ref={wrapRef}>
      <div className="entry__field">
        <span className="entry__icon" aria-hidden>🔍</span>
        <input
          type="text"
          className="entry__input"
          placeholder="Адрес или место"
          autoComplete="off"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
        />
      </div>
      <div className="entry__actions">
        <button
          type="button"
          className="btn btn--geo"
          onClick={addFromGeolocation}
        >
          <span aria-hidden>📍</span> <span className="entry__geo-text">Моё местоположение</span>
        </button>
      </div>

      {showHits && (
        <div className="entry__dropdown">
          {status === 'loading' && <p className="entry__status">Ищем адрес…</p>}
          {status === 'error' && (
            <p className="entry__status entry__status--error">Не удалось найти адрес</p>
          )}
          {geoError && <p className="entry__status entry__status--error">{geoError}</p>}
          {hits.map((hit) => (
            <button
              key={`${hit.lat},${hit.lng}`}
              type="button"
              className="entry__hit"
              onClick={() => addFromHit(hit)}
            >
              {hit.label}
            </button>
          ))}
          {status === 'idle' && hits.length === 0 && query.trim().length >= 3 && (
            <p className="entry__status">Ничего не найдено</p>
          )}
        </div>
      )}
    </div>
  );
}
