// src/application/use-cases/historicalHouseToPoi.ts
import type { HistoricalHouseDto } from '../../domain/HistoricalHouse';
import type { Poi } from '../../domain/Poi';

/**
 * Конвертер ответа /api/journeys/buildings/nearby → Poi.
 * Все поля BuildingHistoryService.Info переносятся в facts и details.
 */
export function historicalHouseToPoi(dto: HistoricalHouseDto): Poi {
  const facts: string[] = [];
  if (dto.constructionPeriod) facts.push(`Период: ${dto.constructionPeriod}`);
  else if (dto.constructionYear) facts.push(`Год: ${dto.constructionYear}`);
  if (dto.architect) facts.push(`Архитектор: ${dto.architect}`);
  if (dto.style) facts.push(`Стиль: ${dto.style}`);
  if (dto.heritageStatus) facts.push(`Статус: ${dto.heritageStatus}`);

  return {
    id: `history:${dto.id}`,
    name: dto.name ?? dto.address ?? `Дом #${dto.id}`,
    lat: dto.latitude,
    lng: dto.longitude,
    categoryIds: ['historical-house'],
    summary: dto.address ?? undefined,
    facts,
    source: 'historical-house',
    buildingHistoryId: dto.id,
    details: {
      address: dto.address ?? undefined,
      architect: dto.architect ?? undefined,
      yearBuilt: dto.constructionYear ?? undefined,
      style: dto.style ?? undefined,
      heritageStatus: dto.heritageStatus ?? undefined,
      historicalFacts: facts,
      sourceUrl: dto.sourceUrl ?? undefined,
    },
  };
}