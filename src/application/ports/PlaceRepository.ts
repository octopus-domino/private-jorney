// src/application/ports/PlaceRepository.ts
export type PlaceKind = 'attractions' | 'hotels';

export interface PlaceSearchParams {
  lon: number;
  lat: number;
  kind?: PlaceKind;
  language: string;
  /** backend-тема: 'mystic', 'history', … — как отдаёт /themes */
  theme?: string;
  /** Area discovery combines all selected themes in a single CoDoc request. */
  themes?: string[];
  radiusKm?: number;
  /** LocalDateTime ISO, для учёта часов работы */
  visitTime?: string;
  maxStops?: number;
  maxSitelinks?: number;
  signal?: AbortSignal;
}

/**
 * 1:1 с PlaceRecommendationsController.Place.
 * Поля — то, что реально отдаёт бэк.
 */
export interface PlaceDto {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
  url: string;
  schedule?: unknown;
  openingHours?: string | null;
  photoReference?: string | null;
  visitStatus?: string | null;
  wikidataSitelinks?: number | null;
  inOsm?: boolean | null;
  source?: string | null;
  wikimapiaId?: string | null;
  description?: string | null;
  meta?: Record<string, string> | null;
  score?: number | null;
}

export interface PlaceResultDto {
  available: boolean;
  places: PlaceDto[];
  source: string;
}

export interface PlaceRepository {
  search(params: PlaceSearchParams): Promise<PlaceResultDto>;
  themes(signal?: AbortSignal): Promise<string[]>;
}
