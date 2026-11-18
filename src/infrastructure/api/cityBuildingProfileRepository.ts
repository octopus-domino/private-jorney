import type { BuildingProfileRepository } from '../../application/ports/BuildingProfileRepository';
import type { Poi } from '../../domain/Poi';

/** Strategy: selects the city passport adapter without querying unrelated sources. */
export class CityBuildingProfileRepository implements BuildingProfileRepository {
  constructor(private readonly sources: BuildingProfileRepository[]) {}
  /** Unsupported cities keep their ordinary place card and listing links. */
  supports(poi: Poi): boolean { return this.sources.some(source => source.supports(poi)); }
  /** The point remains stable when its title or reverse-geocoded address arrives. */
  requestKey(poi: Poi): string { return `${poi.lat}:${poi.lng}`; }
  /** Delegates house matching to the selected city's strategy. */
  async lookup(poi: Poi, signal?: AbortSignal) { return this.sources.find(source => source.supports(poi))?.lookup(poi, signal) ?? null; }
}
