import type { WalkRecorder } from '../ports/WalkRecorder';
import type { RecordedWalkRepository } from '../ports/RecordedWalkRepository';
import type { RecordedWalkEnricher } from './enrichRecordedWalk';
import type { Poi } from '../../domain/Poi';
import type { RecordedWalk } from '../../domain/RecordedWalk';
import { initialWalk } from '../../domain/walkStory';
import type { GpsMode } from '../../domain/GpsMode';

/** Coordinates the native journal and local archive. Durable GPS save precedes all optional network enrichment. */
export class RecordedWalkService {
  private readonly processing = new Set<string>();

  constructor(readonly recorder: WalkRecorder, readonly archive: RecordedWalkRepository,
    private readonly enricher: RecordedWalkEnricher) {}

  /** Imports journals stopped by the notification or interrupted by process termination. */
  async recover(): Promise<void> {
    const live = await this.recorder.status();
    for (const session of await this.recorder.list()) {
      if (session.id === live.session?.id && live.active || await this.archive.get(session.id)) continue;
      const raw = await this.recorder.read(session.id);
      await this.archive.save(initialWalk({ ...raw, state: raw.state === 'recording' ? 'interrupted' : raw.state }));
    }
  }

  /** Explicit start is the sole entry point to permission requests and background location collection. */
  async start(mode?: GpsMode): Promise<void> { await this.recover(); await this.recorder.start(mode); }

  /** Resolves after the raw track commits; slow public sources cannot delay the stop action. */
  async stop(): Promise<RecordedWalk | null> {
    const live = await this.recorder.status();
    await this.recorder.stop();
    if (!live.session) { await this.recover(); return null; }
    const walk = initialWalk(await this.recorder.read(live.session.id));
    await this.archive.save(walk);
    return walk;
  }

  /** Retries optional details from cache first; duplicate taps cannot start parallel enrichment for one walk. */
  async enrich(id: string, known: Poi[], changed: () => void): Promise<void> {
    if (this.processing.has(id)) return;
    this.processing.add(id);
    try {
      const walk = await this.archive.get(id);
      if (!walk) return;
      const save = async (value: RecordedWalk) => { await this.archive.save(value); changed(); };
      await save(await this.enricher.enrich(walk, known, save));
    } finally { this.processing.delete(id); }
  }

  /** Removes the journal first so recovery cannot recreate a deleted archive entry. */
  async remove(id: string): Promise<void> { await this.recorder.remove(id); await this.archive.remove(id); }
}
