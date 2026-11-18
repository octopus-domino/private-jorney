// src/presentation/components/CategoryPicker.tsx
import { POI_CATEGORIES } from '../../domain/PoiCategory';

interface CategoryPickerProps {
  selectedIds: string[];
  onToggle(id: string): void;
}

/** Служебная «custom» в фильтре не показывается — её нельзя запросить у бэка. */
const SELECTABLE = POI_CATEGORIES.filter((c) => c.source !== 'custom');

export function CategoryPicker({ selectedIds, onToggle }: CategoryPickerProps) {
  const selected = new Set(selectedIds);
  return (
    <div className="chips">
      {SELECTABLE.map((category) => {
        const active = selected.has(category.id);
        return (
          <button
            key={category.id}
            type="button"
            className={`chip${active ? ' is-active' : ''}`}
            aria-pressed={active}
            style={active ? { borderColor: category.color, color: category.color } : undefined}
            onClick={() => onToggle(category.id)}
          >
            <span aria-hidden>{category.icon}</span> {category.label}
          </button>
        );
      })}
    </div>
  );
}