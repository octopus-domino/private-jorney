import type { PoiRepository } from '../ports/PoiRepository';
import type { PlaceHistoryRepository } from '../ports/PlaceHistoryRepository';
import type { Geocoder } from '../ports/Geocoder';
import type { Poi } from '../../domain/Poi';
import type { RecordedPlace, RecordedWalk, TrackPoint } from '../../domain/RecordedWalk';
import { WalkGraph, type RoadWay } from '../../domain/walkGraph';
import { WalkMapMatcher } from '../../domain/walkMapMatcher';
import { countRevisits, locateAlongPath, thinTrack } from '../../domain/pathGeometry';
import { walkParagraphs, walkPreview } from '../../domain/walkStory';
import { haversineMeters } from '../../shared/geo';
import { SEARCH_TIMEOUT_MS } from './areaSearchSession';
import { hasRecordedMovement, recordedWalkPath } from '../../domain/walkPreview';

interface Corridor { roads(points: TrackPoint[], signal?: AbortSignal): Promise<RoadWay[]> }
const MAX_DETAILED_PLACES = 12;
const LOOKUP_TIMEOUT_MS = 18000;

/** Orchestrates optional sources after durable save. Every dependency is replaceable for offline and regression tests. */
export class RecordedWalkEnricher {
  constructor(private readonly corridor: Corridor, private readonly places: PoiRepository,
    private readonly history: PlaceHistoryRepository, private readonly geocoder: Geocoder) {}

  /** Resolves one corridor and a small set of discovery areas, never one request per GPS fix. */
  async enrich(walk: RecordedWalk, known: Poi[], save: (walk: RecordedWalk) => Promise<void>): Promise<RecordedWalk> {
    if (!walk.points.length) return walk;
    const sampled = thinTrack(walk.points);
    let result = { ...walk, status: 'partial' as RecordedWalk['status'] };
    try { result = await this.match(result, sampled); }
    catch (error) { console.info('Walking graph unavailable; preserving GPS', error); }
    try { result.city = (await this.timed(signal => this.geocoder.reverse(sampled[0].lat, sampled[0].lng, signal))).city; }
    catch (error) { console.info('Recording city unavailable', error); }
    const found = await this.discover(sampled, known);
    result.places = this.locate(found.points, result).slice(0, MAX_DETAILED_PLACES);
    result.title = `${result.city ? `${result.city} · ` : ''}Прогулка ${new Date(result.startedAt).toLocaleDateString('ru-RU')}`;
    await save(this.describe(result));
    let detailsComplete = true;
    for (let index = 0; index < result.places.length; index++) {
      const place = result.places[index];
      if (place.history || !this.history.supports(place.poi)) continue;
      try { place.history = await this.timed(signal => this.history.lookup(place.poi, signal)) ?? undefined; }
      catch (error) { detailsComplete = false; console.info('Recording place details unavailable', place.poi.id, error); }
      if (index % 3 === 2) await save(this.describe(result));
    }
    return this.describe({ ...result, status: found.complete && detailsComplete ? 'ready' : 'partial' });
  }

  private async match(walk: RecordedWalk, points: TrackPoint[]): Promise<RecordedWalk> {
    if (!hasRecordedMovement(points)) return { ...walk, matchedPath: points.map(({ lat, lng }) => ({ lat, lng })) };
    const ways = await this.timed(signal => this.corridor.roads(points, signal), 90000);
    const graph = new WalkGraph(ways);
    const match = new WalkMapMatcher(graph, points[0].lat).match(points);
    return { ...walk, matchedPath: match.path, graph: { matchedSamples: match.matchedSamples,
      sourceSamples: points.length, crossings: countRevisits(match.path) } };
  }

  private async discover(points: TrackPoint[], known: Poi[]) {
    const found: Poi[] = [...known];
    let complete = true;
    // Six cached neighbourhood lookups cap load even for a day-long walk; the report states partial coverage.
    const anchors = thinTrack(points, 350, 6);
    for (const anchor of anchors) {
      try { found.push(...await this.timed(signal => this.places.search({ anchors: [anchor],
        radiusMeters: 350, categoryIds: ['historical-house', 'cultural', 'attractions'], signal,
        onPartial: points => { if (!signal.aborted) found.push(...points); } }), SEARCH_TIMEOUT_MS)); }
      catch (error) { complete = false; console.info('Recording discovery incomplete', error); }
    }
    const covered = points.every(point => anchors.some(anchor => haversineMeters(point, anchor) <= 350));
    return { points: [...new Map(found.map(point => [point.id, point])).values()], complete: complete && covered };
  }

  private locate(points: Poi[], walk: RecordedWalk): RecordedPlace[] {
    const path = walk.matchedPath?.length ? walk.matchedPath : walk.points;
    return points.flatMap(poi => {
      const position = hasRecordedMovement(walk.points) ? locateAlongPath(poi, path)
        : { distance: haversineMeters(poi, walk.points[0]), progress: 0, side: 'nearby' as const };
      if (!position || position.distance > 65) return [];
      const nearest = walk.points.reduce((best, point) => Math.abs(point.lat - poi.lat) + Math.abs(point.lng - poi.lng)
        < Math.abs(best.lat - poi.lat) + Math.abs(best.lng - poi.lng) ? point : best);
      return [{ poi, progressMeters: position.progress, side: nearest.accuracy > 25 ? 'nearby' as const : position.side,
        history: walk.places.find(place => place.poi.id === poi.id)?.history }];
    }).sort((a, b) => a.progressMeters - b.progressMeters);
  }

  private describe(walk: RecordedWalk): RecordedWalk {
    return { ...walk, paragraphs: walkParagraphs(walk), previewSvg: walkPreview(recordedWalkPath(walk)) };
  }

  private async timed<T>(action: (signal: AbortSignal) => Promise<T>, timeout = LOOKUP_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try { return await action(controller.signal); }
    finally { clearTimeout(timer); }
  }
}
