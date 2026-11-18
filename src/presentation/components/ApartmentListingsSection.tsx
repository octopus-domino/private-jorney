import { useEffect, useState } from 'react';
import type { ApartmentListing } from '../../domain/ApartmentListing';
import { apartmentListingsRepository, avitoListingsRepository } from '../../infrastructure';
import type { ApartmentListingsRepository } from '../../application/ports/ApartmentListingsRepository';
import { ExternalSourceError } from '../../infrastructure/api/externalPageTransport';
import { useMapViewportStore } from '../state/mapViewportStore';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const VIEWPORT_DEBOUNCE_MS = 600;

export function ApartmentListingsSection({ address, point }: { address: string; point?: { lat: number; lng: number } }) {
  return <section className="apartment-listings" aria-label="Квартиры в продаже"><h4>Квартиры в продаже</h4>
    <SourceListings name="Циан" repository={apartmentListingsRepository} address={address} point={point} />
    <SourceListings name="Avito" repository={avitoListingsRepository} address={address} point={point} />
  </section>;
}

function SourceListings({ address, point, name, repository }: { address: string; point?: { lat: number; lng: number }; name: string; repository: ApartmentListingsRepository }) {
  const area = useDebouncedValue(useMapViewportStore(state => state.area), VIEWPORT_DEBOUNCE_MS);
  const [state, setState] = useState<{ address: string; status: 'idle' | 'loading' | 'ready' | 'error'; listings: ApartmentListing[]; restricted?: boolean }>({ address, status: 'idle', listings: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ address, status: 'loading', listings: [] });
    void repository.lookup(address, controller.signal, point, area ?? undefined).then((listings) => {
      if (!controller.signal.aborted) setState({ address, status: 'ready', listings });
    }).catch(error => { if (!controller.signal.aborted) setState({ address, status: 'error', listings: [], restricted: error instanceof ExternalSourceError && error.code === 'restricted' }); });
    return () => controller.abort();
  }, [address, point?.lat, point?.lng, attempt, repository, area]);
  const current = state.address === address ? state : { status: 'loading', listings: [], restricted: false };
  return <section className="apartment-listings__source" aria-label={name} aria-live="polite">
    <h5>{name}</h5>
    {current.status === 'loading' && <p className="source-state">Проверяем объявления…</p>}
    {current.status === 'error' && <p className="source-state">{current.restricted
      ? `${name} ограничил доступ к данным или запросил проверку браузера. Откройте предложения на сайте.`
      : `${name} не предоставил объявления. Проверьте предложения на сайте.`}</p>}
    {current.status === 'ready' && !current.listings.length && <p className="source-state">В доступной выдаче нет объявлений с точным совпадением адреса.</p>}
    <div className="apartment-listings__cards">{current.listings.map((listing) => <a className="apartment-card" key={listing.id} href={listing.url} target="_blank" rel="noopener noreferrer">
      {listing.imageUrl && <img src={listing.imageUrl} alt="Квартира из объявления" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}
      <strong>{new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(listing.priceRub)}</strong>
      <span>{listing.title}</span><small>{listing.address}</small>{listing.matchNote && <small>{listing.matchNote}</small>}<span className="apartment-card__link">Объявление на {name} ↗</span>
    </a>)}</div>
    <a className="source-link" href={repository.searchUrl(address, point)} target="_blank" rel="noopener noreferrer">Открыть поиск {name} ↗</a>
    {current.status === 'error' && <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Проверить ещё раз</button>}
  </section>;
}
