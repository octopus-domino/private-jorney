import { haversineMeters } from '../shared/geo';

export interface GeoPoint { lat: number; lng: number }
export interface GraphEdge {
  id: string; from: string; to: string; length: number; start: GeoPoint; end: GeoPoint;
  street?: string;
  sidewalk?: boolean;
  crossing?: boolean;
}
export interface RoadWay { id: number; nodes?: number[]; geometry?: GeoPoint[]; tags?: Record<string, string> }
interface Arc { target: string; length: number; edge: GraphEdge }
export interface GraphPath { distance: number; nodes: string[] }

/** Directed weighted pedestrian graph; shared OSM node ids preserve bridges and disconnected crossings. */
export class WalkGraph {
  readonly nodes = new Map<string, GeoPoint>();
  readonly edges: GraphEdge[] = [];
  private readonly adjacency = new Map<string, Arc[]>();
  private readonly streets = new Map<string, Set<string>>();
  private readonly paths = new Map<string, GraphPath>();

  /** Converts permitted pedestrian ways without applying motor-vehicle one-way rules to walking. */
  constructor(ways: RoadWay[]) {
    for (const way of ways) this.addWay(way);
  }

  /** Checks pedestrian direction before using a partial edge in map matching. */
  canTravel(from: string, to: string): boolean { return this.adjacency.get(from)?.some(arc => arc.target === to) ?? false; }

  edgeBetween(from: string, to: string): GraphEdge | undefined {
    return this.adjacency.get(from)?.find(arc => arc.target === to)?.edge;
  }

  streetsAt(node: string): string[] { return [...(this.streets.get(node) ?? [])]; }

  /** Bounded Dijkstra finds local transition paths, never replaces the entire recorded walk with a shortcut. */
  shortestPath(from: string, to: string, limit = 500, allowCrossings = true): GraphPath | null {
    if (limit < 0) return null;
    if (from === to) return { distance: 0, nodes: [from] };
    const key = `${from}:${to}:${allowCrossings}`, cached = this.paths.get(key);
    if (cached) return cached.distance <= limit ? cached : null;
    const result = this.dijkstra(from, to, limit, allowCrossings);
    if (result) {
      if (this.paths.size >= 4000) this.paths.delete(this.paths.keys().next().value!);
      this.paths.set(key, result);
    }
    return result;
  }

  private addWay(way: RoadWay) {
    const tags = way.tags ?? {}, points = way.geometry ?? [];
    if (tags.foot === 'no' || (['private', 'no'].includes(tags.access) && tags.foot !== 'yes')) return;
    for (let index = 1; index < points.length; index++) {
      const from = this.nodeId(way, index - 1), to = this.nodeId(way, index);
      const start = points[index - 1], end = points[index], length = haversineMeters(start, end);
      if (!Number.isFinite(length) || length < 0.1) continue;
      this.nodes.set(from, start); this.nodes.set(to, end);
      const street = (tags['name:ru'] ?? tags.name)?.trim().slice(0, 160) || undefined;
      const edge = { id: `${way.id}:${index}`, from, to, start, end, length, street,
        sidewalk: tags.footway === 'sidewalk', crossing: tags.footway === 'crossing' || tags.path === 'crossing' };
      this.edges.push(edge);
      if (street) for (const node of [from, to]) {
        const names = this.streets.get(node) ?? new Set<string>();
        names.add(street);
        this.streets.set(node, names);
      }
      if (tags['foot:forward'] !== 'no' && tags['oneway:foot'] !== '-1') this.addArc(from, to, edge);
      if (tags['foot:backward'] !== 'no' && tags['oneway:foot'] !== 'yes') this.addArc(to, from, edge);
    }
  }

  private nodeId(way: RoadWay, index: number): string {
    const point = way.geometry![index];
    return way.nodes?.[index] !== undefined ? `osm:${way.nodes[index]}`
      : `${point.lat.toFixed(7)}:${point.lng.toFixed(7)}:${way.tags?.layer ?? '0'}`;
  }

  private addArc(from: string, target: string, edge: GraphEdge) {
    const arcs = this.adjacency.get(from) ?? [];
    arcs.push({ target, length: edge.length, edge });
    this.adjacency.set(from, arcs);
  }

  private dijkstra(from: string, to: string, limit: number, allowCrossings: boolean): GraphPath | null {
    const queue = new DistanceHeap(), distances = new Map([[from, 0]]), previous = new Map<string, string>();
    queue.push({ node: from, distance: 0 });
    while (queue.size) {
      const current = queue.pop()!;
      if (current.distance !== distances.get(current.node) || current.distance > limit) continue;
      if (current.node === to) return { distance: current.distance, nodes: this.reconstruct(previous, from, to) };
      for (const arc of this.adjacency.get(current.node) ?? []) {
        if (!allowCrossings && arc.edge.crossing) continue;
        const distance = current.distance + arc.length;
        if (distance > limit || distance >= (distances.get(arc.target) ?? Infinity)) continue;
        distances.set(arc.target, distance); previous.set(arc.target, current.node);
        queue.push({ node: arc.target, distance });
      }
    }
    return null;
  }

  private reconstruct(previous: Map<string, string>, from: string, to: string): string[] {
    const path = [to];
    while (path.at(-1) !== from) path.push(previous.get(path.at(-1)!)!);
    return path.reverse();
  }
}

interface QueueItem { node: string; distance: number }
/** Binary min-heap keeps local graph search predictable on a phone. */
class DistanceHeap {
  private readonly items: QueueItem[] = [];
  get size() { return this.items.length; }

  push(item: QueueItem) {
    this.items.push(item);
    for (let index = this.items.length - 1; index > 0;) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].distance <= this.items[index].distance) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  pop(): QueueItem | undefined {
    const head = this.items[0], tail = this.items.pop();
    if (!this.items.length || !tail) return head;
    this.items[0] = tail;
    for (let index = 0;;) {
      const left = index * 2 + 1, right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.items[left].distance < this.items[smallest].distance) smallest = left;
      if (right < this.items.length && this.items[right].distance < this.items[smallest].distance) smallest = right;
      if (smallest === index) break;
      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
    return head;
  }
}
