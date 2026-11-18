// src/application/ports/PoiRepository.ts
import type { Poi } from '../../domain/Poi';

export interface PoiSearchParams {
  anchors: Array<{ lat: number; lng: number }>;
  radiusMeters: number;
  categoryIds: string[];
  signal?: AbortSignal;
  onPartial?(points: Poi[]): void;
}

export interface PoiRepository {
  search(params: PoiSearchParams): Promise<Poi[]>;
}
