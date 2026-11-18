// src/application/use-cases/exportSharedWalk.ts
import type { Poi } from '../../domain/Poi';
import type { WalkDraft } from '../../domain/WalkDraft';
import type { WalkingRoute } from '../../domain/WalkingRoute';
import { SHARED_WALK_VERSION, type SharedWalk } from '../../shared/integration';

export function exportSharedWalk(
  draft: WalkDraft,
  pois: Poi[],
  route: WalkingRoute | null,
): SharedWalk {
  const byId = new Map(pois.map((p) => [p.id, p]));
  const ordered = draft.selectedPoiIds
    .map((id) => byId.get(id))
    .filter((p): p is Poi => Boolean(p));

  return {
    version: SHARED_WALK_VERSION,
    id: draft.id,
    title: draft.title,
    createdAt: new Date().toISOString(),
    points: ordered.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      name: p.name,
      description: (p.summary || p.facts.join('\n')).slice(0, 500),
      sourceUrl: p.details?.sourceUrl,
      poiId: p.id,
      categoryIds: p.categoryIds,
      buildingHistoryId: p.buildingHistoryId,
    })),
    route: route
      ? {
          geometry: route.geometry,
          legs: route.legs,
          totalDistanceMeters: route.totalDistanceMeters,
          totalDurationSeconds: route.totalDurationSeconds,
        }
      : undefined,
  };
}
