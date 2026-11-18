import type { Poi } from '../../domain/Poi';
import { usePoiEnrichment } from '../hooks/usePoiEnrichment';
import { placeHistoryRepository } from '../../infrastructure';
import { CitywallsSourceError } from '../../infrastructure/api/citywallsSourceError';

export function PlaceHistorySection({ poi }: { poi: Poi }) {
  const { data: history, status, retry, error } = usePoiEnrichment(poi, placeHistoryRepository);
  const sourceName = history?.sourceName ?? placeHistoryRepository.sourceName(poi);
  if (status === 'unsupported') return null;
  return <section className="poi-detail__source" aria-label={`История из ${sourceName}`} aria-live="polite">
    <strong>{sourceName}</strong>
    {status === 'loading' && <p>Ищем историю здания…</p>}
    {status === 'error' && <div><p>{error instanceof CitywallsSourceError ? error.message : 'Источник временно недоступен.'}</p><button type="button" className="btn" onClick={retry}>Повторить</button></div>}
    {status === 'empty' && <p>Точное совпадение не найдено.</p>}
    {history && <>
      {history.title && <p><b>{history.title}</b></p>}
      {history.imageUrl && <a href={history.sourceUrl} target="_blank" rel="noopener noreferrer"><img className="place-history__photo" src={history.imageUrl} alt={history.title ?? 'Здание на Citywalls'} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} /></a>}
      {history.excerpt.split(/\n\n+/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}
      <a href={history.sourceUrl} target="_blank" rel="noopener noreferrer">Читать на {sourceName} →</a>
    </>}
  </section>;
}
