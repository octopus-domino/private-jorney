import { withRequestDeadline } from '../../shared/withRequestDeadline';
const CACHE_NAME = 'private-walks/report-map-tiles/v1';
const MAX_TILES = 96;
const FRESH_MS = 7 * 86400000;

/** Cache-Aside: only tiles actually viewed in a saved report are retained, with a fixed storage bound. */
export class MapTileCache {
  private writes = Promise.resolve();

  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init), private readonly storage = globalThis.caches) {}

  async read(url: string, signal?: AbortSignal): Promise<Blob> {
    const key = url.replace(/https:\/\/[abc]\.tile\./, 'https://tile.');
    const cache = await this.open();
    const cached = await cache?.match(key);
    if (cached && Date.now() - Number(cached.headers.get('x-saved-at')) < FRESH_MS) return cached.blob();
    try {
      const blob = await withRequestDeadline(async abort => {
        const response = await this.fetcher(key, { signal: abort, credentials: 'omit' });
        if (!response.ok) throw new Error(`Map tile: ${response.status}`);
        return response.blob();
      }, 10000, signal);
      if (cache && blob.size < 512000) await this.save(cache, key, blob);
      return blob;
    } catch (error) {
      if (cached && !signal?.aborted) return cached.blob();
      throw error;
    }
  }

  private async open(): Promise<Cache | null> {
    try { return this.storage ? await this.storage.open(CACHE_NAME) : null; }
    catch (error) { console.info('Map tile cache unavailable; using online tiles', error); return null; }
  }

  private async save(cache: Cache, key: string, blob: Blob): Promise<void> {
    this.writes = this.writes.catch(error => console.info('Previous tile cache write unavailable', error)).then(async () => {
      await cache.put(key, new Response(blob, { headers: { 'Content-Type': blob.type, 'x-saved-at': String(Date.now()) } }));
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map(key => cache.delete(key)));
    });
    try { await this.writes; }
    catch (error) { console.info('Map tile remains available for this view only', error); }
  }
}
