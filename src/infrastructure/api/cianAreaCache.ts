import { z } from 'zod';
import type { ListingSearchArea } from '../../application/ports/ApartmentListingsRepository';
import { PersistentSuccessCache } from '../../shared/persistentSuccessCache';

const TTL_MS = 10 * 60 * 1000;
const MAX_AREAS = 12;
const entrySchema = z.object({
  area: z.object({ south: z.number(), west: z.number(), north: z.number(), east: z.number() }),
  offers: z.array(z.unknown()), strategy: z.enum(['legacy', 'modern']),
});
type Strategy = 'legacy' | 'modern';
interface AreaEntry<T> { area: ListingSearchArea; offers: T[]; strategy: Strategy }

/** Cache-Aside: retains sanitized successful area responses and separates empty legacy/modern results. */
export class CianAreaCache<T> {
  private readonly cache: PersistentSuccessCache<AreaEntry<T>>;

  /** Injects offer validation and time; cached records never include contacts or authentication tokens. */
  constructor(decode: (response: unknown) => T[], now = Date.now) {
    this.cache = new PersistentSuccessCache('private-walks/cache/cian-areas/v1', TTL_MS, raw => {
      const entry = entrySchema.safeParse(raw);
      if (!entry.success) return undefined;
      try { return { ...entry.data, offers: decode({ offers: entry.data.offers }) }; }
      catch { return undefined; }
    }, () => globalThis.localStorage, now, MAX_AREAS);
  }

  /** Reuses a successful response for the same bbox and strategy for ten minutes. */
  get(area: ListingSearchArea, strategy: Strategy): T[] | undefined {
    return this.cache.get(this.key(area, strategy))?.offers;
  }

  /** Stores parsed offers, including a valid empty response; errors never reach this operation. */
  remember(area: ListingSearchArea, strategy: Strategy, offers: T[]): void {
    this.cache.set(this.key(area, strategy), { area, strategy, offers });
  }

  /** Lets a selected house reuse offers previously found anywhere in the cached map areas. */
  allOffers(): T[] { return this.cache.values().flatMap(entry => entry.offers); }

  private key(area: ListingSearchArea, strategy: Strategy): string {
    return `${strategy}:${[area.south, area.west, area.north, area.east].map(value => value.toFixed(6)).join(',')}`;
  }
}
