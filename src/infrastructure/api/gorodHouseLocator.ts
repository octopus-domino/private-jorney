import type { Geocoder } from '../../application/ports/Geocoder';
import type { Poi } from '../../domain/Poi';
import { matchCitywallsPoint, type CitywallsPoint } from './citywallsMap';
import { gorodSearchQuery } from './gorodSearchQuery';
import { readGorodStage } from './gorodSourceError';
import { readExternalPage } from './readExternalPage';
import { OsmBuildingFootprints } from './osmBuildingFootprints';
import type { BuildingFootprint } from '../../domain/BuildingFootprint';
import { matchHouseAddress } from '../../shared/address';
import { projectToSegment } from '../../domain/pathGeometry';
import { z } from 'zod';
import { PersistentSuccessCache } from '../../shared/persistentSuccessCache';
import { SharedRequestPool } from '../../shared/sharedRequestPool';

const identitySchema = z.object({ id: z.number().int().positive(), lat: z.number().finite(), lng: z.number().finite(), title: z.string() });

/** Adapter: prefer the portal's own house IDs by coordinates; reverse geocoding is only a fallback. */
export class GorodHouseLocator {
  private readonly identities = new PersistentSuccessCache<CitywallsPoint>('private-walks/cache/gorod-footprint-identities/v1', 86400000,
    raw => { const parsed = identitySchema.safeParse(raw); return parsed.success ? parsed.data : undefined; });
  private readonly identityRequests = new SharedRequestPool<CitywallsPoint | null>();
  constructor(private readonly geocoder: Geocoder, private readonly read = readExternalPage,
    private readonly footprints: Pick<OsmBuildingFootprints, 'lookup'> = new OsmBuildingFootprints(read)) {}

  /** Rejects distant or ambiguous neighbours using the same distance checks as address search. */
  async find(poi: Poi, signal?: AbortSignal): Promise<CitywallsPoint | null> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const footprint = await this.footprint(poi, signal);
    if (footprint?.excluded) return null;
    if (footprint?.building) return this.byFootprint(poi, footprint.building, signal);
    const coordinates = await this.byCoordinates(poi, signal);
    if (coordinates.match) return coordinates.match;
    const address = poi.details?.address?.trim();
    const named = address ? await this.byAddress(poi, address, signal) : null;
    if (named) return named;
    const reverse = await readGorodStage('geocoder', () => this.geocoder.reverse(poi.lat, poi.lng, signal), signal);
    const result = reverse.label !== address ? await this.byAddress(poi, reverse.label, signal) : null;
    if (!result && coordinates.error) throw coordinates.error;
    return result;
  }

  private byFootprint(poi: Poi, building: BuildingFootprint, signal?: AbortSignal): Promise<CitywallsPoint | null> {
    const key = `${building.id}:${building.address}`;
    const cached = this.identities.get(key);
    if (cached && this.inOutline(building, cached)) return Promise.resolve(cached);
    return this.identityRequests.run(key, async shared => {
      const match = await this.byAddress(poi, building.address, shared, building);
      if (match) this.identities.set(key, match);
      return match;
    }, signal);
  }

  private async footprint(poi: Poi, signal?: AbortSignal) {
    try {
      return await this.footprints.lookup(poi, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.info('Building outline unavailable; using city portal coordinate lookup.', error instanceof Error ? error.name : 'SourceError');
      return null;
    }
  }

  private async byCoordinates(poi: Poi, signal?: AbortSignal) {
    const url = new URL('https://gorod.gov.spb.ru/public_api/maps/get_nearest/');
    url.search = new URLSearchParams({ latitude: String(poi.lat), longitude: String(poi.lng) }).toString();
    try {
      const data: unknown = JSON.parse(await this.read(url.href, signal));
      if (!data || typeof data !== 'object' || !('buildings' in data) || !Array.isArray(data.buildings)) throw new Error('Invalid portal map response');
      return { match: matchCitywallsPoint(poi, this.points(data.buildings, true)), error: undefined };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { match: null, error };
    }
  }

  private async byAddress(poi: Poi, address: string, signal?: AbortSignal, footprint?: BuildingFootprint) {
    const query = gorodSearchQuery(address);
    if (!query) return null;
    return readGorodStage('address', async () => {
      const url = new URL('https://gorod.gov.spb.ru/facilities/search/ajax/');
      url.searchParams.set('query', query);
      const data: unknown = JSON.parse(await this.read(url.href, signal));
      if (!Array.isArray(data)) throw new Error('Invalid portal address response');
      const points = this.points(data, false);
      if (!footprint) return matchCitywallsPoint(poi, points);
      const matches = [...new Map(points.filter(point => matchHouseAddress(address, point.title, 0)
        && this.inOutline(footprint, point)).map(point => [point.id, point])).values()];
      return matches.length === 1 ? matches[0] : null;
    }, signal);
  }

  private inOutline(building: BuildingFootprint, point: CitywallsPoint): boolean {
    // Only the official reference point may be in a courtyard/notch. The click was checked against the true polygon.
    const WALL_TOLERANCE_METERS = 2;
    return building.polygons.some(([outer]) => {
      const south = Math.min(...outer.map(vertex => vertex.lat)), north = Math.max(...outer.map(vertex => vertex.lat));
      const west = Math.min(...outer.map(vertex => vertex.lng)), east = Math.max(...outer.map(vertex => vertex.lng));
      if (point.lat >= south && point.lat <= north && point.lng >= west && point.lng <= east) return true;
      const box = [{ lat: south, lng: west }, { lat: south, lng: east }, { lat: north, lng: east }, { lat: north, lng: west }];
      return box.some((a, index) => projectToSegment(point, a, box[(index + 1) % box.length]).distance <= WALL_TOLERANCE_METERS);
    });
  }

  private points(rows: unknown[], map: boolean): CitywallsPoint[] {
    return rows.flatMap(row => {
      if (!row || typeof row !== 'object') return [];
      const value = row as Record<string, unknown>;
      const id = Number(map ? value.id : value.data), lat = Number(map ? value.latitude : value.lat);
      const lng = Number(map ? value.longitude : value.lon);
      return Number.isInteger(id) && id > 0 && Number.isFinite(lat) && Number.isFinite(lng)
        ? [{ id, lat, lng, title: String(map ? value.full_address ?? '' : value.main_address ?? value.value ?? '') }] : [];
    });
  }
}
