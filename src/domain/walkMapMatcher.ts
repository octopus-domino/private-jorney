import type { TrackPoint } from './RecordedWalk';
import { WalkGraph, type GeoPoint, type GraphEdge, type GraphPath } from './walkGraph';
import { RoadSpatialIndex, type RoadCandidate } from './roadSpatialIndex';
import { haversineMeters } from '../shared/geo';
import { MAX_GPS_GAP_MS, projectToSegment } from './pathGeometry';

interface Transition { distance: number; via: string[]; edge?: GraphEdge }
interface State { candidate: RoadCandidate; cost: number; previous: number; transition: Transition | null }
export interface WalkStep { start: GeoPoint; end: GeoPoint; street?: string; endStreets: string[]; gpsGap?: boolean }
const MAX_TRANSITION_METERS = 1500;

/** Viterbi matches a chronological observation sequence instead of shortcutting a whole walk. */
export class WalkMapMatcher {
  private readonly index: RoadSpatialIndex;

  constructor(private readonly graph: WalkGraph, latitude: number) {
    this.index = new RoadSpatialIndex(graph, latitude);
  }

  /** Missing streets and long GPS gaps retain their original observations. */
  match(points: TrackPoint[]): { path: GeoPoint[]; steps: WalkStep[]; matchedSamples: number } {
    if (!points.length) return { path: [], steps: [], matchedSamples: 0 };
    const layers: State[][] = [];
    for (let i = 0; i < points.length; i++) {
      const beforeGap = points[i + 1] && points[i + 1].timestamp - points[i].timestamp > MAX_GPS_GAP_MS;
      const afterGap = i > 0 && points[i].timestamp - points[i - 1].timestamp > MAX_GPS_GAP_MS;
      const candidates = beforeGap || afterGap
        ? [{ ...points[i], edge: null, fraction: 0, distance: 0 }]
        : this.index.candidates(points[i], points[i].accuracy);
      layers.push(candidates.map(candidate => this.state(candidate, points, i, layers[i - 1])));
    }
    return this.restore(layers, points);
  }

  private state(candidate: RoadCandidate, points: TrackPoint[], i: number, previous?: State[]): State {
    const emission = candidate.edge ? candidate.distance ** 2 / (2 * Math.max(candidate.edge.sidewalk ? 15 : 10, points[i].accuracy) ** 2)
      + this.headingPenalty(candidate.edge, points[i], [points[i - 1], points[i + 1]]) : 5;
    if (!previous) return { candidate, cost: emission, previous: -1, transition: null };
    const observed = haversineMeters(points[i - 1], points[i]);
    const gap = points[i].timestamp - points[i - 1].timestamp > MAX_GPS_GAP_MS;
    const options = previous.map((state, index) => {
      const transition = gap ? null : this.transition(state.candidate, candidate, observed);
      const penalty = gap ? 0 : transition ? this.transitionCost(state.candidate, candidate, observed, transition) : Infinity;
      return { candidate, previous: index, cost: state.cost + emission + penalty, transition };
    });
    return options.reduce((best, state) => state.cost < best.cost ? state : best);
  }

  private transitionCost(a: RoadCandidate, b: RoadCandidate, observed: number, transition: Transition): number {
    return Math.abs(transition.distance - observed) / Math.max(15, observed * 0.3)
      + this.crossingPenalty(a, b, transition);
  }

  private crossingPenalty(a: RoadCandidate, b: RoadCandidate, transition: Transition): number {
    const crossingCount = this.crossingCount(transition.via);
    // A brief excursion across a mapped crossing and back costs more than a noisy fix.
    if (crossingCount) return 2 * crossingCount;
    if (Boolean(a.edge?.crossing) !== Boolean(b.edge?.crossing)) return 2;
    if (!a.edge?.sidewalk || !b.edge?.sidewalk || a.edge.id === b.edge.id) return 0;
    const scale = Math.cos(a.lat * Math.PI / 180);
    const ax = (a.edge.end.lng - a.edge.start.lng) * scale, ay = a.edge.end.lat - a.edge.start.lat;
    const bx = (b.edge.end.lng - b.edge.start.lng) * scale, by = b.edge.end.lat - b.edge.start.lat;
    if (Math.abs(ax * bx + ay * by) < Math.hypot(ax, ay) * Math.hypot(bx, by) * 0.85) return 0;
    const streetLength = Math.max(10, a.edge.length);
    const offset = Math.abs(projectToSegment(b, a.edge.start, a.edge.end).cross) / streetLength;
    const reverse = Math.abs(projectToSegment(a, b.edge.start, b.edge.end).cross) / Math.max(10, b.edge.length);
    if (Math.min(offset, reverse) < 8) return 0;
    return 5;
  }

  private crossingCount(nodes: string[]): number {
    return nodes.filter((node, index) => index > 0 && this.graph.edgeBetween(nodes[index - 1], node)?.crossing).length;
  }

  private headingPenalty(edge: GraphEdge, point: TrackPoint, neighbours: (TrackPoint | undefined)[]): number {
    const scale = Math.cos(point.lat * Math.PI / 180);
    const x = (edge.end.lng - edge.start.lng) * scale, y = edge.end.lat - edge.start.lat;
    const alignment = neighbours.flatMap(other => {
      if (!other || Math.abs(other.timestamp - point.timestamp) > MAX_GPS_GAP_MS
        || haversineMeters(other, point) < Math.max(12, point.accuracy, other.accuracy)) return [];
      const dx = (other.lng - point.lng) * scale, dy = other.lat - point.lat;
      return [Math.min(1, ((dx * x + dy * y) / (Math.hypot(dx, dy) * Math.hypot(x, y))) ** 2)];
    });
    return alignment.length ? 0.65 * (1 - Math.max(...alignment)) : 0;
  }

  private transition(a: RoadCandidate, b: RoadCandidate, observed: number): Transition | null {
    if (!a.edge || !b.edge) return { distance: haversineMeters(a, b), via: [] };
    const limit = Math.min(MAX_TRANSITION_METERS, Math.max(120, observed * 3 + 100));
    if (a.edge.id === b.edge.id && this.sameEdgeAllowed(a, b))
      return { distance: Math.abs(a.fraction - b.fraction) * a.edge.length, via: [], edge: a.edge };
    let best: Transition | null = null;
    let cost = Infinity;
    for (const start of this.endpoints(a, true)) for (const end of this.endpoints(b, false)) {
      const budget = limit - start.offset - end.offset;
      const direct = this.graph.shortestPath(start.node, end.node, budget);
      const withoutCrossing = direct && this.crossingCount(direct.nodes) > 0
        ? this.graph.shortestPath(start.node, end.node, budget, false) : null;
      for (const route of [direct, withoutCrossing]) {
        if (!route || this.retracesPartialEdge(route, start, end)) continue;
        const candidate = { distance: start.offset + route.distance + end.offset, via: route.nodes };
        const score = this.transitionCost(a, b, observed, candidate);
        if (score < cost) { cost = score; best = candidate; }
      }
    }
    return best;
  }

  private retracesPartialEdge(path: GraphPath, start: { offset: number; other: string }, end: { offset: number; other: string }) {
    return start.offset > 0.1 && path.nodes[1] === start.other
      || end.offset > 0.1 && path.nodes.at(-2) === end.other;
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
      { node: edge.from, other: edge.to, offset: point.fraction * edge.length, allowed: outgoing ? reverse : forward },
      { node: edge.to, other: edge.from, offset: (1 - point.fraction) * edge.length, allowed: outgoing ? forward : reverse },
    ].filter(endpoint => endpoint.allowed);
  }

  private restore(layers: State[][], points: TrackPoint[]) {
    const states: State[] = [];
    let index = layers.at(-1)!.reduce((best, state, i, layer) => state.cost < layer[best].cost ? i : best, 0);
    for (let i = layers.length - 1; i >= 0; i--) { const state = layers[i][index]; states[i] = state; index = state.previous; }
    const path = [this.coordinate(states[0].candidate)];
    const steps: WalkStep[] = [];
    const append = (end: GeoPoint, edge?: GraphEdge, node?: string, gpsGap?: boolean) => {
      const start = path.at(-1)!;
      const endStreets = node ? this.graph.streetsAt(node) : [];
      if (haversineMeters(start, end) > 0.1) {
        steps.push({ start, end, street: edge?.street, endStreets, gpsGap });
        path.push(end);
      } else if (steps.length && endStreets.length) {
        const last = steps.at(-1)!;
        last.endStreets = [...new Set([...last.endStreets, ...endStreets])];
      }
    };
    for (let i = 1; i < states.length; i++) {
      const previous = states[i - 1].candidate;
      const { candidate, transition } = states[i];
      if (!transition) {
        append(this.coordinate(points[i - 1]));
        append(this.coordinate(points[i]), undefined, undefined, true);
      }
      transition?.via.forEach((node, j) => append(this.graph.nodes.get(node)!,
        j ? this.graph.edgeBetween(transition.via[j - 1], node) : previous.edge ?? undefined, node));
      const edge = transition?.via.length ? candidate.edge ?? undefined : transition?.edge;
      const node = candidate.fraction === 0 ? candidate.edge?.from : candidate.fraction === 1 ? candidate.edge?.to : undefined;
      append(this.coordinate(candidate), edge, transition ? node : undefined);
    }
    return { path, steps,
      matchedSamples: states.filter(state => state.candidate.edge).length };
  }

  private coordinate({ lat, lng }: GeoPoint): GeoPoint { return { lat, lng }; }
}
