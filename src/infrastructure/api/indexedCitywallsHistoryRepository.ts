import type { Poi } from '../../domain/Poi';
import type { PlaceHistoryRepository } from '../../application/ports/PlaceHistoryRepository';
import { containsBuildingPoint } from '../../domain/BuildingFootprint';
import { haversineMeters } from '../../shared/geo';
import { CitywallsLocalIndex } from './citywallsLocalIndex';
import { CitywallsHistoryRepository, citywallsHouseId } from './citywallsHistoryRepository';
import { OsmBuildingFootprints } from './osmBuildingFootprints';
import { citywallsSquares, matchCitywallsPoint, type CitywallsPoint } from './citywallsMap';

/** Decorator: resolves IDs locally and delegates only the direct house page to the existing text/photo parser. */
export class IndexedCitywallsHistoryRepository implements PlaceHistoryRepository {
  constructor(private readonly index = new CitywallsLocalIndex(), private readonly history = new CitywallsHistoryRepository(),
    private readonly footprints: Pick<OsmBuildingFootprints, 'lookup'> = new OsmBuildingFootprints()) {}

  supports(poi: Poi): boolean { return citywallsSquares(poi).length > 0; }
  requestKey(poi: Poi): string { return `${poi.lat}:${poi.lng}:${poi.details?.sourceUrl ?? ''}`; }

  async lookup(poi: Poi, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (citywallsHouseId(poi.details?.sourceUrl)) return this.history.lookup(poi, signal);
    const points = await this.index.points();
    const matched = await this.match(poi, points, signal);
    if (!matched) return null;
    return this.history.lookup({ ...poi, details: { ...poi.details,
      sourceUrl: `https://www.citywalls.ru/house${matched.id}.html` } }, signal);
  }

  private async match(poi: Poi, points: CitywallsPoint[], signal?: AbortSignal): Promise<CitywallsPoint | null> {
    try {
      const outline = await this.footprints.lookup(poi, signal);
      if (outline.excluded) return null;
      if (outline.building) {
        const building = outline.building;
        const vertices = building.polygons.flatMap(polygon => polygon[0]);
        const centre = { lat: vertices.reduce((sum, p) => sum + p.lat, 0) / vertices.length,
          lng: vertices.reduce((sum, p) => sum + p.lng, 0) / vertices.length };
        return points.filter(point => containsBuildingPoint(building, point))
          .sort((a, b) => haversineMeters(a, centre) - haversineMeters(b, centre) || a.id - b.id)[0] ?? null;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.info('Building outline unavailable; using local Citywalls point match', error);
    }
    return matchCitywallsPoint(poi, points);
  }
}
