// src/application/ports/HistoricalHouseRepository.ts
import type { HistoricalHouseDto } from '../../domain/HistoricalHouse';

export interface BuildingSearchParams {
  lon: number;
  lat: number;
  radiusKm?: number;
  limit?: number;
  q?: string;
  beforeYear?: number;
  signal?: AbortSignal;
}

export interface HistoricalHouseRepository {
  nearby(params: BuildingSearchParams): Promise<HistoricalHouseDto[]>;
  byPoint(lon: number, lat: number, signal?: AbortSignal): Promise<HistoricalHouseDto | null>;
}