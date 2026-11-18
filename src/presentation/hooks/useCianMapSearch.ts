import { useEffect, useRef } from 'react';
import type { ApartmentListingsRepository } from '../../application/ports/ApartmentListingsRepository';
import { useMapViewportStore } from '../state/mapViewportStore';

const SETTLE_DELAY_MS = 1000;
const FAILURE_COOLDOWN_MS = 60000;
const MAX_LATITUDE_SPAN = 0.012;
const MAX_LONGITUDE_SPAN = 0.024;

/** Prefetches only a settled neighbourhood view; opening a card cancels background work immediately. */
export function useCianMapSearch(repository: ApartmentListingsRepository, enabled: boolean): void {
  const area = useMapViewportStore(state => state.area);
  const retryAfter = useRef(0);

  useEffect(() => {
    if (!enabled || !area || !repository.prefetch || Date.now() < retryAfter.current) return;
    if (area.north - area.south > MAX_LATITUDE_SPAN || area.east - area.west > MAX_LONGITUDE_SPAN) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void repository.prefetch!(area, controller.signal).catch(error => {
        if (!controller.signal.aborted) {
          retryAfter.current = Date.now() + FAILURE_COOLDOWN_MS;
          console.info('Area listing prefetch unavailable.', error instanceof Error ? error.name : 'SourceError');
        }
      });
    }, SETTLE_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [area, enabled, repository]);
}
