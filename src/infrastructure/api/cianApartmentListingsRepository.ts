import { z } from 'zod';
import type { ApartmentListingsRepository, ListingSearchArea } from '../../application/ports/ApartmentListingsRepository';
import type { ApartmentListing } from '../../domain/ApartmentListing';
import { haversineMeters } from '../../shared/geo';
import { readExternalPage, postExternalJson } from './readExternalPage';
import { matchHouseAddress } from '../../shared/address';
import { listingRegion } from './listingRegion';
import { CianAreaCache } from './cianAreaCache';

type Point = { lat: number; lng: number };
const offerSchema = z.preprocess(normalizeCianOffer, z.object({
  id: z.number().int().positive(), category: z.literal('flatSale'), dealType: z.literal('sale'),
  href: z.string().optional(), price: z.object({ value: z.number().positive(), currency: z.enum(['rur', 'rub', 'RUB']) }),
  features: z.array(z.string()),
  geo: z.object({ address: z.string().min(1), coordinates: z.object({ lat: z.number(), lng: z.number() }) }),
  media: z.array(z.object({ previewUrl: z.string().optional(), url: z.string().optional(), type: z.string() })).optional(),
}));

/** Adapts both CIAN wire formats without altering the received offer or reading personal contact fields. */
function normalizeCianOffer(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const offer = objectRecord(raw), geo = objectRecord(offer.geo), featureValues = objectRecord(offer.features);
  const features = Array.isArray(offer.features) ? offer.features
    : [featureValues.objectType, featureValues.totalArea, featureValues.floorInfo].filter(value => typeof value === 'string');
  const address = Array.isArray(geo.address)
    ? geo.address.map(objectRecord).filter(part => ['location', 'street', 'house'].includes(String(part.key)))
      .map(part => part.value).filter(value => typeof value === 'string').join(', ') : geo.address;
  return { ...offer, id: offer.id ?? offer.cianId, features, geo: { ...geo, address } };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Decodes legacy manifests and modern offer arrays, keeping only verified same-house sale listings. */
export function parseCianListings(response: unknown, address: string, point: Point): ApartmentListing[] {
  const recognized = decodeCianOffers(response);
  const listings = recognized.map(offer => cianListing(offer, address, point)).filter((item): item is ApartmentListing => !!item);
  return [...new Map(listings.map((listing) => [listing.id, listing])).values()].slice(0, 6);
}

function decodeCianOffers(response: unknown): z.infer<typeof offerSchema>[] {
  const offers = extractCianOffers(response);
  const recognized = offers.flatMap(raw => { const result = offerSchema.safeParse(raw); return result.success ? [result.data] : []; });
  if (offers.length && !recognized.length) throw new Error('Cian offer format changed');
  return recognized.map(offer => ({ ...offer, media: offer.media?.filter(item => item.type === 'photo').slice(0, 1) }));
}

function cianListing(offer: z.infer<typeof offerSchema>, address: string, point: Point): ApartmentListing | null {
  const match = matchHouseAddress(address, offer.geo.address, haversineMeters(point, offer.geo.coordinates));
  if (!match) return null;
  const url = new URL(offer.href ?? `/sale/flat/${offer.id}/`, listingRegion(point).cianOrigin);
  if (!['https://spb.cian.ru', 'https://www.cian.ru', 'https://cian.ru'].includes(url.origin) || !/^\/sale\/flat\/\d+\/$/.test(url.pathname)) return null;
  const photo = offer.media?.find(media => media.type === 'photo');
  const image = photo?.previewUrl ?? photo?.url;
  const imageUrl = image && /^https:\/\/images\.cdn-cian\.ru\//.test(image) ? image : undefined;
  return { id: String(offer.id), title: offer.features.filter(Boolean).join(' · ') || 'Квартира', address: offer.geo.address,
    priceRub: offer.price.value, url: `${url.origin}${url.pathname}`, imageUrl,
    matchNote: match === 'corner-address' ? 'Угловой дом: двойной номер указан в обратном порядке; расположение совпадает.'
      : match === 'main-letter-omitted' ? 'Основная литера А опущена в одном из адресов; совпадают улица, номер и расположение дома.' : undefined };
}

function extractCianOffers(response: unknown): unknown[] {
  const direct = z.object({ offers: z.array(z.unknown()) }).safeParse(response);
  if (direct.success) return direct.data.offers;
  const manifest = z.object({ manifest: z.object({ microfrontends: z.record(z.object({ images: z.record(z.object({ assets: z.record(z.object({ content: z.string().optional() }).passthrough()) })) })) }) }).parse(response);
  const frontend = manifest.manifest.microfrontends['mobile-search-frontend'];
  if (!frontend) throw new Error('Cian response format changed');
  const states = Object.values(frontend.images).flatMap(image => Object.values(image.assets))
    .map(asset => legacyInitialState(asset.content)).filter(state => state !== undefined);
  const state = states.at(-1);
  const parsed = z.object({ offers: z.object({ byId: z.record(z.unknown()) }) }).parse(state);
  return Object.values(parsed.offers.byId);
}

function legacyInitialState(content?: string): unknown {
  if (!content?.includes("window._cianConfig['mobile-search-frontend']")) return undefined;
  const start = content.indexOf('.concat(');
  if (start < 0) return undefined;
  // Parse the JSON payload only. Never execute remote JavaScript.
  const config: unknown = JSON.parse(content.slice(start + 8, content.lastIndexOf(']') + 1));
  return z.array(z.object({ key: z.string(), value: z.unknown() })).parse(config)
    .find(entry => entry.key === 'initialState')?.value;
}

export class CianApartmentListingsRepository implements ApartmentListingsRepository {
  /** Injects the independent legacy GET and current JSON POST strategies. */
  constructor(private readonly read = readExternalPage, private readonly post = postExternalJson,
    private readonly cache = new CianAreaCache(decodeCianOffers)) {}

  /** Warms an uncached visible bbox without requiring a house selection or storing source errors. */
  async prefetch(area: ListingSearchArea, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.cache.get(area, 'modern')) return;
    const point = { lat: (area.south + area.north) / 2, lng: (area.west + area.east) / 2 };
    await this.modernLookup('', signal, point, area);
  }
  /** Builds a public search link for the same region and selected house. */
  searchUrl(address: string, point?: Point): string {
    const region = listingRegion(point);
    const url = new URL(`${region.cianOrigin}/cat.php`);
    url.search = new URLSearchParams({ deal_type: 'sale', engine_version: '2', offer_type: 'flat', region: region.cianRegion }).toString();
    if (point) {
      const { lat, lng } = point;
      url.searchParams.set('in_polygon[1]', [[lng - 0.0012, lat - 0.0006], [lng + 0.0012, lat - 0.0006], [lng + 0.0012, lat + 0.0006], [lng - 0.0012, lat + 0.0006], [lng - 0.0012, lat - 0.0006]].map((p) => p.join('_')).join(','));
      url.searchParams.set('polygon_name[1]', address);
    }
    return url.href;
  }
  /** Preserves the legacy mechanism and uses modern search as a fallback, without caching advertisements. */
  async lookup(address: string, signal?: AbortSignal, point?: Point, area?: ListingSearchArea): Promise<ApartmentListing[]> {
    if (!point) return [];
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cached = parseCianListings({ offers: this.cache.allOffers() }, address, point);
    if (cached.length) return cached;
    let failure: unknown;
    // Strategy/Chain of Responsibility: retain the working manifest route, then try the current POST API.
    for (const search of [() => this.legacyLookup(address, signal, point), () => this.modernLookup(address, signal, point, area)]) {
      try { const listings = await search(); if (listings.length) return listings; }
      catch (error) { if (signal?.aborted) throw error; failure = error; }
    }
    if (failure) throw failure;
    return [];
  }

  private async modernLookup(address: string, signal: AbortSignal | undefined, point: Point, area?: ListingSearchArea): Promise<ApartmentListing[]> {
    const bounds = area && area.south <= point.lat && area.north >= point.lat && area.west <= point.lng && area.east >= point.lng
      ? area : { south: point.lat - 0.0006, west: point.lng - 0.0012, north: point.lat + 0.0006, east: point.lng + 0.0012 };
    const payload = { subdomain: 'www', noMlRanking: true, isPinWithPrice: false, liquiditySource: 'web_serp_map',
      path: `/v1/get-results-for-map?${this.mapParameters(point, bounds)}` };
    let offers = this.cache.get(bounds, 'modern');
    if (!offers) {
      offers = decodeCianOffers(JSON.parse(await this.post('https://api.cian.ru/search-engine/v1/search-offers-mobile-site/', payload, signal)));
      this.cache.remember(bounds, 'modern', offers);
    }
    return parseCianListings({ offers }, address, point);
  }

  private async legacyLookup(address: string, signal?: AbortSignal, point?: Point): Promise<ApartmentListing[]> {
    if (!point) return [];
    const bounds = { south: point.lat - 0.0006, west: point.lng - 0.0012, north: point.lat + 0.0006, east: point.lng + 0.0012 };
    const cached = this.cache.get(bounds, 'legacy');
    if (cached) return parseCianListings({ offers: cached }, address, point);
    const url = new URL('https://api.cian.ru/mobile-search-frontend/v1/get-results-for-map-microfrontend/');
    url.search = this.mapParameters(point).toString();
    const offers = decodeCianOffers(JSON.parse(await this.read(url.href, signal)));
    this.cache.remember(bounds, 'legacy', offers);
    return parseCianListings({ offers }, address, point);
  }

  private mapParameters(point: Point, area?: ListingSearchArea): URLSearchParams {
    const region = listingRegion(point);
    return new URLSearchParams({
      bbox: area ? `${area.south},${area.west},${area.north},${area.east}` : `${point.lat - 0.0006},${point.lng - 0.0012},${point.lat + 0.0006},${point.lng + 0.0012}`,
      center: `${point.lat},${point.lng}`, deal_type: 'sale', engine_version: '2', offer_type: 'flat',
      parentOrigin: region.cianOrigin, pinType: 'Regular', region: region.cianRegion, zoom: '19', source: 'search_string',
      isFromJkPin: 'false', isFromSpecprojectPin: 'false', isGlow: 'false', isLeadsBannerVisible: '1',
      isNavigationDisabled: '1', liquiditySource: 'web_serp_map',
    });
  }
}
