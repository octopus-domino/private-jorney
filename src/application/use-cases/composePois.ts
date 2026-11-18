// src/application/use-cases/composePois.ts
import type { Poi } from '../../domain/Poi';

export interface ComposeInput {
  /** точки, добавленные вручную или пришедшие из пресета — всегда сверху */
  pinned?: Poi[];
  /** из /buildings/nearby */
  buildings?: Poi[];
  /** из /themed — все выбранные темы, уже объединённые */
  themed?: Poi[];
  /** из /places?kind=attractions */
  attractions?: Poi[];
}

/**
 * Объединяет источники без дубликатов по id.
 * Порядок: pinned → buildings → themed → attractions.
 */
export function composePois(input: ComposeInput): Poi[] {
  const seen = new Set<string>();
  const result: Poi[] = [];

  const sources = [
    input.pinned ?? [],
    input.buildings ?? [],
    input.themed ?? [],
    input.attractions ?? [],
  ];

  for (const source of sources) {
    for (const poi of source) {
      if (seen.has(poi.id)) continue;
      seen.add(poi.id);
      result.push(poi);
    }
  }

  return result;
}