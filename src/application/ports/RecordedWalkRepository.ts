import type { RecordedWalk } from '../../domain/RecordedWalk';

/** Stores full recording reports separately from editable planned routes. */
export interface RecordedWalkRepository {
  list(): Promise<RecordedWalk[]>;
  get(id: string): Promise<RecordedWalk | null>;
  save(walk: RecordedWalk): Promise<void>;
  remove(id: string): Promise<void>;
}
