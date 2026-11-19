import type { RecordedWalk } from './RecordedWalk';
import type { GeoPoint } from './walkGraph';
import { haversineMeters } from '../shared/geo';
import { thinTrack } from './pathGeometry';

const WIDTH = 640, HEIGHT = 360, PADDING = 35;
const METERS_PER_DEGREE = 111320, MIN_VIEW_METERS = 100, SAME_PLACE_METERS = 8;

/** Uses the whole recording, so a real walk returning to its start is never mistaken for a stop. */
export function hasRecordedMovement(path: GeoPoint[]): boolean {
  return path.length > 1 && path.some(point => haversineMeters(path[0], point) > SAME_PLACE_METERS);
}

/** Old archives also get corrected previews; empty matched geometry never hides the original GPS journal. */
export function recordedWalkPath(walk: Pick<RecordedWalk, 'points' | 'matchedPath'>): GeoPoint[] {
  return hasRecordedMovement(walk.points) && walk.matchedPath?.length
    ? walk.matchedPath : thinTrack(walk.points);
}

/** A self-contained offline fallback, centred in both axes and without stretching GPS jitter into a route. */
export function walkPreview(path: GeoPoint[]): string {
  const start = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" rx="24" fill="#eef2eb"/>`;
  if (!path.length) return start + '<text x="320" y="180" text-anchor="middle" fill="#365849">Нет GPS-точек</text></svg>';
  const coordinates = project(path);
  if (!hasRecordedMovement(path)) return start + marker(320, 180, false)
    + '<text x="320" y="225" text-anchor="middle" fill="#365849" font-size="16">Перемещение не зафиксировано</text></svg>';
  const first = coordinates[0], last = coordinates.at(-1)!;
  const closed = haversineMeters(path[0], path.at(-1)!) <= SAME_PLACE_METERS;
  return start + `<path d="M${coordinates.map(point => point.join(',')).join(' L')}" fill="none" stroke="#317559" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    + marker(first[0], first[1], closed) + (closed ? '' : `<circle cx="${last[0]}" cy="${last[1]}" r="7" fill="#ca8349" stroke="white" stroke-width="3"/>`) + '</svg>';
}

function marker(x: number, y: number, closed: boolean): string {
  return `<circle cx="${x}" cy="${y}" r="9" fill="#317559" stroke="white" stroke-width="3"/>`
    + (closed ? `<circle cx="${x}" cy="${y}" r="4" fill="#ca8349"/>` : '');
}

function project(path: GeoPoint[]): number[][] {
  const longitudeScale = Math.max(.0001, Math.cos(path[0].lat * Math.PI / 180));
  const xs = path.map(point => (point.lng - path[0].lng) * longitudeScale * METERS_PER_DEGREE);
  const ys = path.map(point => (path[0].lat - point.lat) * METERS_PER_DEGREE);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((WIDTH - PADDING * 2) / Math.max(maxX - minX, MIN_VIEW_METERS),
    (HEIGHT - PADDING * 2) / Math.max(maxY - minY, MIN_VIEW_METERS));
  return path.map((_, i) => [+(WIDTH / 2 + (xs[i] - (minX + maxX) / 2) * scale).toFixed(1),
    +(HEIGHT / 2 + (ys[i] - (minY + maxY) / 2) * scale).toFixed(1)]);
}
