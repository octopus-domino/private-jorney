import { z } from 'zod';
import type { ApartmentListingsRepository } from '../../application/ports/ApartmentListingsRepository';
import type { ApartmentListing } from '../../domain/ApartmentListing';
import { matchHouseAddress } from '../../shared/address';
import { haversineMeters } from '../../shared/geo';
import { readExternalPage } from './readExternalPage';
import { listingRegion } from './listingRegion';

type Point = { lat: number; lng: number };
const itemSchema = z.object({
  id: z.number().int().positive(), categoryId: z.literal(24), title: z.string().min(1), urlPath: z.string(),
  priceDetailed: z.object({ value: z.number().positive(), enabled: z.boolean(), hasValue: z.boolean() }),
  geo: z.object({ formattedAddress: z.string() }),
  coords: z.object({ lat: z.coerce.number().finite(), lng: z.coerce.number().finite() }),
  realtyInfo: z.object({ transactionType: z.literal('sell') }),
  isSimilarToSearch: z.boolean().optional(), turnOffDate: z.union([z.boolean(), z.string()]).optional(),
  images: z.array(z.record(z.string())).optional(),
});

export function parseAvitoMapListings(response: unknown, address: string, point: Point): ApartmentListing[] {
  const data = z.object({ items: z.array(z.unknown()) }).parse(response);
  const listings: ApartmentListing[] = [];
  for (const raw of data.items) {
    const result = itemSchema.safeParse(raw);
    if (!result.success) continue;
    const item = result.data;
    if (!item.priceDetailed.enabled || !item.priceDetailed.hasValue || item.isSimilarToSearch || item.turnOffDate) continue;
    const match = matchHouseAddress(address, item.geo.formattedAddress, haversineMeters(point, item.coords));
    if (!match) continue;
    const url = new URL(item.urlPath, 'https://www.avito.ru');
    if (url.origin !== 'https://www.avito.ru' || !new RegExp(`^/${listingRegion(point).avitoCity}/kvartiry/[^/]+_\\d+$`).test(url.pathname)) continue;
    const image = item.images?.[0]?.['416x416'] ?? item.images?.[0]?.['318x318'];
    listings.push({ id: String(item.id), title: item.title, address: item.geo.formattedAddress, priceRub: item.priceDetailed.value,
      url: `${url.origin}${url.pathname}`, imageUrl: image && /^https:\/\/[a-z\d]+\.img\.avito\.st\//.test(image) ? image : undefined,
      matchNote: match === 'corner-address' ? 'Угловой дом: двойной номер указан в обратном порядке; расположение совпадает.'
        : match === 'main-letter-omitted' ? 'Основная литера А опущена в одном из адресов; совпадают улица, номер и расположение дома.' : undefined });
  }
  return [...new Map(listings.map((listing) => [listing.id, listing])).values()].slice(0, 6);
}

export class AvitoApartmentListingsRepository implements ApartmentListingsRepository {
  constructor(private readonly read = readExternalPage) {}
  searchUrl(address: string, point?: Point): string {
    const url = new URL(`https://www.avito.ru/${listingRegion(point).avitoCity}/kvartiry/prodam`);
    url.searchParams.set('q', address);
    return url.href;
  }
  async lookup(address: string, signal?: AbortSignal, point?: Point): Promise<ApartmentListing[]> {
    if (!point) return [];
    const area = { latBottom: point.lat - 0.0006, latTop: point.lat + 0.0006, lonLeft: point.lng - 0.0012, lonRight: point.lng + 0.0012 };
    const url = new URL('https://www.avito.ru/js/1/map/items');
    const params = new URLSearchParams({ categoryId: '24', locationId: listingRegion(point).avitoLocation, correctorMode: '0', page: '1',
      map: btoa(JSON.stringify({ searchArea: area })), 'params[201]': '1059', 'params[178133]': '1',
      originalLocationRadiusEnabled: 'true', verticalCategoryId: '1', rootCategoryId: '4', localPriority: '0',
      'viewPort[width]': '1010', 'viewPort[height]': '1111', limit: '10', countAndItemsOnly: '1' });
    for (const [key, value] of Object.entries(area)) params.set(`searchArea[${key}]`, String(value));
    url.search = params.toString();
    return parseAvitoMapListings(JSON.parse(await this.read(url.href, signal)), address, point);
  }
}
