// src/domain/Poi.ts
export type PoiSource = 'overpass' | 'manual' | 'entry' | 'historical-house' | 'mystic-place';
export type OsmElementType = 'node' | 'way' | 'relation';

export interface PoiDetails {
  address?: string;
  architect?: string;
  yearBuilt?: number;
  style?: string;
  heritageStatus?: string;
  historicalFacts?: string[];
  mysticalFacts?: string[];
  sourceUrl?: string;
  photos?: string[];
}

export interface Poi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  categoryIds: string[];
  summary?: string;
  facts: string[];
  photoCount?: number;
  source: PoiSource;
  osmType?: OsmElementType;
  osmId?: number;
  buildingHistoryId?: number;
  details?: PoiDetails;
}