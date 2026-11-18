import type { ApartmentListing } from '../../domain/ApartmentListing';
export interface ListingSearchArea { south: number; west: number; north: number; east: number }
export interface ApartmentListingsRepository {
  prefetch?(area: ListingSearchArea, signal?: AbortSignal): Promise<void>;
  searchUrl(address: string, point?: { lat: number; lng: number }): string;
  lookup(address: string, signal?: AbortSignal, point?: { lat: number; lng: number }, area?: ListingSearchArea): Promise<ApartmentListing[]>;
}
