// src/domain/WalkingRoute.ts
export type LatLng = [number, number];

export interface WalkingRouteLeg {
  fromIndex: number;
  toIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
}

export interface WalkingRoute {
  legs: WalkingRouteLeg[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  geometry: LatLng[];
}