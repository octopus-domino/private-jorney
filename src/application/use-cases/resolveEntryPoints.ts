// src/application/use-cases/resolveEntryPoints.ts
import type { AnchorPoint } from '../../domain/SearchArea';
import type { PlanView } from '../../domain/WalkDraft';
import { newId } from '../../shared/id';

export interface EntryResolution {
  anchors: AnchorPoint[];
  radiusMeters?: number;
  categoryIds?: string[];
  view?: PlanView;
  draftId?: string;
  hadErrors: boolean;
}

const POINT_PATTERN = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

export function resolveEntryPoints(search: string): EntryResolution {
  const params = new URLSearchParams(search);
  const result: EntryResolution = { anchors: [], hadErrors: false };

  const points = params.get('points');
  if (points) {
    for (const raw of points.split(';')) {
      const trimmed = raw.trim();
      if (!POINT_PATTERN.test(trimmed)) {
        result.hadErrors = true;
        continue;
      }
      const [latRaw, lngRaw] = trimmed.split(',');
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        result.hadErrors = true;
        continue;
      }
      // Уникальный ID — не зависит от позиции, безопасен при StrictMode.
      result.anchors.push({ id: newId('anchor'), lat, lng });
    }
  }

  const radius = params.get('radius');
  if (radius) {
    const n = Number(radius);
    if (Number.isFinite(n) && n >= 50 && n <= 20000) result.radiusMeters = n;
    else result.hadErrors = true;
  }

  const categories = params.get('categories');
  if (categories) {
    result.categoryIds = categories.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const view = params.get('view');
  if (view === 'map' || view === 'list') result.view = view;

  const draft = params.get('draft');
  if (draft) result.draftId = draft;

  return result;
}