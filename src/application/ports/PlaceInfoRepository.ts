// src/application/ports/PlaceInfoRepository.ts
import type { PlaceInfo } from '../../domain/PlaceInfo';

export interface PlaceInfoRepository {
  /**
   * Возвращает информацию о произвольной точке на карте.
   * null — если ни Википедия, ни геокодер ничего не знают.
   */
  lookup(lat: number, lng: number, signal?: AbortSignal): Promise<PlaceInfo | null>;
}