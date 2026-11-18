import { useEffect, useMemo, useState } from 'react';
import type { PlaceInfo } from '../../domain/PlaceInfo';
import type { Poi } from '../../domain/Poi';
import { BuildingProfileSection } from './BuildingProfileSection';
import { PlaceHistorySection } from './PlaceHistorySection';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { FavoriteButton } from './FavoriteButton';
import { russianAddress } from '../../shared/russianAddress';

interface SpotCardProps {
  status: 'idle' | 'loading' | 'ready' | 'error';
  info: PlaceInfo | null;
  point: { lat: number; lng: number } | null;
  onAddToRoute(): void;
  onMakeStart(): void;
  onClose(): void;
}

export function SpotCard({ status, info, point, onAddToRoute, onMakeStart, onClose }: SpotCardProps) {
  const sheetRef = useSwipeDismiss<HTMLDivElement>(onClose, status !== 'idle' && point !== null);
  const [tab, setTab] = useState<'place' | 'building'>('place');
  const pointKey = point ? `${point.lat}:${point.lng}` : '';
  useEffect(() => { setTab('place'); }, [pointKey]);
  const poi = useMemo<Poi | null>(() => point ? {
    id: `spot:${point.lat}:${point.lng}`, lat: point.lat, lng: point.lng,
    name: info?.title ?? 'Выбранный дом', source: 'manual', categoryIds: ['historical-house'], facts: [],
    details: { address: info?.subtitle ? russianAddress(info.subtitle) : undefined },
  } : null, [point?.lat, point?.lng, info?.title, info?.subtitle]);
  if (status === 'idle' || !poi) return null;
  return <div ref={sheetRef} className="spot-card spot-card--details" role="dialog" aria-label="Информация о месте">
    <button type="button" className="spot-card__close" onClick={onClose} aria-label="Закрыть">×</button>
    <div className="spot-card__header"><div className="spot-card__title-wrap">
      <FavoriteButton poi={poi} />
      <h3 className="spot-card__title">{info?.title ?? 'Выбранный дом'}</h3>
      {info?.subtitle && <p className="spot-card__subtitle">{russianAddress(info.subtitle)}</p>}
    </div></div>
    <div className="poi-detail__tabs" role="tablist" aria-label="Сведения о выбранном доме">
      <button type="button" role="tab" id="spot-place-tab" aria-selected={tab === 'place'} aria-controls="spot-place-panel" onClick={() => setTab('place')}>О месте</button>
      <button type="button" role="tab" id="spot-building-tab" aria-selected={tab === 'building'} aria-controls="spot-building-panel" onClick={() => setTab('building')}>О доме</button>
    </div>
    <div className="poi-detail__body" key={`${pointKey}:${tab}`} role="tabpanel" id={`spot-${tab}-panel`} aria-labelledby={`spot-${tab}-tab`} tabIndex={0}>
      {tab === 'building' ? <BuildingProfileSection poi={poi} /> : <>
        {status === 'loading' && <p className="spot-card__hint">Ищем сведения о выбранном месте…</p>}
        {info?.extract && <p className="spot-card__extract">{info.extract}</p>}
        <PlaceHistorySection poi={poi} />
      </>}
    </div>
    <div className="spot-card__actions">
      <button type="button" className="btn btn--primary" onClick={onAddToRoute}>📍 В маршрут</button>
      <button type="button" className="btn" onClick={onMakeStart}>★ Начать отсюда</button>
      {tab === 'place' && info?.wikipediaUrl && <a className="btn" href={info.wikipediaUrl} target="_blank" rel="noreferrer noopener">Википедия ↗</a>}
    </div>
  </div>;
}
