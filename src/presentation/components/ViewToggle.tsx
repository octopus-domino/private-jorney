// src/presentation/components/ViewToggle.tsx
import type { PlanView } from '../../domain/WalkDraft';

interface ViewToggleProps {
  value: PlanView;
  onChange(value: PlanView): void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="segmented" role="tablist" aria-label="Режим отображения">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'map'}
        className={value === 'map' ? 'is-active' : ''}
        onClick={() => onChange('map')}
      >
        Карта
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'list'}
        className={value === 'list' ? 'is-active' : ''}
        onClick={() => onChange('list')}
      >
        Список
      </button>
    </div>
  );
}