// src/presentation/components/PoiDetailCard.tsx
import type { Poi } from '../../domain/Poi';
import { useEffect, useState } from 'react';
import { PlaceHistorySection } from './PlaceHistorySection';
import { BuildingProfileSection } from './BuildingProfileSection';
import { categoryColor, categoryIcon, categoryLabel } from '../../domain/PoiCategory';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { FavoriteButton } from './FavoriteButton';

interface PoiDetailCardProps {
  poi: Poi;
  isSelected: boolean;
  onToggle(): void;
  onClose(): void;
}

export function PoiDetailCard({ poi, isSelected, onToggle, onClose }: PoiDetailCardProps) {
  const sheetRef = useSwipeDismiss<HTMLDivElement>(onClose);
  const [tab, setTab] = useState<'place' | 'building'>('place');
  useEffect(() => { setTab('place'); }, [poi.id]);
  const primary = poi.categoryIds[0];
  const color = categoryColor(primary);

  // Сливаем все факты без повторов — placeToPoi кладёт одно и то же
  // в facts и historicalFacts, пользователь не должен видеть дублей.
  const seen = new Set<string>();
  const allFacts: string[] = [];
  const add = (v: string | undefined | null) => {
    const s = v?.trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    allFacts.push(s);
  };
  if (poi.details?.address) add(poi.details.address);
  for (const f of poi.details?.historicalFacts ?? []) add(f);
  for (const f of poi.details?.mysticalFacts ?? []) add(f);
  for (const f of poi.facts ?? []) add(f);

  return (
    <div ref={sheetRef} className="poi-detail" role="dialog" aria-label="Информация о точке">
      <button
        type="button"
        className="poi-detail__close"
        onClick={onClose}
        aria-label="Закрыть"
      >
        ×
      </button>

      <div className="poi-detail__header">
        <FavoriteButton poi={poi} />
        <span
          className="poi-detail__dot"
          style={{ background: color }}
          aria-hidden
        >
          {categoryIcon(primary)}
        </span>
        <div className="poi-detail__title-wrap">
          <h3 className="poi-detail__title">{poi.name}</h3>
          <span className="poi-detail__category">
            {poi.categoryIds.map(categoryLabel).join(' · ')}
          </span>
        </div>
      </div>

      <div className="poi-detail__tabs" role="tablist" aria-label="Сведения о месте">
        <button type="button" role="tab" id="poi-place-tab" aria-selected={tab === 'place'} aria-controls="poi-place-panel" onClick={() => setTab('place')}>О месте</button>
        <button type="button" role="tab" id="poi-building-tab" aria-selected={tab === 'building'} aria-controls="poi-building-panel" onClick={() => setTab('building')}>О доме</button>
      </div>
      <div className="poi-detail__body" key={`${poi.id}:${tab}`} role="tabpanel" id={tab === 'place' ? 'poi-place-panel' : 'poi-building-panel'} aria-labelledby={tab === 'place' ? 'poi-place-tab' : 'poi-building-tab'} tabIndex={0}>
      {tab === 'building' ? <BuildingProfileSection poi={poi} /> : <>
      {poi.summary && <p className="poi-detail__summary">{poi.summary}</p>}

      {allFacts.length > 0 && (
        <ul className="poi-detail__facts">
          {allFacts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}

      <PlaceHistorySection poi={poi} />
      </>}
      </div>

      <div className="poi-detail__actions">
        <button
          type="button"
          className={`btn ${isSelected ? '' : 'btn--primary'}`}
          onClick={onToggle}
        >
          {isSelected ? 'Убрать из маршрута' : 'В маршрут'}
        </button>
        {poi.details?.sourceUrl && (
          <a
            className="btn"
            href={poi.details.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Подробнее →
          </a>
        )}
      </div>
    </div>
  );
}
