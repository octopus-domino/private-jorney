// src/application/use-cases/placeToPoi.ts
import type { PlaceDto } from '../ports/PlaceRepository';
import type { Poi } from '../../domain/Poi';

/**
 * PlaceDto → Poi.
 * `categoryId` — id категории, к которой относится этот результат
 * (одна из POI_CATEGORIES с source='themed' или 'osm').
 */
export function placeToPoi(dto: PlaceDto, categoryId: string): Poi {
  const source = dto.source ?? 'osm';
  const isMystic = source === 'mystic' || categoryId === 'mystical';

  const facts: string[] = [];
  if (dto.openingHours) facts.push(`Часы: ${dto.openingHours}`);
  if (dto.description) facts.push(dto.description.slice(0, 200));
  if (dto.wikidataSitelinks && dto.wikidataSitelinks > 0)
    facts.push(`Wikidata: ${dto.wikidataSitelinks} языков`);

  return {
    id: `place:${dto.id}`,
    name: dto.label,
    lat: dto.latitude,
    lng: dto.longitude,
    categoryIds: [categoryId],
    summary: dto.description ?? undefined,
    facts,
    photoCount: dto.photoReference ? 1 : undefined,
    source: isMystic ? 'mystic-place' : 'overpass',
    details: {
      mysticalFacts: isMystic && dto.description ? [dto.description] : undefined,
      historicalFacts: !isMystic && dto.description ? [dto.description] : undefined,
      sourceUrl: dto.url,
      photos: dto.photoReference ? [dto.photoReference] : undefined,
    },
  };
}