import type { TrackPoint } from './RecordedWalk';
import { haversineMeters } from '../shared/geo';
import { correctTrackJitter } from './pathGeometry';

export const walkSpeedLegend = [
  { id: 'slow', color: '#1565c0', label: 'До 2 км/ч' },
  { id: 'easy', color: '#00846d', label: '2–4 км/ч' },
  { id: 'steady', color: '#a95b00', label: '4–6 км/ч' },
  { id: 'fast', color: '#a42a61', label: 'От 6 км/ч' },
  { id: 'unknown', color: '#657174', label: 'Недостаточно данных' },
] as const;

export type WalkSpeedBand = typeof walkSpeedLegend[number]['id'];

export interface WalkSpeedSpan {
  band: WalkSpeedBand;
  points: TrackPoint[];
}

function intervalSpeed(start: TrackPoint, end: TrackPoint): number | null {
  const seconds = (end.timestamp - start.timestamp) / 1000;
  const uncertainty = Math.max(start.accuracy, end.accuracy);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 45 ||
      !Number.isFinite(uncertainty) || uncertainty < 0 || uncertainty > 35) return null;
  const metres = haversineMeters(start, end);
  const speed = metres / seconds;
  if (!Number.isFinite(speed) || speed > 5 || metres < Math.max(3, uncertainty * .35)) return null;
  return speed * 3.6;
}

function band(speed: number): WalkSpeedBand {
  if (speed < 2) return 'slow';
  if (speed < 4) return 'easy';
  if (speed < 6) return 'steady';
  return 'fast';
}

/** Estimates speed from timed observations, leaving uncertain intervals explicitly unclassified. */
export function walkSpeedSpans(observations: TrackPoint[]): WalkSpeedSpan[] {
  const points = correctTrackJitter(observations);
  const speeds = points.slice(1).map((point, index) => intervalSpeed(points[index], point));
  const spans: WalkSpeedSpan[] = [];
  speeds.forEach((speed, index) => {
    const previous = speeds[index - 1], next = speeds[index + 1];
    // Median smoothing uses contiguous, valid neighbours and never fills a measurement gap.
    const estimate = speed == null ? null : previous == null || next == null
      ? speed : [previous, speed, next].sort((a, b) => a - b)[1];
    const category = estimate == null ? 'unknown' : band(estimate);
    const span = spans.at(-1);
    if (span?.band === category) span.points.push(points[index + 1]);
    else spans.push({ band: category, points: [points[index], points[index + 1]] });
  });
  return spans;
}
