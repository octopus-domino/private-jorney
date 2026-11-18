// src/domain/SearchArea.ts
export interface AnchorPoint {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}

export interface SearchArea {
  anchors: AnchorPoint[];
  radiusMeters: number;
}