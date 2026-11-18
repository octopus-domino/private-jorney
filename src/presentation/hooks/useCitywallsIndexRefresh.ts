import { useEffect } from 'react';
import { citywallsIndex } from '../../infrastructure';
import { citywallsSquares } from '../../infrastructure/api/citywallsMap';
import { useMapViewportStore } from '../state/mapViewportStore';

const DAILY_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const IDLE_DELAY_MS = 15000;

/** Runs opportunistically while the app is open; it never starts GPS or wakes a closed app. */
export function useCitywallsIndexRefresh(): void {
  useEffect(() => {
    const update = () => {
      const area = useMapViewportStore.getState().area;
      if (document.hidden || !navigator.onLine || !area) return;
      const square = citywallsSquares({ lat: (area.south + area.north) / 2, lng: (area.west + area.east) / 2 })[0];
      if (square !== undefined) void citywallsIndex.refresh(square)
        .catch(error => console.info('Citywalls background update unavailable; using bundled catalogue', error));
    };
    let idle = setTimeout(update, IDLE_DELAY_MS);
    const unsubscribe = useMapViewportStore.subscribe(() => { clearTimeout(idle); idle = setTimeout(update, IDLE_DELAY_MS); });
    const timer = setInterval(update, DAILY_CHECK_INTERVAL_MS);
    return () => { clearTimeout(idle); clearInterval(timer); unsubscribe(); };
  }, []);
}
