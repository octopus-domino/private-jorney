import indexUrl from '../data/citywallsIndex.json?url';
import { CitywallsIndexStore } from '../persistence/citywallsIndexStore';
import { parseCitywallsPoints, type CitywallsPoint } from './citywallsMap';
import { readExternalPage } from './readExternalPage';

type Row = [number, number, number];
const DAY_MS = 86400000;
const SITE = 'https://www.citywalls.ru';

/** Local-first catalogue: opening a house never downloads the Citywalls map. */
export class CitywallsLocalIndex {
  private ready?: Promise<CitywallsPoint[]>;
  private updating = false;

  constructor(private readonly load: () => Promise<unknown> = () => fetch(indexUrl).then(r => {
    if (!r.ok) throw new Error('Offline Citywalls index unavailable');
    return r.json();
  }), private readonly store: Pick<CitywallsIndexStore, 'read' | 'write' | 'claimAttempt'> = new CitywallsIndexStore(),
    private readonly read = readExternalPage, private readonly now = Date.now) {}

  /** Lazily loads the packaged file once and overlays only validated successful daily updates. */
  async points(): Promise<CitywallsPoint[]> {
    this.ready ??= this.restore().catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }

  /** One attempt per day, including failures; no card rendering or coordinate jitter can retrigger it. */
  async refresh(square: number): Promise<void> {
    if (this.updating || !Number.isInteger(square) || square < 0 || square > 99) return;
    this.updating = true;
    try {
      const state = await this.store.claimAttempt(this.now(), DAY_MS);
      if (!state) return;
      const rows = await this.download(square);
      await this.store.write({ ...state, squares: { ...state.squares, [square]: rows } });
      this.ready = undefined;
    } finally { this.updating = false; }
  }

  private async restore(): Promise<CitywallsPoint[]> {
    const values = this.decode(await this.load());
    let updates: Row[] = [];
    try { updates = Object.values((await this.store.read()).squares).flat(); }
    catch (error) { console.info('Citywalls updates unavailable; bundled index retained', error); }
    const unique = new Map(values.map(point => [point.id, point]));
    for (const point of this.decode(updates)) unique.set(point.id, point);
    return [...unique.values()].sort((a, b) => a.lat - b.lat);
  }

  private decode(value: unknown): CitywallsPoint[] {
    if (!Array.isArray(value)) throw new Error('Invalid Citywalls index');
    return value.flatMap(row => Array.isArray(row) && row.length === 3 && Number.isInteger(row[0])
      && row[0] > 0 && Number.isFinite(row[1]) && Math.abs(row[1]) <= 90
      && Number.isFinite(row[2]) && Math.abs(row[2]) <= 180
      ? [{ id: row[0], lat: row[1], lng: row[2], title: '' }] : []);
  }

  private async download(square: number): Promise<Row[]> {
    const html = await this.read(`${SITE}/map_around.html`);
    const sid = html.match(/SID:\s*["']s=([a-z\d]+)["']/i)?.[1];
    if (!sid) throw new Error('Citywalls did not provide a map session');
    const query = new URLSearchParams({ action: 'load_geodata_cache', list: 'al', square: String(square), zoom: '15', s: sid });
    const data = JSON.parse(await this.read(`${SITE}/include/map_handler.php?${query}`));
    if (data.result !== 'ok') throw new Error('Citywalls index update unavailable');
    const points = parseCitywallsPoints(data.geodata);
    if (!points.length) throw new Error('Empty Citywalls update rejected');
    return points.map(point => [point.id, point.lat, point.lng]);
  }
}
