import type { PoiRepository } from '../ports/PoiRepository';
import type { PlaceHistoryRepository } from '../ports/PlaceHistoryRepository';
import type { Geocoder } from '../ports/Geocoder';
import type { Poi } from '../../domain/Poi';
import type { RecordedPlace, RecordedWalk, TrackPoint } from '../../domain/RecordedWalk';
import { WalkGraph, type RoadWay } from '../../domain/walkGraph';
import { WalkMapMatcher } from '../../domain/walkMapMatcher';
import { correctTrackJitter, countRevisits, locateAlongPath, thinTrack } from '../../domain/pathGeometry';
import { walkParagraphs, walkPreview } from '../../domain/walkStory';
import { haversineMeters } from '../../shared/geo';
import { SEARCH_TIMEOUT_MS } from './areaSearchSession';
import { hasRecordedMovement, recordedWalkPath } from '../../domain/walkPreview';
import { placesInSection, walkSections } from '../../domain/walkSections';

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
    const sampled = thinTrack(correctTrackJitter(walk.points));
    const found = new Map([...walk.places.map(place => place.poi), ...known].map(point => [point.id, point]));
    let result: RecordedWalk = { ...walk, status: 'partial' };
    const describe = () => {
      result = this.describe({ ...result, places: this.selectPlaces(this.locate([...found.values()], result), result) });
      return result;
    };
    // Publish the offline report before starting any optional requests.
    await save(describe());
    let pending = Promise.resolve();
    let writeError: unknown;
    const publish = () => {
      const snapshot = describe();
      pending = pending.then(() => save(snapshot)).catch(error => { writeError ??= error; });
    };
    const geometry = this.match(walk, sampled).then(matched => {
      result = { ...result, matchedPath: matched.matchedPath, graph: matched.graph, sections: matched.sections };
      publish();
    }).catch(error => console.info('Walking graph unavailable; preserving GPS', error));
    const city = this.timed(signal => this.geocoder.reverse(sampled[0].lat, sampled[0].lng, signal)).then(value => {
      if (!value.city) return;
      result = { ...result, city: value.city, title: `${value.city} · Прогулка ${new Date(result.startedAt).toLocaleDateString('ru-RU')}` };
      publish();
    }).catch(error => console.info('Recording city unavailable', error));
    const discovery = this.discover(sampled, points => {
      let added = false;
      for (const point of points) {
        if (found.get(point.id) === point) continue;
        found.set(point.id, point);
        added = true;
      }
      if (added) publish();
    });
    const [, , complete] = await Promise.all([geometry, city, discovery]);
    await pending;
    if (writeError) throw writeError;
    return this.enrichDetails(result, complete, save);
  }

  private async enrichDetails(walk: RecordedWalk, complete: boolean, save: (walk: RecordedWalk) => Promise<void>) {
    const places = walk.places.slice();
    let detailsComplete = true;
    const deadline = Date.now() + 35000;
    for (const [index, place] of places.entries()) {
      if (place.history || !this.history.supports(place.poi)) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) { detailsComplete = false; break; }
      const history = await this.timed(signal => this.history.lookup(place.poi, signal), Math.min(remaining, LOOKUP_TIMEOUT_MS))
        .catch(error => {
          detailsComplete = false;
          console.info('Recording place details unavailable', place.poi.id, error);
          return null;
        });
      if (history) {
        places[index] = { ...place, history };
        await save(this.describe({ ...walk, places: places.slice() }));
      }
    }
    const matched = !hasRecordedMovement(walk.points) ||
      !!walk.graph && walk.graph.matchedSamples >= walk.graph.sourceSamples * 0.8;
    return this.describe({ ...walk, places, status: complete && detailsComplete && matched ? 'ready' : 'partial' });
  }

  private async match(walk: RecordedWalk, points: TrackPoint[]): Promise<RecordedWalk> {
    if (!hasRecordedMovement(points)) return walk;
    const ways = await this.timed(signal => this.corridor.roads(points, signal), 45000);
    const graph = new WalkGraph(ways);
    const match = new WalkMapMatcher(graph, points[0].lat).match(points);
    if (walk.graph && walk.graph.matchedSamples > match.matchedSamples) return walk;
    return { ...walk, matchedPath: match.path, graph: { matchedSamples: match.matchedSamples,
      sourceSamples: points.length, crossings: countRevisits(match.path) },
      sections: walkSections(match.path, match.steps) };
  }

  private async discover(points: TrackPoint[], update: (points: Poi[]) => void) {
    // Six cached neighbourhood lookups cap load even for a day-long walk; the report states partial coverage.
    const anchors = thinTrack(points, 350, 6);
    try {
      return await this.timed(async signal => {
        let complete = true;
        for (const anchor of anchors) {
          if (signal.aborted) return false;
          try {
            const result = await this.places.search({ anchors: [anchor], radiusMeters: 350,
              categoryIds: ['historical-house', 'cultural', 'attractions'], signal,
              onPartial: points => { if (!signal.aborted) update(points); } });
            if (!signal.aborted) update(result);
          } catch (error) {
            complete = false;
            console.info('Recording discovery incomplete', error);
          }
        }
        return complete && points.every(point => anchors.some(anchor => haversineMeters(point, anchor) <= 350));
      }, SEARCH_TIMEOUT_MS);
    } catch { return false; }
  }

  private locate(points: Poi[], walk: RecordedWalk): RecordedPlace[] {
    const path = recordedWalkPath(walk);
    const previous = new Map(walk.places.map(place => [place.poi.id, place]));
    return points.flatMap(poi => {
      const position = hasRecordedMovement(walk.points) ? locateAlongPath(poi, path)
        : { distance: haversineMeters(poi, walk.points[0]), progress: 0, side: 'nearby' as const };
      if (!position || position.distance > 65 || walk.sections?.some(section => section.gpsGap &&
        position.progress >= section.startMeters && position.progress < section.endMeters)) return [];
      const nearest = walk.points.reduce((best, point) => Math.abs(point.lat - poi.lat) + Math.abs(point.lng - poi.lng)
        < Math.abs(best.lat - poi.lat) + Math.abs(best.lng - poi.lng) ? point : best);
      return [{ poi, progressMeters: position.progress, side: nearest.accuracy > 25 ? 'nearby' as const : position.side,
        history: previous.get(poi.id)?.history, photoDataUrl: previous.get(poi.id)?.photoDataUrl }];
    }).sort((a, b) => a.progressMeters - b.progressMeters);
  }

  private selectPlaces(places: RecordedPlace[], walk: RecordedWalk): RecordedPlace[] {
    const sections = walk.sections ?? walkSections(recordedWalkPath(walk));
    if (places.length <= MAX_DETAILED_PLACES || sections.length < 2) return places.slice(0, MAX_DETAILED_PLACES);
    const sectionsPlaces = sections.map((section, index) => placesInSection(places, section, index === sections.length - 1)
      .sort((a, b) => Number(b.poi.source === 'historical-house') - Number(a.poi.source === 'historical-house')));
    const selected: RecordedPlace[] = [];
    for (let round = 0; selected.length < MAX_DETAILED_PLACES; round++) {
      const additions = sectionsPlaces.flatMap(list => list[round] ? [list[round]] : []);
      if (!additions.length) break;
      selected.push(...additions.slice(0, MAX_DETAILED_PLACES - selected.length));
    }
    return selected.sort((a, b) => a.progressMeters - b.progressMeters);
  }

  private describe(walk: RecordedWalk): RecordedWalk {
    const path = recordedWalkPath(walk);
    const sections = hasRecordedMovement(walk.points) ? walk.sections ?? walkSections(path) : [];
    return { ...walk, sections, paragraphs: walkParagraphs(walk), previewSvg: walkPreview(path, sections) };
  }

  private async timed<T>(action: (signal: AbortSignal) => Promise<T>, timeout = LOOKUP_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new DOMException('Timed out', 'TimeoutError')); }, timeout);
    });
    try { return await Promise.race([action(controller.signal), expired]); }
    finally { clearTimeout(timer); }
  }
}
