import type { Poi } from '../../domain/Poi';
import type { BuildingProfile } from '../../domain/BuildingProfile';

export interface BuildingProfileRepository {
  supports(poi: Poi): boolean;
  lookup(poi: Poi, signal?: AbortSignal): Promise<BuildingProfile | null>;
}
