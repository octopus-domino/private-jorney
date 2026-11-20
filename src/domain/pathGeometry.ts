import type { GeoPoint } from './walkGraph';
import type { TrackPoint } from './RecordedWalk';
import { haversineMeters } from '../shared/geo';

const METERS_PER_DEGREE = 111320;
export const MAX_GPS_GAP_MS = 120000;
export interface Projection extends GeoPoint { distance: number; fraction: number; cross: number }

/** Projects locally in meters, preserving the sign needed to distinguish the left and right sides. */
export function projectToSegment(point: GeoPoint, start: GeoPoint, end: GeoPoint): Projection {
  const scale = METERS_PER_DEGREE * Math.cos(start.lat * Math.PI / 180);
  const dx = (end.lng - start.lng) * scale, dy = (end.lat - start.lat) * METERS_PER_DEGREE;
  const x = (point.lng - start.lng) * scale, y = (point.lat - start.lat) * METERS_PER_DEGREE;
  const fraction = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)));
  return { lat: start.lat + (end.lat - start.lat) * fraction, lng: start.lng + (end.lng - start.lng) * fraction,
    fraction, distance: Math.hypot(x - dx * fraction, y - dy * fraction), cross: dx * y - dy * x };
}

/** Finds the first closest encounter while leaving real loops and revisits in the recorded geometry intact. */
export function locateAlongPath(point: GeoPoint, path: GeoPoint[]) {
  let progress = 0;
  let best: (Projection & { progress: number; side: 'left' | 'right' | 'nearby' }) | null = null;
  for (let index = 1; index < path.length; index++) {
    const projection = projectToSegment(point, path[index - 1], path[index]);
    const length = haversineMeters(path[index - 1], path[index]);
    if (!best || projection.distance < best.distance - 1) best = { ...projection, progress: progress + length * projection.fraction,
      side: projection.distance < 8 ? 'nearby' : projection.cross > 0 ? 'left' : 'right' };
    progress += length;
  }
  return best;
}

/** Removes isolated lateral GPS drift only where several neighbouring fixes support a straight course. */
export function correctTrackJitter(points: TrackPoint[]): TrackPoint[] {
  return points.map((point, index) => {
    const before = points[index - 1], after = points[index + 1];
    const first = points[index - 2], last = points[index + 2];
    if (!first || !last || point.accuracy < 10 || last.timestamp - first.timestamp > 120000) return point;
    const baseline = projectToSegment(point, first, last);
    const leading = projectToSegment(before, first, last), trailing = projectToSegment(after, first, last);
    const projection = projectToSegment(point, before, after);
    if (leading.distance > 5 || trailing.distance > 5 || baseline.fraction <= leading.fraction
      || baseline.fraction >= trailing.fraction || projection.fraction < 0.1 || projection.fraction > 0.9
      || projection.distance < 6 || projection.distance > Math.min(30, point.accuracy)) return point;
    return { ...point, lat: projection.lat, lng: projection.lng };
  });
}

/** Spatial thinning bounds post-walk CPU work while retaining corners and chronological order. */
export function thinTrack(points: TrackPoint[], minimumDistance = 10, maximum = 600): TrackPoint[] {
  if (points.length <= 2) return points.slice();
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    if (haversineMeters(result.at(-1)!, points[index]) >= minimumDistance) result.push(points[index]);
  }
  result.push(points.at(-1)!);
  if (result.length <= maximum) return result;
  return Array.from({ length: maximum }, (_, index) => result[Math.round(index * (result.length - 1) / (maximum - 1))]);
}

/** Detects a genuine return after walking a meaningful distance rather than counting stationary GPS jitter as a loop. */
export function countRevisits(path: GeoPoint[]): number {
  const visited = new Map<string, number>();
  let distance = 0, lastLoop = -Infinity, loops = 0;
  for (let index = 0; index < path.length; index++) {
    if (index) distance += haversineMeters(path[index - 1], path[index]);
    const point = path[index], key = `${point.lat.toFixed(4)}:${point.lng.toFixed(4)}`;
    const previous = visited.get(key);
    if (previous !== undefined && distance - previous > 180 && distance - lastLoop > 180) { loops++; lastLoop = distance; }
    if (previous === undefined) visited.set(key, distance);
  }
  return loops;
}
