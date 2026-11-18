import { z } from 'zod';
import type { BuildingProfile } from '../../domain/BuildingProfile';
import type { PlaceHistory } from '../../application/ports/PlaceHistoryRepository';
import { PersistentSuccessCache } from '../../shared/persistentSuccessCache';
import { maintenanceSchema } from './moscowMaintenanceRepository';

const DAY_MS = 24 * 60 * 60 * 1000;
const count = z.number().finite().nonnegative().nullable();
const location = z.object({ lat: z.number().finite(), lng: z.number().finite() });
const historySchema = z.object({
  title: z.string().optional(), excerpt: z.string().min(30),
  sourceUrl: z.string().regex(/^https:\/\/www\.citywalls\.ru\/house\d+\.html$/),
  imageUrl: z.string().regex(/^https:\/\/(?:p\d+|img)\.citywalls\.ru\//).optional(),
});
export const baseProfileSchema = z.object({
  passportStatus: z.enum(['updating', 'not-published']).optional(),
  maintenance: maintenanceSchema.optional(), maintenanceUnavailable: z.boolean().optional(),
  address: z.string(), sourceUrl: z.string().url(), sourceName: z.string().optional(),
  fetchedAt: z.string().datetime(), location: location.optional(), yearBuilt: count, floors: count,
  residents: count, communalFlats: count, separateFlats: count,
  ages: z.object({ children: count, working: count, older: count }),
  wear: z.record(z.number().finite().nonnegative()),
  repairs: z.array(z.object({ year: z.number(), work: z.string() })),
  features: z.array(z.object({ label: z.string(), value: z.string(), detail: z.string().optional() })),
  plans: z.array(z.object({ work: z.string(), startYear: z.number(), endYear: z.number() })), plansAvailable: z.boolean(),
});
const profileSchema = baseProfileSchema.extend({ sourceUrl: z.string().regex(/^https:\/\/gorod\.gov\.spb\.ru\/facilities\/\d+\/info\/$/) });

/** Historical text changes slowly; cached successes survive seven days and app restarts. */
export function createHistoryCache() {
  return new PersistentSuccessCache<PlaceHistory>('private-walks/cache/citywalls/v1', 7 * DAY_MS,
    (raw) => { const result = historySchema.safeParse(raw); return result.success ? result.data : undefined; });
}

/** City passport snapshots remain local for one day; their original fetchedAt stays visible. */
export function createProfileCache() {
  return new PersistentSuccessCache<BuildingProfile>('private-walks/cache/building-passports/v2', DAY_MS,
    (raw) => { const result = profileSchema.safeParse(raw); return result.success ? result.data : undefined; });
}
