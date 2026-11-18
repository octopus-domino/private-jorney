import type { PlaceHistory, PlaceHistoryRepository } from '../../application/ports/PlaceHistoryRepository';
import type { Poi } from '../../domain/Poi';
import { citywallsSquares, parseCitywallsPoints, matchCitywallsPoint } from './citywallsMap';
import { readExternalPage } from './readExternalPage';
import { createHistoryCache } from './buildingSuccessCaches';
import type { SuccessCache } from '../../shared/persistentSuccessCache';
import { SharedRequestPool } from '../../shared/sharedRequestPool';
import { readCitywallsStage } from './citywallsSourceError';
import { CitywallsMapCache } from './citywallsMapCache';
import type { CitywallsPoint } from './citywallsMap';

const SITE = 'https://www.citywalls.ru';
export class CitywallsHistoryRepository implements PlaceHistoryRepository {
  private readonly squares = new Map<number, ReturnType<typeof parseCitywallsPoints>>();
  private sid: string | null = null;
  private readonly sessions = new SharedRequestPool<string>();
  private readonly squareRequests = new SharedRequestPool<ReturnType<typeof parseCitywallsPoints>>();

  constructor(private readonly read = readExternalPage, private readonly cache: SuccessCache<PlaceHistory> = createHistoryCache(),
    private readonly mapCache: SuccessCache<CitywallsPoint[]> = new CitywallsMapCache()) {}

  /** Keeps text/title rerenders from restarting the same building lookup. */
  requestKey(poi: Poi): string {
    const id = poi.details?.sourceUrl?.match(/^https:\/\/www\.citywalls\.ru\/house(\d+)\.html/);
    return id ? `house:${id[1]}` : `${poi.lat}:${poi.lng}:${poi.details?.sourceUrl ?? ''}`;
  }

  supports(poi: Poi): boolean { return citywallsSquares(poi).length > 0; }

  private async session(signal?: AbortSignal): Promise<string> {
    if (this.sid) return this.sid;
    return this.sessions.run('session', async shared => {
      const sid = await readCitywallsStage('map', async () => {
        const html = await this.read(`${SITE}/map_around.html`, shared);
        const value = html.match(/SID:\s*["']s=([a-z\d]+)["']/i)?.[1];
        if (!value) throw new Error('Citywalls map format changed');
        return value;
      }, shared);
      this.sid = sid;
      return sid;
    }, signal);
  }

  private async square(id: number, signal?: AbortSignal) {
    const cached = this.squares.get(id) ?? this.mapCache.get(String(id));
    if (cached) { this.squares.set(id, cached); return cached; }
    return this.squareRequests.run(String(id), async shared => {
      const entries = await this.loadSquare(id, await this.session(shared), shared);
      if (this.squares.size >= 12) this.squares.delete(this.squares.keys().next().value!);
      this.squares.set(id, entries);
      this.mapCache.set(String(id), entries);
      return entries;
    }, signal);
  }

  async lookup(poi: Poi, signal?: AbortSignal): Promise<PlaceHistory | null> {
    if (!this.supports(poi)) return null;
    const key = this.requestKey(poi);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cached = this.cache.get(key);
    if (cached) return cached;
    let houseId = poi.details?.sourceUrl?.match(/^https?:\/\/(?:www\.)?citywalls\.ru\/house(\d+)\.html(?:\?.*)?$/i)?.[1];
    let matchedTitle: string | undefined;
    if (!houseId) {
      const squareIds = citywallsSquares(poi);
      for (const square of squareIds) {
        await this.square(square, signal);
      }
      const match = matchCitywallsPoint(poi, squareIds.flatMap((id) => this.squares.get(id) ?? []));
      if (!match) return null;
      houseId = String(match.id);
      matchedTitle = match.title;
    }
    const sourceUrl = `${SITE}/house${houseId}.html`;
    const doc = new DOMParser().parseFromString(await readCitywallsStage('house', () => this.read(sourceUrl, signal), signal), 'text/html');
    const paragraph = Array.from(doc.querySelectorAll('.mceContentBody p'))
      .map((p) => p.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter((text) => text.length >= 80).slice(0, 2).join('\n\n');
    const description = paragraph || doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim();
    if (!description || description.length < 30) return null;
    const photoSrc = doc.querySelector('img[src*="/thumb0_"], .cssPhotoList .photo img')?.getAttribute('src');
    let imageUrl: string | undefined;
    if (photoSrc) {
      const photo = new URL(photoSrc, SITE);
      if (photo.protocol === 'https:' && /^(p\d+|img)\.citywalls\.ru$/.test(photo.hostname)) {
        photo.pathname = photo.pathname.replace(/\/thumb0?_/, '/photo_');
        imageUrl = photo.href;
      }
    }
    const result = { excerpt: description, sourceUrl, imageUrl,
      title: doc.querySelector('.cssHouseHead h1')?.textContent?.trim() ?? matchedTitle };
    this.cache.set(key, result);
    return result;
  }

  private async loadSquare(square: number, sid: string, signal?: AbortSignal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = new URL(`${SITE}/include/map_handler.php`);
      url.search = new URLSearchParams({ action: 'load_geodata_cache', list: 'al', square: String(square), zoom: '15', s: sid }).toString();
      const data = await readCitywallsStage('points', async () => JSON.parse(await this.read(url.href, signal)), signal);
      if (data.result === 'ok') return parseCitywallsPoints(data.geodata);
      this.sid = null;
      if (attempt === 0) sid = await this.session(signal);
    }
    throw new Error('Citywalls map unavailable after session refresh');
  }
}
