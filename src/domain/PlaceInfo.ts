// src/domain/PlaceInfo.ts
export type PlaceInfoSource = 'wikipedia' | 'reverse';

export interface PlaceInfo {
  lat: number;
  lng: number;
  title: string;
  /** Короткое пояснение — адрес из Photon или заголовок статьи */
  subtitle?: string;
  /** Вступительный текст из Википедии (3 предложения) */
  extract?: string;
  thumbnailUrl?: string;
  wikipediaUrl?: string;
  source: PlaceInfoSource;
}