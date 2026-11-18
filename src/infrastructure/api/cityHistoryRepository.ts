import type { PlaceHistoryRepository } from '../../application/ports/PlaceHistoryRepository';
import type { Poi } from '../../domain/Poi';

interface HistoryStrategy extends PlaceHistoryRepository { requestKey(poi: Poi): string }

/** Strategy: selects one city source without querying unrelated cities or mixing their caches. */
export class CityHistoryRepository implements PlaceHistoryRepository {
  constructor(private readonly sources: { name: string; repository: HistoryStrategy }[]) {}

  /** Identifies the applicable source before any network request. */
  supports(poi: Poi): boolean { return this.sources.some(source => source.repository.supports(poi)); }

  /** Lets cards show the source name while a request is still running. */
  sourceName(poi: Poi): string { return this.sources.find(source => source.repository.supports(poi))?.name ?? 'История здания'; }

  /** Uses each adapter's stable request identity. */
  requestKey(poi: Poi): string { return this.sources.find(source => source.repository.supports(poi))?.repository.requestKey(poi) ?? poi.id; }

  /** Delegates only to the selected strategy. */
  async lookup(poi: Poi, signal?: AbortSignal) {
    return this.sources.find(source => source.repository.supports(poi))?.repository.lookup(poi, signal) ?? null;
  }
}
