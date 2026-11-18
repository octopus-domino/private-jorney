// src/shared/integration.ts
export const SHARED_WALK_VERSION = 1 as const;

export interface SharedWalkPoint {
  lat: number;
  lng: number;
  name?: string;
  description?: string;
  sourceUrl?: string;
  poiId?: string;
  /** id категорий из PoiCategory — по ним основной продукт восстановит иконку/цвет */
  categoryIds?: string[];
  buildingHistoryId?: number;
}

export interface SharedWalkRoute {
  legs?: Array<{
    fromIndex: number;
    toIndex: number;
    geometry: Array<[number, number]>;
    distanceMeters: number;
    durationSeconds: number;
  }>;
  geometry: Array<[number, number]>;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

export interface SharedWalk {
  version: typeof SHARED_WALK_VERSION;
  id: string;
  title: string;
  createdAt: string;
  points: SharedWalkPoint[];
  route?: SharedWalkRoute;
}

export function encodeSharedWalk(walk: SharedWalk): string {
  const bytes = new TextEncoder().encode(JSON.stringify(walk));
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSharedWalk(encoded: string): SharedWalk | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SharedWalk;
    return parsed.version === SHARED_WALK_VERSION ? parsed : null;
  } catch {
    return null;
  }
}
