import type { WalkDraft } from '../../domain/WalkDraft';
import type { Poi } from '../../domain/Poi';
import type { WalkingRoute } from '../../domain/WalkingRoute';

export function snapshotWalk(draft: WalkDraft, pois: Poi[], route: WalkingRoute | null, failedSegments: number[]): WalkDraft {
  const selected = new Set(draft.selectedPoiIds);
  return { ...draft, savedPois: pois.filter((p) => selected.has(p.id) || p.source === 'manual'), savedRoute: route, savedFailedSegments: failedSegments };
}
