// src/domain/HistoricalHouse.ts
/**
 * 1:1 с ru.ticket.journey.BuildingHistoryService.Info.
 * Координаты — interior point geometry (lon/lat).
 */
export interface HistoricalHouseDto {
  id: number;
  osmId: string | null;
  address: string | null;
  constructionYear: number | null;
  architect: string | null;
  style: string | null;
  heritageStatus: string | null;
  source: string;
  sourceUrl: string | null;
  longitude: number;
  latitude: number;
  name: string | null;
  constructionPeriod: string | null;
}