import type { GeoPoint, GraphEdge, WalkGraph } from './walkGraph';
import { projectToSegment } from './pathGeometry';

export interface RoadCandidate extends GeoPoint { edge: GraphEdge | null; fraction: number; distance: number }
const CELL_METERS = 80;
const MAX_CANDIDATES = 3;

/** Uniform spatial grid limits candidate projections to nearby road segments instead of scanning the whole graph. */
export class RoadSpatialIndex {
  private readonly cells = new Map<string, Set<GraphEdge>>();
  private readonly longitudeScale: number;

  constructor(graph: WalkGraph, latitude: number) {
    this.longitudeScale = 111320 * Math.cos(latitude * Math.PI / 180);
    for (const edge of graph.edges) this.insert(edge);
  }

  /** Includes a GPS fallback candidate so missing road data cannot erase an observed part of the walk. */
  candidates(point: GeoPoint, accuracy: number): RoadCandidate[] {
    const radius = Math.min(90, Math.max(25, accuracy * 2)), [x, y] = this.cell(point);
    const distance = Math.ceil(radius / CELL_METERS), edges = new Set<GraphEdge>();
    for (let dx = -distance; dx <= distance; dx++) for (let dy = -distance; dy <= distance; dy++)
      this.cells.get(`${x + dx}:${y + dy}`)?.forEach(edge => edges.add(edge));
    const candidates = [...edges].map(edge => ({ ...projectToSegment(point, edge.start, edge.end), edge }))
      .filter(candidate => candidate.distance <= radius).sort((a, b) => a.distance - b.distance).slice(0, MAX_CANDIDATES);
    return [...candidates, { ...point, edge: null, fraction: 0, distance: 0 }];
  }

  private insert(edge: GraphEdge) {
    const [x1, y1] = this.cell(edge.start), [x2, y2] = this.cell(edge.end);
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      const key = `${x}:${y}`, bucket = this.cells.get(key) ?? new Set();
      bucket.add(edge); this.cells.set(key, bucket);
    }
  }

  private cell(point: GeoPoint): [number, number] {
    return [Math.floor(point.lng * this.longitudeScale / CELL_METERS), Math.floor(point.lat * 111320 / CELL_METERS)];
  }
}
