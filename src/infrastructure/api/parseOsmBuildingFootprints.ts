import { insideFootprintRing, type BuildingFootprint, type FootprintPoint } from '../../domain/BuildingFootprint';

type Ways = Map<string, string[]>;
const tags = (element: Element) => new Map(Array.from(element.querySelectorAll(':scope > tag'))
  .map(tag => [tag.getAttribute('k') ?? '', tag.getAttribute('v') ?? '']));
const refs = (way: Element) => Array.from(way.querySelectorAll(':scope > nd')).map(node => node.getAttribute('ref') ?? '');

function address(element: Element): string | null {
  const values = tags(element), street = values.get('addr:street'), house = values.get('addr:housenumber');
  if (!street || !house) return null;
  const number = house.replace(/\s*лит\.?\s*([а-яa-z])/gi, ', литера $1');
  return `${street}, ${number}`;
}

/** Joins split multipolygon boundaries by node identity, including fragments with reversed direction. */
function joinRings(fragments: string[][]): string[][] | null {
  const pending = fragments.map(fragment => [...fragment]), rings: string[][] = [];
  while (pending.length) {
    const ring = pending.shift()!;
    while (ring[0] !== ring.at(-1)) {
      const index = pending.findIndex(part => part[0] === ring.at(-1) || part.at(-1) === ring.at(-1));
      if (index < 0) return null;
      const next = pending.splice(index, 1)[0];
      if (next.at(-1) === ring.at(-1)) next.reverse();
      ring.push(...next.slice(1));
    }
    if (ring.length < 4) return null;
    rings.push(ring);
  }
  return rings;
}

function coordinates(rings: string[][], nodes: Map<string, FootprintPoint>): FootprintPoint[][] | null {
  if (rings.some(ring => ring.some(id => !nodes.has(id)))) return null;
  return rings.map(ring => ring.map(id => nodes.get(id)!));
}

function relationRings(relation: Element, role: string, ways: Ways): string[][] | null {
  const members = Array.from(relation.querySelectorAll(':scope > member')).filter(member => member.getAttribute('role') === role);
  if (members.some(member => member.getAttribute('type') !== 'way' || !ways.has(member.getAttribute('ref') ?? ''))) return null;
  return joinRings(members.map(member => ways.get(member.getAttribute('ref')!)!));
}

function relationPolygons(relation: Element, ways: Ways, nodes: Map<string, FootprintPoint>): FootprintPoint[][][] | null {
  const outer = relationRings(relation, 'outer', ways), inner = relationRings(relation, 'inner', ways);
  if (!outer?.length || !inner) return null;
  const shells = coordinates(outer, nodes), holes = coordinates(inner, nodes);
  if (!shells || !holes || holes.some(hole => shells.filter(shell => insideFootprintRing(hole[0], shell)).length !== 1)) return null;
  return shells.map(shell => [shell, ...holes.filter(hole => insideFootprintRing(hole[0], shell))]);
}

/** Parses address geometry only; OSM building levels/materials never replace the official technical passport. */
export function parseOsmBuildingFootprints(xml: string): BuildingFootprint[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.documentElement.tagName !== 'osm' || doc.querySelector('parsererror')) throw new Error('Invalid OSM map response');
  const nodes = new Map(Array.from(doc.querySelectorAll('osm > node')).flatMap(node => {
    const lat = Number(node.getAttribute('lat')), lng = Number(node.getAttribute('lon')), id = node.getAttribute('id');
    return id && Number.isFinite(lat) && Number.isFinite(lng) ? [[id, { lat, lng }] as const] : [];
  }));
  const wayElements = Array.from(doc.querySelectorAll('osm > way'));
  const ways: Ways = new Map(wayElements.map(way => [way.getAttribute('id')!, refs(way)]));
  const relations = Array.from(doc.querySelectorAll('osm > relation')).filter(relation => tags(relation).get('type') === 'multipolygon' && tags(relation).has('building'));
  const memberIds = new Set(relations.flatMap(relation => Array.from(relation.querySelectorAll('member')).map(member => member.getAttribute('ref'))));
  const complex = relations.flatMap(relation => {
    const name = address(relation), polygons = relationPolygons(relation, ways, nodes);
    return name && polygons ? [{ id: `relation:${relation.getAttribute('id')}`, address: name, polygons }] : [];
  });
  return [...complex, ...wayElements.flatMap(way => simpleBuilding(way, memberIds, nodes))];
}

function simpleBuilding(way: Element, members: Set<string | null>, nodes: Map<string, FootprintPoint>): BuildingFootprint[] {
  if (!tags(way).has('building') || members.has(way.getAttribute('id'))) return [];
  const name = address(way), boundary = refs(way);
  if (!name || boundary.length < 4 || boundary[0] !== boundary.at(-1)) return [];
  const rings = coordinates([boundary], nodes);
  return rings ? [{ id: `way:${way.getAttribute('id')}`, address: name, polygons: [rings] }] : [];
}
