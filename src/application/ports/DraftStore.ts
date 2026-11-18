// src/application/ports/DraftStore.ts
import type { WalkDraft } from '../../domain/WalkDraft';

export interface DraftStore {
  load(id: string): Promise<WalkDraft | null>;
  list(): Promise<WalkDraft[]>;
  save(draft: WalkDraft): Promise<void>;
  remove(id: string): Promise<void>;
}