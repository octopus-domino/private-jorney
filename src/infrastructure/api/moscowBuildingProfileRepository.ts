import { z } from 'zod';
import type { BuildingProfileRepository } from '../../application/ports/BuildingProfileRepository';
import type { BuildingProfile } from '../../domain/BuildingProfile';
import type { Poi } from '../../domain/Poi';
import { PersistentSuccessCache, type SuccessCache } from '../../shared/persistentSuccessCache';
import { QueryCache } from '../../shared/queryCache';
import { SharedRequestPool } from '../../shared/sharedRequestPool';
import { baseProfileSchema } from './buildingSuccessCaches';
import { MoscowDataClient } from './moscowDataClient';
import { parseMoscowAddresses, matchMoscowAddress, type MoscowAddress } from './moscowAddressGeometry';
import type { Geocoder } from '../../application/ports/Geocoder';
import { moscowAddressKey } from './moscowAddressKey';
import { MoscowMaintenanceRepository } from './moscowMaintenanceRepository';

interface CompanyReference { row: number; name: string; unoms: number[] }
interface HouseIndex { companies: CompanyReference[]; addresses?: unknown[] }
interface IndexedHouses { companies: Map<number, CompanyReference[]>; addresses: Map<string, MoscowAddress[]> }
type Client = Pick<MoscowDataClient, 'get'>;
const DAY_MS = 86400000;
const houseSchema = z.object({ UNOM: z.number().int().positive(), BuildYear: z.number().nullable().optional(),
  MaxFloors: z.number().nullable().optional(), MinFloors: z.number().nullable().optional(),
  NumberOfEntrances: z.number().nullable().optional(), NumberOfElevators: z.number().nullable().optional(),
  ProjectSeries: z.string().nullable().optional(), TotalArea: z.number().nullable().optional(),
  TotalAreaLive: z.number().nullable().optional(), TotalAreaNonLive: z.number().nullable().optional(), is_deleted: z.number().optional() });
type House = z.infer<typeof houseSchema>;
const cacheSchema = baseProfileSchema.extend({ sourceUrl: z.literal('https://data.mos.ru/opendata/2681'), sourceName: z.literal('Открытые данные Москвы') });
const cacheFactory = () => new PersistentSuccessCache<BuildingProfile>('private-walks/cache/moscow-building-profiles/v2', DAY_MS,
  raw => { const result = cacheSchema.safeParse(raw); return result.success ? result.data : undefined; });

/** Adapter: exact official address or contour -> UNOM -> technical fields; company offices are never treated as houses. */
export class MoscowBuildingProfileRepository implements BuildingProfileRepository {
  private readonly requests = new SharedRequestPool<BuildingProfile | null>();
  private readonly areas = new QueryCache<MoscowAddress[]>({ ttlMs: DAY_MS, maxEntries: 5, persist: true,
    storageKey: 'private-walks/cache/moscow-address-areas/v1' });
  private readonly companies = new QueryCache<House[]>({ ttlMs: DAY_MS, maxEntries: 4 });
  private index?: Promise<IndexedHouses>;

  constructor(private readonly client: Client, private readonly geocoder?: Geocoder, private readonly cache: SuccessCache<BuildingProfile> = cacheFactory(),
    private readonly loadIndex: () => Promise<HouseIndex> = async () => (await import('../data/moscowHouseIndex.json')).default,
    private readonly maintenance: Pick<MoscowMaintenanceRepository, 'lookup'> = new MoscowMaintenanceRepository(client)) {}

  /** Moscow coverage is independent of whether a historical article exists for the selected building. */
  supports(poi: Poi): boolean { return poi.lat > 55.1 && poi.lat < 56.15 && poi.lng > 36.6 && poi.lng < 38.4; }

  /** Late reverse-geocoding metadata cannot cancel an otherwise identical house request. */
  requestKey(poi: Poi): string { return `${poi.lat}:${poi.lng}`; }

  /** Persists only verified profiles; failures, ambiguity and missing houses are not cached. */
  async lookup(poi: Poi, signal?: AbortSignal): Promise<BuildingProfile | null> {
    if (!this.supports(poi)) return null;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const key = this.requestKey(poi), cached = this.cache.get(key);
    if (cached) return cached;
    return this.requests.run(key, shared => this.resolve(poi, key, shared), signal);
  }

  private async resolve(poi: Poi, key: string, signal: AbortSignal): Promise<BuildingProfile | null> {
    const index = await this.houseIndex();
    const address = await this.resolveAddress(poi, index, signal);
    if (!address) return null;
    const cached = this.cache.get(`unom:${address.unom}`);
    if (cached) { this.cache.set(key, cached); return cached; }
    for (const company of index.companies.get(address.unom) ?? []) {
      const houses = await this.companyHouses(company, address.unom, signal);
      const house = houses.find(item => item.UNOM === address.unom);
      if (!house) continue;
      const profile = await this.enrichMaintenance(this.profile(house, address, poi), address.unom, signal);
      if (!profile.maintenanceUnavailable) {
        this.cache.set(key, profile); this.cache.set(`unom:${address.unom}`, profile);
      }
      return profile;
    }
    return null;
  }

  private async addresses(poi: Poi, signal: AbortSignal): Promise<MoscowAddress[]> {
    const lat = Number(poi.lat.toFixed(3)), lng = Number(poi.lng.toFixed(3));
    const bbox = [lng - 0.004, lat - 0.0025, lng + 0.004, lat + 0.0025].join(',');
    return this.areas.getAbortable(`${lat}:${lng}`, async shared => parseMoscowAddresses(
      await this.client.get(60562, 'features', { bbox, '$top': '500' }, shared)), signal);
  }

  private async houseIndex(): Promise<IndexedHouses> {
    this.index ??= this.loadIndex().then(data => {
      const index = new Map<number, CompanyReference[]>();
      for (const company of data.companies) for (const unom of company.unoms)
        index.set(unom, [...index.get(unom) ?? [], company]);
      const addresses = new Map<string, MoscowAddress[]>();
      for (const entry of data.addresses ?? []) {
        const parsed = z.tuple([z.number().int().positive(), z.string()]).safeParse(entry);
        if (!parsed.success) continue;
        const [unom, address] = parsed.data, key = moscowAddressKey(address);
        addresses.set(key, [...addresses.get(key) ?? [], { unom, address, polygons: [] }]);
      }
      return { companies: index, addresses };
    }).catch(error => { this.index = undefined; throw error; });
    return this.index;
  }

  private namedAddress(label: string | undefined, index: IndexedHouses): MoscowAddress | null {
    if (!label) return null;
    const matches = index.addresses.get(moscowAddressKey(label));
    return matches?.length === 1 ? matches[0] : null;
  }

  private async resolveAddress(poi: Poi, index: IndexedHouses, signal: AbortSignal): Promise<MoscowAddress | null> {
    const named = this.namedAddress(poi.details?.address, index);
    if (named) return named;
    let contourFailure: unknown;
    try {
      const match = matchMoscowAddress(poi, await this.addresses(poi, signal));
      if (match) return match;
    } catch (error) {
      if (signal.aborted) throw error;
      contourFailure = error;
    }
    const reverse = await this.geocoder?.reverse(poi.lat, poi.lng, signal);
    const fallback = this.namedAddress(reverse?.label, index);
    if (!fallback && contourFailure) throw contourFailure;
    return fallback;
  }

  private companyHouses(company: CompanyReference, unom: number, signal: AbortSignal): Promise<House[]> {
    return this.companies.getAbortable(`${company.row}:${company.name}`, async shared => {
      let rows = await this.client.get(2681, 'rows', { '$skip': String(company.row), '$top': '1' }, shared);
      let houses = this.parseHouses(rows);
      if (!houses.some(house => house.UNOM === unom) && company.name) {
        rows = await this.client.get(2681, 'rows', { '$filter': `Cells/ShortName eq '${company.name.replace(/'/g, "''")}'`, '$top': '20' }, shared);
        houses = this.parseHouses(rows);
      }
      if (!houses.some(house => house.UNOM === unom)) throw new Error('Справочник домов Москвы обновился. Не удалось подтвердить выбранный дом.');
      return houses;
    }, signal);
  }

  private parseHouses(payload: unknown): House[] {
    const rows = z.array(z.object({ Cells: z.object({ MKD: z.array(z.unknown()).optional() }) })).parse(payload);
    return rows.flatMap(row => row.Cells.MKD ?? []).flatMap(item => {
      const house = houseSchema.safeParse(item);
      return house.success && house.data.is_deleted !== 1 ? [house.data] : [];
    });
  }

  private profile(house: House, address: MoscowAddress, poi: Poi): BuildingProfile {
    const features: BuildingProfile['features'] = [];
    if (house.ProjectSeries && !/^(0|нет|не указано|-)$/i.test(house.ProjectSeries.trim())) features.push({ label: 'Проект дома', value: house.ProjectSeries });
    if (house.NumberOfEntrances && house.NumberOfEntrances > 0) features.push({ label: 'Подъезды', value: String(house.NumberOfEntrances) });
    if (house.NumberOfElevators && house.NumberOfElevators > 0) features.push({ label: 'Лифты', value: String(house.NumberOfElevators) });
    for (const [label, area] of [['Площадь дома', house.TotalArea], ['Жилая площадь', house.TotalAreaLive], ['Нежилые помещения', house.TotalAreaNonLive]] as const) {
      if (area && area > 0) features.push({ label, value: `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(area)} м²` });
    }
    return { address: address.address, sourceName: 'Открытые данные Москвы', sourceUrl: 'https://data.mos.ru/opendata/2681',
      fetchedAt: new Date().toISOString(), location: { lat: poi.lat, lng: poi.lng }, yearBuilt: this.positive(house.BuildYear),
      floors: this.positive(house.MaxFloors) ?? this.positive(house.MinFloors), features, residents: null,
      communalFlats: null, separateFlats: null, ages: { children: null, working: null, older: null },
      repairs: [], plans: [], plansAvailable: false, wear: {} };
  }

  private positive(value: number | null | undefined): number | null { return value && value > 0 ? value : null; }

  private async enrichMaintenance(profile: BuildingProfile, unom: number, signal: AbortSignal): Promise<BuildingProfile> {
    try {
      return { ...profile, maintenance: await this.maintenance.lookup(unom, signal) };
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn('Moscow maintenance source unavailable; basic house data retained.', error instanceof Error ? error.name : 'SourceError');
      return { ...profile, maintenanceUnavailable: true };
    }
  }
}
