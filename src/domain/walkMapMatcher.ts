import type { TrackPoint } from './RecordedWalk';
import { WalkGraph, type GeoPoint } from './walkGraph';
import { RoadSpatialIndex, type RoadCandidate } from './roadSpatialIndex';
import { haversineMeters } from '../shared/geo';

interface Transition { distance: number; via: GeoPoint[] }
interface State { candidate: RoadCandidate; cost: number; previous: number; via: GeoPoint[] }
const MAX_TRANSITION_METERS = 1500;
const MAX_GAP_MS = 120000;

/** Viterbi matches a chronological observation sequence instead of shortcutting a whole walk. */
export class WalkMapMatcher {
  private readonly index: RoadSpatialIndex;

  constructor(private readonly graph: WalkGraph, latitude: number) {
    this.index = new RoadSpatialIndex(graph, latitude);
  }

  /** Missing streets and long GPS gaps retain their original observations. */
  match(points: TrackPoint[]): { path: GeoPoint[]; matchedSamples: number } {
    if (!points.length) return { path: [], matchedSamples: 0 };
    const layers: State[][] = [];
    for (let i = 0; i < points.length; i++) {
      const candidates = this.index.candidates(points[i], points[i].accuracy);
      layers.push(candidates.map(candidate => this.state(candidate, points, i, layers[i - 1])));
    }
    return this.restore(layers);
  }

  private state(candidate: RoadCandidate, points: TrackPoint[], i: number, previous?: State[]): State {
    const emission = candidate.edge ? candidate.distance ** 2 / (2 * Math.max(8, points[i].accuracy) ** 2) : 5;
    if (!previous) return { candidate, cost: emission, previous: -1, via: [] };
    const observed = haversineMeters(points[i - 1], points[i]);
    const gap = points[i].timestamp - points[i - 1].timestamp > MAX_GAP_MS;
    const options = previous.map((state, index) => {
      const transition = gap ? null : this.transition(state.candidate, candidate, observed);
      const penalty = gap ? 0 : transition ? Math.abs(transition.distance - observed) / Math.max(15, observed * 0.3) : 30;
      return { candidate, previous: index, cost: state.cost + emission + penalty, via: transition?.via ?? [] };
    });
    return options.reduce((best, state) => state.cost < best.cost ? state : best);
  }

  private transition(a: RoadCandidate, b: RoadCandidate, observed: number): Transition | null {
    if (!a.edge || !b.edge) return { distance: haversineMeters(a, b), via: [] };
    const limit = Math.min(MAX_TRANSITION_METERS, Math.max(120, observed * 3 + 100));
    const options: Transition[] = [];
    if (a.edge.id === b.edge.id && this.sameEdgeAllowed(a, b))
      options.push({ distance: Math.abs(a.fraction - b.fraction) * a.edge.length, via: [] });
    for (const start of this.endpoints(a, true)) for (const end of this.endpoints(b, false)) {
      const path = this.graph.shortestPath(start.node, end.node, limit - start.offset - end.offset);
      if (path) options.push({ distance: start.offset + path.distance + end.offset,
        via: path.nodes.map(node => this.graph.nodes.get(node)!) });
    }
    return options.sort((first, second) => first.distance - second.distance)[0] ?? null;
  }

  private sameEdgeAllowed(a: RoadCandidate, b: RoadCandidate): boolean {
    return b.fraction >= a.fraction ? this.graph.canTravel(a.edge!.from, a.edge!.to)
      : this.graph.canTravel(a.edge!.to, a.edge!.from);
  }

  private endpoints(point: RoadCandidate, outgoing: boolean) {
    const edge = point.edge!;
    const forward = this.graph.canTravel(edge.from, edge.to);
    const reverse = this.graph.canTravel(edge.to, edge.from);
    return [
      { node: edge.from, offset: point.fraction * edge.length, allowed: outgoing ? reverse : forward },
      { node: edge.to, offset: (1 - point.fraction) * edge.length, allowed: outgoing ? forward : reverse },
    ].filter(endpoint => endpoint.allowed);
  }

  private restore(layers: State[][]) {
    const states: State[] = [];
    let index = layers.at(-1)!.reduce((best, state, i, layer) => state.cost < layer[best].cost ? i : best, 0);
    for (let i = layers.length - 1; i >= 0; i--) { const state = layers[i][index]; states.unshift(state); index = state.previous; }
    const path = states.flatMap(state => [...state.via, { lat: state.candidate.lat, lng: state.candidate.lng }]);
    return { path: path.filter((point, i) => !i || haversineMeters(path[i - 1], point) > 0.1),
      matchedSamples: states.filter(state => state.candidate.edge).length };
  }
}
