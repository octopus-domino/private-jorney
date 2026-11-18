// src/domain/PoiCategory.ts
export type CategorySource = 'themed' | 'buildings' | 'osm' | 'custom';

export interface PoiCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
  source: CategorySource;
  backendTheme?: string;
}

export const POI_CATEGORIES: PoiCategory[] = [
  {
    id: 'historical-house',
    label: 'Исторические дома',
    icon: '🏠',
    color: '#7c3aed',
    source: 'buildings',
  },
  {
    id: 'cultural',
    label: 'Историко-культурные',
    icon: '🏛',
    color: '#8b5cf6',
    source: 'themed',
    backendTheme: 'cultural',
  },
  {
    id: 'mystical',
    label: 'Мистические',
    icon: '👻',
    color: '#be185d',
    source: 'themed',
    backendTheme: 'mystic',
  },
  {
    id: 'religious',
    label: 'Религиозные',
    icon: '⛪',
    color: '#dc2626',
    source: 'themed',
    backendTheme: 'religious',
  },
  {
    id: 'bars',
    label: 'Бары',
    icon: '🍺',
    color: '#b45309',
    source: 'themed',
    backendTheme: 'bars',
  },
  {
    id: 'attractions',
    label: 'Достопримечательности',
    icon: '🗺',
    color: '#2563eb',
    source: 'osm',
  },
  {
    // Служебная категория. В фильтр не попадает,
    // в запросы к бэку не включается — только для отображения
    // точек, добавленных пользователем через «Узнать о месте».
    id: 'custom',
    label: 'Своя точка',
    icon: '📍',
    color: '#6366f1',
    source: 'custom',
  },
];

export const CATEGORY_BY_ID: ReadonlyMap<string, PoiCategory> = new Map(
  POI_CATEGORIES.map((c) => [c.id, c]),
);

export function categoryColor(id: string | undefined): string {
  return (id && CATEGORY_BY_ID.get(id)?.color) || '#475569';
}

export function categoryIcon(id: string | undefined): string {
  return (id && CATEGORY_BY_ID.get(id)?.icon) || '•';
}

export function categoryLabel(id: string): string {
  return CATEGORY_BY_ID.get(id)?.label ?? id;
}