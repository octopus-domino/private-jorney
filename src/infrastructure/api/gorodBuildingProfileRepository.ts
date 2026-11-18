import type { BuildingProfileRepository } from '../../application/ports/BuildingProfileRepository';
import type { Geocoder } from '../../application/ports/Geocoder';
import type { BuildingProfile } from '../../domain/BuildingProfile';
import type { Poi } from '../../domain/Poi';
import { citywallsSquares } from './citywallsMap';
import { readExternalPage } from './readExternalPage';
import { parseGorodProfile, parseGorodPlans } from './parseGorodProfile';
import { GorodHouseLocator } from './gorodHouseLocator';
import { createProfileCache } from './buildingSuccessCaches';
import type { SuccessCache } from '../../shared/persistentSuccessCache';
import { readOptionalPage } from './readOptionalPage';
import { readGorodStage } from './gorodSourceError';
import { SharedRequestPool } from '../../shared/sharedRequestPool';

export class GorodBuildingProfileRepository implements BuildingProfileRepository {
  private readonly locator: GorodHouseLocator;
  private readonly profiles = new SharedRequestPool<BuildingProfile>();
  constructor(geocoder: Geocoder, private readonly read = readExternalPage,
    private readonly cache: SuccessCache<BuildingProfile> = createProfileCache()) {
    this.locator = new GorodHouseLocator(geocoder, read);
  }

  /** The point is the persistent identity; reverse-geocoded labels may arrive later. */
  requestKey(poi: Poi): string { return `${poi.lat}:${poi.lng}`; }
  supports(poi: Poi): boolean { return citywallsSquares(poi).length > 0; }

  async lookup(poi: Poi, signal?: AbortSignal): Promise<BuildingProfile | null> {
    if (!this.supports(poi)) return null;
    const key = this.requestKey(poi);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cached = this.cache.get(key);
    if (cached) return cached;
    const match = await this.locator.find(poi, signal);
    if (!match) return null;
    const identity = `facility:${match.id}`;
    const existing = this.cache.get(identity);
    if (existing) return existing;
    const profile = await this.profiles.run(identity,
      shared => readGorodStage('passport', () => this.loadProfile(match, shared), shared), signal);
    if (!profile.passportStatus) this.cache.set(identity, profile);
    if (!profile.passportStatus) this.cache.set(key, profile);
    return profile;
  }

  private async loadProfile(match: { id: number; lat: number; lng: number; title: string }, signal?: AbortSignal) {
    const sourceUrl = `https://gorod.gov.spb.ru/facilities/${match.id}/info/`;
    const info = await this.read(sourceUrl, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const profile = parseGorodProfile(info, match.title, sourceUrl);
    profile.location = { lat: match.lat, lng: match.lng };
    if (profile.passportStatus) return profile;
    const plans = await readOptionalPage(`https://gorod.gov.spb.ru/facilities/${match.id}/programs/`, this.read, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (plans !== null) {
      profile.plans = parseGorodPlans(plans);
      profile.plansAvailable = true;
    }
    return profile;
  }
}
