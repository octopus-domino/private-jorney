import { z } from 'zod';
import type { RawWalkSession } from '../../domain/RecordedWalk';

const pointSchema = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative(), timestamp: z.number().finite() });
const sessionSchema = z.object({ id: z.string(), startedAt: z.number().finite(), endedAt: z.number().finite().optional(),
  state: z.enum(['recording', 'stopped', 'interrupted']), pointCount: z.number().nonnegative(), distanceMeters: z.number().finite().nonnegative(),
  lastPoint: pointSchema.optional(), points: z.array(z.unknown()).optional(),
  gpsMode: z.enum(['economy', 'balanced', 'precise']).optional(), lastAccuracy: z.number().finite().nonnegative().optional() });

/** A damaged trailing sample cannot invalidate a complete native or browser recording. */
export function parseRecording(value: unknown): RawWalkSession {
  const session = sessionSchema.parse(value);
  const points = session.points?.flatMap(point => { const parsed = pointSchema.safeParse(point); return parsed.success ? [parsed.data] : []; });
  return { ...session, points, pointCount: points?.length ?? session.pointCount };
}
