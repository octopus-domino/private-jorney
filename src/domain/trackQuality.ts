import type { TrackPoint } from './RecordedWalk';
import { haversineMeters } from '../shared/geo';

const MAX_ACCURACY_METERS = 45;
const MAX_AGE_MS = 60000;
const MAX_SPEED_METERS_PER_SECOND = 8;

/** Mirrors the native acceptance policy for browser recording and imported/raw journal validation. */
export function acceptsTrackPoint(point: TrackPoint, previous?: TrackPoint, now = Date.now()): boolean {
  if (![point.lat, point.lng, point.accuracy, point.timestamp].every(Number.isFinite)) return false;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180 || point.accuracy < 0 || point.accuracy > MAX_ACCURACY_METERS) return false;
  if (now - point.timestamp > MAX_AGE_MS || point.timestamp > now + 5000) return false;
  if (!previous) return true;
  const seconds = (point.timestamp - previous.timestamp) / 1000;
  if (seconds <= 0) return false;
  const distance = haversineMeters(previous, point);
  return distance >= Math.max(6, point.accuracy * 0.35) && distance / seconds <= MAX_SPEED_METERS_PER_SECOND;
}
