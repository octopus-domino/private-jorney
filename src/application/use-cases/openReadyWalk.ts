import presets from '../../domain/readyWalks.json';
import type { WalkDraft } from '../../domain/WalkDraft';
import type { Poi } from '../../domain/Poi';
import { newId } from '../../shared/id';

export const readyWalks = presets;

/** Copies a curated walk into an editable draft; the usual planner builds its roads. */
export function createReadyWalk(id: string): WalkDraft | null {
  const preset = presets.find(walk => walk.id === id);
  if (!preset) return null;

  const pois: Poi[] = preset.places.map(place => ({
    id: place.id, name: place.label, lat: place.latitude, lng: place.longitude,
    categoryIds: ['cultural'], source: 'entry', summary: place.description,
    facts: [place.description], details: { sourceUrl: place.url },
  }));
  const now = new Date().toISOString();
  return {
    id: newId('walk'), title: preset.title, city: 'Санкт-Петербург',
    area: { anchors: [{ id: newId('anchor'), lat: pois[0].lat, lng: pois[0].lng, label: pois[0].name }], radiusMeters: 800 },
    selectedCategoryIds: ['cultural'], selectedPoiIds: pois.map(poi => poi.id),
    savedPois: pois, view: 'map', createdAt: now, updatedAt: now,
  };
}
