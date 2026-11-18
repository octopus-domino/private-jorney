import { haversineMeters } from '../../shared/geo';

interface Point { lat: number; lng: number }
export interface CitywallsPoint extends Point { id: number; title: string }

// Grid used by map_common.js on Citywalls map_around.html.
export function citywallsSquares(point: Point): number[] {
  if (point.lng < 29.358812 || point.lng > 31.116664 || point.lat < 59.528247 || point.lat > 60.276671) return [];
  const squares = new Set<number>();
  for (const lat of [point.lat - 0.00055, point.lat, point.lat + 0.00055]) {
    for (const lng of [point.lng - 0.0011, point.lng, point.lng + 0.0011]) {
      const x = Math.min(9, Math.max(0, Math.floor((lng - 29.358812) / 0.175785)));
      const y = Math.min(9, Math.max(0, Math.floor((lat - 59.528247) / 0.074842)));
      squares.add(y * 10 + x);
    }
  }
  return [...squares];
}

export function parseCitywallsPoints(data: unknown): CitywallsPoint[] {
  if (!data || typeof data !== 'object' || !('features' in data) || !Array.isArray(data.features)) throw new Error('Invalid Citywalls geodata');
  const points: CitywallsPoint[] = [];
  for (const feature of data.features) {
    const geometries: unknown = feature?.geometry?.geometries;
    if (!Array.isArray(geometries)) continue;
    for (const raw of geometries) {
      if (raw?.type !== 'Point' || !Array.isArray(raw.coordinates)) continue;
      const [lng, lat] = raw.coordinates.map(Number);
      const id = Number(raw.id);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isInteger(id) || id <= 0) continue;
      points.push({ id, lat, lng, title: String(raw.title ?? '') });
    }
  }
  return points;
}

export function matchCitywallsPoint(point: Point, points: CitywallsPoint[]): CitywallsPoint | null {
  const unique = [...new Map(points.map((p) => [p.id, p])).values()];
  const nearby = unique.map((p) => ({ point: p, distance: haversineMeters(point, p) }))
    .filter((p) => p.distance <= 60).sort((a, b) => a.distance - b.distance);
  if (!nearby.length || (nearby[1] && nearby[1].distance - nearby[0].distance < 15)) return null;
  return nearby[0].point;
}
