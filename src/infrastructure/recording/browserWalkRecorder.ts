import type { WalkRecorder } from '../../application/ports/WalkRecorder';
import type { RawWalkSession, TrackPoint } from '../../domain/RecordedWalk';
import { acceptsTrackPoint } from '../../domain/trackQuality';
import { haversineMeters } from '../../shared/geo';
import { parseRecording } from './recordingCodec';
import { GPS_MODES, type GpsMode } from '../../domain/GpsMode';

const STORAGE_KEY = 'private-walks/browser-recording/v1';
const FLUSH_INTERVAL_MS = 30000;

/** Foreground browser fallback. Android uses the native adapter rather than relying on background JavaScript. */
export class BrowserWalkRecorder implements WalkRecorder {
  readonly backgroundCapable = false;
  private watchId: number | null = null;
  private session: RawWalkSession | null = null;
  private flushedAt = 0;
  private failure?: string;
  private mode: GpsMode = 'balanced';

  /** Starts a watcher with cached-fix support and ordinary power accuracy. */
  async start(mode: GpsMode = 'balanced'): Promise<void> {
    if (this.watchId !== null) return;
    this.failure = undefined;
    this.mode = mode;
    if (!navigator.geolocation) throw new Error('Геолокация недоступна в этом браузере.');
    this.session = { id: `walk_${crypto.randomUUID()}`, startedAt: Date.now(), state: 'recording', pointCount: 0, distanceMeters: 0, points: [], gpsMode: mode };
    this.persist();
    this.watchId = navigator.geolocation.watchPosition(position => {
      try { this.accept({ lat: position.coords.latitude, lng: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp }); }
      catch (error) { this.fail('Не удалось сохранить точку. Проверьте свободное место.', error); }
    }, error => { if (error.code === error.PERMISSION_DENIED) this.fail('Разрешите доступ к местоположению для записи пути.', error); },
    { enableHighAccuracy: GPS_MODES[mode].highAccuracy, maximumAge: GPS_MODES[mode].intervalMs, timeout: 45000 });
  }

  /** Flushes the last accepted samples before making the record available to the archive. */
  async stop(): Promise<void> {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.session) { this.session.state = 'stopped'; this.session.endedAt = Date.now(); this.persist(); }
  }

  /** Returns only small live statistics. */
  async status() {
    const session = this.session ? { ...this.session, points: undefined } : null;
    return { active: this.watchId !== null, session, error: this.failure };
  }

  /** Recovers the latest browser session as interrupted when its watcher no longer exists. */
  async list(): Promise<RawWalkSession[]> {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (!value) return [];
      const saved = parseRecording(value);
      return [{ ...saved, state: this.watchId === null && saved.state === 'recording' ? 'interrupted' : saved.state }];
    } catch (error) { console.warn('Unreadable browser recording journal', error); return []; }
  }

  /** Reads the full latest journal. */
  async read(id: string): Promise<RawWalkSession> {
    const saved = this.session?.id === id ? this.session : (await this.list()).find(item => item.id === id);
    if (!saved) throw new Error('Запись не найдена.');
    return structuredClone(saved);
  }

  /** Deletes a stopped journal without touching other browser storage. */
  async remove(id: string): Promise<void> {
    if ((await this.list())[0]?.id !== id) return;
    if (this.watchId !== null) throw new Error('Сначала остановите запись.');
    localStorage.removeItem(STORAGE_KEY);
    this.session = null;
  }

  private accept(point: TrackPoint) {
    if (!this.session) return;
    this.session.lastAccuracy = point.accuracy;
    if (!acceptsTrackPoint(point, this.session.lastPoint, Date.now(), GPS_MODES[this.mode].maxAccuracy)) return;
    if (this.session.lastPoint && point.timestamp - this.session.lastPoint.timestamp < GPS_MODES[this.mode].intervalMs) return;
    if (this.session.lastPoint) this.session.distanceMeters += haversineMeters(this.session.lastPoint, point);
    this.session.points!.push(point);
    this.session.lastPoint = point;
    this.session.pointCount++;
    if (this.session.pointCount === 1 || Date.now() - this.flushedAt >= FLUSH_INTERVAL_MS) this.persist();
  }

  private persist() {
    if (this.session) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
    this.flushedAt = Date.now();
  }

  private fail(message: string, error: unknown) {
    this.failure = message;
    console.warn('Browser recording interrupted', error);
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (!this.session) return;
    this.session.state = 'interrupted';
    this.session.endedAt = Date.now();
    try { this.persist(); }
    catch (storageError) { console.warn('Unable to flush interrupted recording', storageError); }
  }
}
