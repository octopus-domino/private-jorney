import { z } from 'zod';

const coordinate = z.number().finite();
const geometry = z.array(z.tuple([coordinate, coordinate]));
export const poiSchema = z.object({
  id: z.string(), name: z.string(), lat: coordinate, lng: coordinate,
  categoryIds: z.array(z.string()), facts: z.array(z.string()),
  source: z.enum(['overpass', 'manual', 'entry', 'historical-house', 'mystic-place']),
  summary: z.string().optional(),
  details: z.object({ address: z.string().optional(), sourceUrl: z.string().optional(), historicalFacts: z.array(z.string()).optional(), mysticalFacts: z.array(z.string()).optional(), photos: z.array(z.string()).optional() }).passthrough().optional(),
}).passthrough();
const route = z.object({
  geometry, totalDistanceMeters: z.number().nonnegative(), totalDurationSeconds: z.number().nonnegative(),
  legs: z.array(z.object({ fromIndex: z.number().int().nonnegative(), toIndex: z.number().int().nonnegative(), distanceMeters: z.number().nonnegative(), durationSeconds: z.number().nonnegative(), geometry })),
});
export const savedWalkSchema = z.object({
  id: z.string(), title: z.string(), createdAt: z.string(), updatedAt: z.string(), view: z.enum(['map', 'list']),
  area: z.object({ radiusMeters: z.number().positive(), anchors: z.array(z.object({ id: z.string(), lat: coordinate, lng: coordinate, label: z.string().optional() })) }),
  selectedCategoryIds: z.array(z.string()), selectedPoiIds: z.array(z.string()),
  savedPois: z.array(poiSchema).optional(), savedRoute: route.nullable().optional(), savedFailedSegments: z.array(z.number().int().nonnegative()).optional(),
  city: z.string().optional(),
});
