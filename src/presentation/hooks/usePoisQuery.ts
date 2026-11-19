import { useEffect, useState } from 'react';
import { areaPoiRepository } from '../../infrastructure';
import { AreaSearchSession } from '../../application/use-cases/areaSearchSession';
import { useWalkStore } from '../state/walkStore';
import { useDebouncedValue } from './useDebouncedValue';
import { haversineMeters } from '../../shared/geo';

/** Searches codoc.site around every current anchor and preserves already selected route points. */
export function usePoisQuery(): () => void {
  const [revision, setRevision] = useState(0);
  const anchors = useWalkStore(state => state.draft.area.anchors);
  const rawRadius = useWalkStore(state => state.draft.area.radiusMeters);
  const rawCategories = useWalkStore(state => state.draft.selectedCategoryIds);
  const radius = useDebouncedValue(rawRadius, 400);
  const categories = useDebouncedValue(rawCategories, 400);
  const anchorKey = anchors.map(point => `${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`).join('|');
  const categoryKey = [...categories].sort().join('|');
  const rawCategoryKey = [...rawCategories].sort().join('|');

  useEffect(() => {
    const store = useWalkStore.getState();
    if (!anchors.length || !rawCategories.length) { store.setPois([], 'idle'); return; }
    const retained = store.pois.filter(point => point.source !== 'manual'
      && point.categoryIds.some(category => rawCategories.includes(category))
      && anchors.some(anchor => haversineMeters(anchor, point) <= rawRadius));
    if (rawCategoryKey !== categoryKey || rawRadius !== radius) { store.setPois(retained, 'loading'); return; }
    return new AreaSearchSession(areaPoiRepository, { anchors, radiusMeters: radius, categoryIds: categories },
      update => store.setPois(update.points, update.status, update.error), undefined, retained).start();
  }, [anchorKey, radius, categoryKey, rawCategoryKey, rawRadius, revision]);
  return () => setRevision(value => value + 1);
}
