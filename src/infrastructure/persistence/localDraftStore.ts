// src/infrastructure/persistence/localDraftStore.ts
import type { DraftStore } from '../../application/ports/DraftStore';
import type { WalkDraft } from '../../domain/WalkDraft';
import { savedWalkSchema } from './savedWalkSchema';

const STORAGE_KEY = 'private-walks/drafts/v1';

export class LocalDraftStore implements DraftStore {
  async load(id: string): Promise<WalkDraft | null> {
    return this.read().find((d) => d.id === id) ?? null;
  }

  async list(): Promise<WalkDraft[]> {
    return this.read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(draft: WalkDraft): Promise<void> {
    const others = this.read().filter((d) => d.id !== draft.id);
    const next: WalkDraft = { ...draft, updatedAt: new Date().toISOString() };
    // Храним не более 50 маршрутов — localStorage не резиновый.
    const trimmed = [next, ...others]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  }

  async remove(id: string): Promise<void> {
    const rest = this.read().filter((d) => d.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  }

  private read(): WalkDraft[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item) => {
        const result = savedWalkSchema.safeParse(item);
        return result.success ? [result.data as WalkDraft] : [];
      });
    } catch {
      return [];
    }
  }
}
