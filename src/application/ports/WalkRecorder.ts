import type { RawWalkSession } from '../../domain/RecordedWalk';

/** Separates Android foreground recording from the foreground-only browser fallback. */
export interface WalkRecorder {
  readonly backgroundCapable: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<{ active: boolean; session: RawWalkSession | null; error?: string }>;
  list(): Promise<RawWalkSession[]>;
  read(id: string): Promise<RawWalkSession>;
  remove(id: string): Promise<void>;
}
