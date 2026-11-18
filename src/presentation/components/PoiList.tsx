// src/presentation/components/PoiList.tsx
import type { Poi } from '../../domain/Poi';
import { categoryColor, categoryIcon, categoryLabel } from '../../domain/PoiCategory';

interface PoiListProps {
  pois: Poi[];
  selectedPoiIds: string[];
  onToggle(id: string): void;
}

export function PoiList({ pois, selectedPoiIds, onToggle }: PoiListProps) {
  if (pois.length === 0) {
    return <p className="empty">Точек не найдено. Увеличьте радиус или добавьте категории.</p>;
  }
  return (
    <ul className="poi-list">
      {pois.map((poi) => {
        const primary = poi.categoryIds[0];
        const order = selectedPoiIds.indexOf(poi.id);
        const isSelected = order >= 0;
        return (
          <li key={poi.id} className={`poi-card${isSelected ? ' is-selected' : ''}`}>
            <button
              type="button"
              className="poi-card__toggle"
              onClick={() => onToggle(poi.id)}
              aria-pressed={isSelected}
            >
              <span className="poi-card__dot" style={{ background: categoryColor(primary) }}>
                {categoryIcon(primary)}
              </span>
              <span className="poi-card__body">
                <span className="poi-card__name">{poi.name}</span>
                <span className="poi-card__meta">
                  {poi.categoryIds.map(categoryLabel).join(' · ')}
                </span>
                {poi.summary && <span className="poi-card__summary">{poi.summary}</span>}
                {poi.facts.length > 0 && (
                  <ul className="poi-card__facts">
                    {poi.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                )}
              </span>
              {isSelected && <span className="poi-card__order">{order + 1}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}