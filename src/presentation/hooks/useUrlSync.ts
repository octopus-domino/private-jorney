// src/presentation/hooks/useUrlSync.ts
import { useEffect } from 'react';
import { useWalkStore } from '../state/walkStore';

export function useUrlSync(enabled: boolean): void {
  const draft = useWalkStore((s) => s.draft);

  useEffect(() => {
    if (!enabled) return;

    const url = new URL(window.location.href);
    url.searchParams.set('draft', draft.id);

    if (draft.area.anchors.length > 0) {
      url.searchParams.set(
        'points',
        draft.area.anchors.map((a) => `${a.lat.toFixed(6)},${a.lng.toFixed(6)}`).join(';'),
      );
    } else {
      url.searchParams.delete('points');
    }

    url.searchParams.set('radius', String(Math.round(draft.area.radiusMeters)));

    if (draft.selectedCategoryIds.length > 0) {
      url.searchParams.set('categories', draft.selectedCategoryIds.join(','));
    } else {
      url.searchParams.delete('categories');
    }

    // Удаляем устаревший параметр theme, если он был в старых ссылках.
    url.searchParams.delete('theme');

    url.searchParams.set('view', draft.view);

    window.history.replaceState(null, '', url.toString());
  }, [
    enabled,
    draft.id,
    draft.area.anchors,
    draft.area.radiusMeters,
    draft.selectedCategoryIds,
    draft.view,
  ]);
}
