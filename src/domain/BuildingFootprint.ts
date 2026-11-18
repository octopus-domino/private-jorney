export interface FootprintPoint { lat: number; lng: number }
export interface BuildingFootprint {
  id: string;
  address: string;
  /** Each polygon contains an outer ring followed by courtyard/hole rings. */
  polygons: FootprintPoint[][][];
}
export interface FootprintMatch { building: BuildingFootprint | null; excluded: boolean }

/** Ray casting uses the actual outline; bounding boxes and centroids cannot identify concave buildings. */
export function insideFootprintRing(point: FootprintPoint, ring: FootprintPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index], b = ring[previous];
    if ((a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < (b.lng - a.lng) * (point.lat - a.lat) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

/** Excludes courtyards and accepts a point only within one complete polygon of the building. */
export function containsBuildingPoint(building: BuildingFootprint, point: FootprintPoint): boolean {
  return building.polygons.some(([outer, ...holes]) => insideFootprintRing(point, outer)
    && !holes.some(hole => insideFootprintRing(point, hole)));
}

/** Overlapping outlines are ambiguous; never resolve them by picking whichever appeared first. */
export function matchBuildingFootprint(point: FootprintPoint, buildings: BuildingFootprint[]): BuildingFootprint | null {
  const matches = [...new Map(buildings.filter(building => containsBuildingPoint(building, point)).map(building => [building.id, building])).values()];
  return matches.length === 1 ? matches[0] : null;
}

/** An identified courtyard or overlapping addressed outlines must not fall back to the nearest house. */
export function resolveBuildingFootprint(point: FootprintPoint, buildings: BuildingFootprint[]): FootprintMatch {
  const unique = [...new Map(buildings.map(building => [building.id, building])).values()];
  const building = matchBuildingFootprint(point, unique);
  const excluded = !building && unique.some(item => item.polygons.some(([outer]) => insideFootprintRing(point, outer)));
  return { building, excluded };
}
