import { create } from 'zustand';
import type { RawWalkSession, RecordedWalk, TrackPoint } from '../../domain/RecordedWalk';
import { recordedWalks } from '../../infrastructure';
import { useWalkStore } from './walkStore';
import { gpsMode, type GpsMode } from '../../domain/GpsMode';

interface RecordingState {
  session: RawWalkSession | null;
  active: boolean;
  busy: boolean;
  records: RecordedWalk[];
  livePath: TrackPoint[];
  processing: string[];
  error: string | null;
  gpsMode: GpsMode;
  setGpsMode(mode: GpsMode): void;
  sync(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  enrich(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить прогулку.';
let synchronizing = false;
const GPS_MODE_KEY = 'private-walks/recording-gps-mode/v1';

function savedGpsMode(): GpsMode {
  try { return gpsMode(localStorage.getItem(GPS_MODE_KEY)); }
  catch (error) { console.info('GPS preference unavailable; using balanced mode', error); return 'balanced'; }
}

/** Presentation state polls compact statistics only while visible; native GPS works independently. */
export const useRecordingStore = create<RecordingState>((set, get) => ({
  gpsMode: savedGpsMode(),
  setGpsMode(mode) {
    if (get().active) return;
    set({ gpsMode: mode });
    try { localStorage.setItem(GPS_MODE_KEY, mode); }
    catch (error) { console.info('GPS preference is available for this session only', error); }
  },
  session: null, active: false, busy: false, records: [], livePath: [], processing: [], error: null,
  async sync() {
    if (synchronizing) return;
    synchronizing = true;
    try {
      const status = await recordedWalks.recorder.status();
      const previous = get();
      if (!status.active) await recordedWalks.recover();
      const point = status.session?.lastPoint;
      const livePath = status.session?.id !== previous.session?.id ? [] : previous.livePath;
      set({ active: status.active, session: status.session, error: status.error ?? previous.error,
        records: status.active ? previous.records : await recordedWalks.archive.list(),
        livePath: point && point.timestamp !== livePath.at(-1)?.timestamp ? [...livePath, point] : livePath });
    } catch (error) { set({ error: message(error) }); }
    finally { synchronizing = false; }
  },
  async start() {
    if (get().busy) return;
    set({ busy: true, error: null, livePath: [] });
    try { await recordedWalks.start(get().gpsMode); await get().sync(); }
    catch (error) { set({ error: message(error) }); }
    finally { set({ busy: false }); }
  },
  async stop() {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      const walk = await recordedWalks.stop();
      await get().sync();
      if (walk?.points.length) void get().enrich(walk.id);
    } catch (error) { set({ error: message(error) }); }
    finally { set({ busy: false }); }
  },
  async enrich(id) {
    if (get().processing.includes(id)) return;
    set({ processing: [...get().processing, id], error: null });
    try { await recordedWalks.enrich(id, useWalkStore.getState().pois, () => {
      void recordedWalks.archive.list().then(records => set({ records })).catch(error => set({ error: message(error) }));
    }); }
    catch (error) { set({ error: message(error) }); }
    finally { set({ processing: get().processing.filter(value => value !== id) }); await get().sync(); }
  },
  async remove(id) {
    if (get().processing.includes(id)) return;
    try { await recordedWalks.remove(id); await get().sync(); }
    catch (error) { set({ error: message(error) }); }
  },
}));
