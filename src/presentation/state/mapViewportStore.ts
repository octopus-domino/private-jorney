import { create } from 'zustand';
import type { ListingSearchArea } from '../../application/ports/ApartmentListingsRepository';

interface ViewportState { area: ListingSearchArea | null; setArea(area: ListingSearchArea): void }

/** Observer: publishes settled map bounds without persisting viewport or real-estate responses. */
export const useMapViewportStore = create<ViewportState>((set, get) => ({
  area: null,
  setArea(area) {
    const previous = get().area;
    if (previous && Object.entries(area).every(([key, value]) => value === previous[key as keyof ListingSearchArea])) return;
    set({ area });
  },
}));
