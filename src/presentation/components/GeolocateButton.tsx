// src/presentation/components/GeolocateButton.tsx
import { useState } from 'react';

interface GeolocateButtonProps {
  onLocate(lat: number, lng: number): void;
}

export function GeolocateButton({ onLocate }: GeolocateButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);
    if (!navigator.geolocation) {
      setLoading(false);
      setError('Геолокация недоступна');
      setTimeout(() => setError(null), 2500);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false);
        onLocate(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLoading(false);
        setError('Не удалось');
        setTimeout(() => setError(null), 2500);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  return (
    <button
      type="button"
      className={`map-geolocate-btn${loading ? ' is-loading' : ''}${error ? ' has-error' : ''}`}
      onClick={handleClick}
      aria-label="Моё местоположение"
      title={error ?? 'Моё местоположение'}
    >
      {loading ? (
        <span className="map-geolocate-btn__spinner" aria-hidden />
      ) : error ? (
        <span className="map-geolocate-btn__error" aria-hidden>!</span>
      ) : (
        <span className="map-geolocate-btn__icon" aria-hidden>📍</span>
      )}
    </button>
  );
}