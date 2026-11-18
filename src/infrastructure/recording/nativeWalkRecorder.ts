import { registerPlugin } from '@capacitor/core';
import type { RawWalkSession } from '../../domain/RecordedWalk';
import type { WalkRecorder } from '../../application/ports/WalkRecorder';
import { parseRecording } from './recordingCodec';
import type { GpsMode } from '../../domain/GpsMode';

interface NativeRecordingBridge {
  start(options?: { mode: GpsMode }): Promise<void>; stop(): Promise<void>;
  status(): Promise<{ active: boolean; session: RawWalkSession | null }>;
  list(): Promise<{ sessions: RawWalkSession[] }>;
  read(options: { id: string }): Promise<RawWalkSession>;
  remove(options: { id: string }): Promise<void>;
  seed(options: { lat: number; lng: number; accuracy: number; timestamp: number }): Promise<void>;
}
const nativeRecorder = registerPlugin<NativeRecordingBridge>('WalkRecorder');

/** Adapter: controls the native foreground service, including when the WebView is suspended. */
export class NativeWalkRecorder implements WalkRecorder {
  readonly backgroundCapable = true;

  constructor(private readonly bridge = nativeRecorder, private readonly geolocation = () => navigator.geolocation) {}
  /** Starts only in response to an explicit user action. */
  async start(mode: GpsMode = 'balanced') {
    await this.bridge.start({ mode });
    this.geolocation()?.getCurrentPosition(position => {
      void this.bridge.seed({ lat: position.coords.latitude, lng: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp })
        .catch(error => console.info('Native starting fix unavailable; GNSS recording continues', error));
    }, error => console.info('One-shot starting fix unavailable; GNSS recording continues', error.code),
    { enableHighAccuracy: true, maximumAge: 12000, timeout: 20000 });
  }
  /** Resolves after native data has been flushed. */
  stop() { return this.bridge.stop(); }
  /** Uses compact statistics instead of transferring the full track on each refresh. */
  status() { return this.bridge.status(); }
  /** Recovers recordings stopped through the Android notification. */
  async list() { return (await this.bridge.list()).sessions; }
  /** Reads the full track only for archive creation or recovery. */
  async read(id: string) { return parseRecording(await this.bridge.read({ id })); }
  /** Removes native raw data when the user deletes its saved recording. */
  remove(id: string) { return this.bridge.remove({ id }); }
}
