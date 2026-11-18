// src/application/ports/RoutePlanner.ts
import type { WalkingRoute } from '../../domain/WalkingRoute';

export interface RoutePlanner {
  buildWalkingRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    signal?: AbortSignal,
  ): Promise<WalkingRoute>;
}