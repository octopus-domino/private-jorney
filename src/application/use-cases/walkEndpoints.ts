import type { WalkDraft } from '../../domain/WalkDraft';
import type { Poi } from '../../domain/Poi';

/** Preserves selected route order rather than relying on the order returned by map searches. */
export function walkEndpoints(draft: WalkDraft, pois: Poi[] = draft.savedPois ?? []) {
  const points = draft.selectedPoiIds.map(id => pois.find(point => point.id === id)).filter((point): point is Poi => !!point);
  if (points.length) return { first: points[0], from: points[0].name, to: points.length > 1 ? points.at(-1)!.name : undefined };
  const anchors = draft.area.anchors;
  return { first: anchors[0], from: anchors[0]?.label, to: anchors.length > 1 ? anchors.at(-1)?.label : undefined };
}
