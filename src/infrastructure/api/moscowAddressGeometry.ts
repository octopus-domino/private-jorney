import { z } from 'zod';
import { projectToSegment } from '../../domain/pathGeometry';
import type { GeoPoint } from '../../domain/walkGraph';

type Ring = number[][];
export interface MoscowAddress { unom: number; address: string; polygons: Ring[][] }
const attributes = z.object({ UNOM: z.number().int().positive(), SIMPLE_ADDRESS: z.string(), OBJ_TYPE_PUBLIC: z.string() });
const geometry = z.object({ type: z.enum(['Polygon', 'MultiPolygon']), coordinates: z.unknown() });
const ring = z.array(z.tuple([z.number().finite(), z.number().finite()]));

/** Extracts building contours only; land parcels and administrative documents are deliberately excluded. */
export function parseMoscowAddresses(payload: unknown): MoscowAddress[] {
  const data = z.object({ features: z.array(z.unknown()) }).parse(payload);
  return data.features.flatMap(item => {
    const feature = z.object({ properties: z.object({ attributes }), geometry }).safeParse(item);
    if (!feature.success || feature.data.properties.attributes.OBJ_TYPE_PUBLIC !== 'здание') return [];
    const shape = feature.data.geometry;
    const polygons = z.array(z.array(ring)).safeParse(shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates);
    const values = feature.data.properties.attributes;
    return polygons.success ? [{ unom: values.UNOM, address: values.SIMPLE_ADDRESS, polygons: polygons.data }] : [];
  });
}

/** Chooses the containing building, or one unambiguous nearby contour, rather than the company's office. */
export function matchMoscowAddress(point: GeoPoint, addresses: MoscowAddress[]): MoscowAddress | null {
  const candidates = addresses.map(address => ({ address, distance: contourDistance(point, address.polygons) }))
    .filter(candidate => candidate.distance <= 35).sort((a, b) => a.distance - b.distance);
  if (!candidates.length || candidates[1] && candidates[1].distance - candidates[0].distance < 8) return null;
  return candidates[0].address;
}

function contourDistance(point: GeoPoint, polygons: Ring[][]): number {
  let best = Infinity;
  for (const rings of polygons) {
    if (rings[0] && insideRing(point, rings[0]) && !rings.slice(1).some(hole => insideRing(point, hole))) return 0;
    for (const boundary of rings) for (let index = 0; index < boundary.length; index++) {
      const a = boundary[index], b = boundary[(index + 1) % boundary.length];
      best = Math.min(best, projectToSegment(point, { lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }).distance);
    }
  }
  return best;
}

function insideRing(point: GeoPoint, boundary: Ring): boolean {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [xi, yi] = boundary[i], [xj, yj] = boundary[j];
    if ((yi > point.lat) !== (yj > point.lat) && point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
