import type { Poi } from './Poi';
import type { WalkingRoute } from './WalkingRoute';
// src/domain/WalkDraft.ts
import type { SearchArea } from './SearchArea';

export type PlanView = 'map' | 'list';

export interface WalkDraft {
  id: string;
  title: string;
  city?: string;
  area: SearchArea;
  selectedCategoryIds: string[];
  selectedPoiIds: string[];
  savedPois?: Poi[];
  savedRoute?: WalkingRoute | null;
  savedFailedSegments?: number[];
  view: PlanView;
  createdAt: string;
  updatedAt: string;
}
