// src/application/ports/Geocoder.ts
export interface GeocodeHit {
  lat: number;
  lng: number;
  label: string;
}

export interface Geocoder {
  search(query: string, signal?: AbortSignal): Promise<GeocodeHit[]>;
  reverse(lat: number, lng: number, signal?: AbortSignal): Promise<{ label: string; city?: string }>;
}
