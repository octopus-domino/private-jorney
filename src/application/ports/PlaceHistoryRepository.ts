import type { Poi } from '../../domain/Poi';
import type { PlaceHistory } from '../../domain/PlaceHistory';
export type { PlaceHistory } from '../../domain/PlaceHistory';

export interface PlaceHistoryRepository {
  sourceName?(poi: Poi): string;
  supports(poi: Poi): boolean;
  lookup(poi: Poi, signal?: AbortSignal): Promise<PlaceHistory | null>;
}
