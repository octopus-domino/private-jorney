import type { RecordedPlace, RecordedWalkSection } from './RecordedWalk';
import type { WalkStep } from './walkMapMatcher';
import type { GeoPoint } from './walkGraph';
import { haversineMeters } from '../shared/geo';
import { MAX_GPS_GAP_MS, projectToSegment } from './pathGeometry';

const START = 'Место выхода';
const FINISH = 'Финиш';
const TURN = 'Поворот';
const GPS_GAP = 'Разрыв GPS';
const MIN_TURN_LEG_METERS = 8;

/** Builds blocks in travel order and names intersections only at verified shared road nodes. */
export function walkSections(path: GeoPoint[], matched?: WalkStep[]): RecordedWalkSection[] {
  const steps: WalkStep[] = matched?.length ? matched : path.slice(1).map((end, index) => ({
    start: path[index], end, endStreets: [], gpsGap: hasGap(path[index], end),
  }));
  const result: RecordedWalkSection[] = [];
  let from = START, startMeters = 0, progress = 0;
  let street: string | undefined;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index], next = steps[index + 1];
    const length = haversineMeters(step.start, step.end);
    progress += length;
    street ??= step.street;
    const boundary = next ? sectionBoundary(step, next, length) : FINISH;
    if (!boundary || progress - startMeters < 1) continue;
    result.push({ from, to: boundary, street, startMeters, endMeters: progress, gpsGap: step.gpsGap || undefined });
    from = boundary;
    startMeters = progress;
    street = undefined;
  }
  return result;
}

function hasGap(start: GeoPoint, end: GeoPoint): boolean {
  return 'timestamp' in start && 'timestamp' in end && typeof start.timestamp === 'number' &&
    typeof end.timestamp === 'number' && end.timestamp - start.timestamp > MAX_GPS_GAP_MS;
}

function sectionBoundary(step: WalkStep, next: WalkStep, length: number): string | undefined {
  if (step.gpsGap || next.gpsGap) return GPS_GAP;
  if (step.endStreets.length > 1) return step.endStreets.join(' × ');
  if (step.street && next.street && step.street !== next.street) return TURN;
  if (length < MIN_TURN_LEG_METERS || haversineMeters(next.start, next.end) < MIN_TURN_LEG_METERS) return undefined;
  // The point must extend behind the corner's incoming direction or depart appreciably to its side.
  const chord = projectToSegment(step.end, step.start, next.end);
  return chord.distance > Math.min(length, haversineMeters(next.start, next.end)) * 0.6 ? TURN : undefined;
}

/** Assigns each encounter to exactly one block, including an encounter right at an intersection. */
export function placesInSection(places: RecordedPlace[], section: RecordedWalkSection, last: boolean) {
  if (section.gpsGap) return [];
  return places.filter(place => place.progressMeters >= section.startMeters &&
    (place.progressMeters < section.endMeters || last && place.progressMeters <= section.endMeters + 1));
}

/** Splits the line at measurement gaps while retaining a dashed link for orientation. */
export function walkPathSpans(path: GeoPoint[], sections: RecordedWalkSection[]): { start: number; end: number; gap: boolean }[] {
  if (path.length < 2) return [];
  const gaps = sections.filter(section => section.gpsGap);
  if (!gaps.length) return [{ start: 0, end: path.length - 1, gap: false }];
  let progress = 0, gapIndex = 0;
  const spans: { start: number; end: number; gap: boolean }[] = [];
  for (let index = 1; index < path.length; index++) {
    const distance = haversineMeters(path[index - 1], path[index]);
    const middle = progress + distance / 2;
    while (gapIndex < gaps.length && gaps[gapIndex].endMeters <= middle) gapIndex++;
    const gap = gapIndex < gaps.length && gaps[gapIndex].startMeters <= middle;
    const previous = spans.at(-1);
    if (previous?.gap === gap) previous.end = index;
    else spans.push({ start: index - 1, end: index, gap });
    progress += distance;
  }
  return spans;
}

export function walkDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} км` : `${Math.round(meters)} м`;
}
