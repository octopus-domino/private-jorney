import { z } from 'zod';
import type { RecordedWalk } from '../../domain/RecordedWalk';
import type { RecordedWalkRepository } from '../../application/ports/RecordedWalkRepository';

const STORE = 'walks';
const historySchema = z.object({ excerpt: z.string(), sourceUrl: z.string().url(), title: z.string().optional(),
  imageUrl: z.string().url().optional(), sourceName: z.string().optional() });
const placeSchema = z.object({ poi: z.object({ id: z.string(), name: z.string(), lat: z.number().finite(), lng: z.number().finite(),
  categoryIds: z.array(z.string()), facts: z.array(z.string()), source: z.enum(['overpass', 'manual', 'entry', 'historical-house', 'mystic-place']) }).passthrough(),
  side: z.enum(['left', 'right', 'nearby']), progressMeters: z.number().finite(), history: historySchema.optional(), photoDataUrl: z.string().optional() });
const schema = z.object({ id: z.string(), title: z.string(), startedAt: z.number(), endedAt: z.number(),
  points: z.array(z.object({ lat: z.number().finite(), lng: z.number().finite(), accuracy: z.number(), timestamp: z.number() })),
  distanceMeters: z.number(), places: z.array(placeSchema), paragraphs: z.array(z.string()), previewSvg: z.string(),
  status: z.enum(['saved', 'partial', 'ready']), interrupted: z.boolean() }).passthrough();

/** IndexedDB keeps full tracks and saved illustrations outside the small synchronous localStorage quota. */
export class IndexedWalkRecordingRepository implements RecordedWalkRepository {
  private database?: Promise<IDBDatabase>;

  /** Returns newest records first; one invalid entry cannot make the entire collection unreadable. */
  async list(): Promise<RecordedWalk[]> {
    const rows = await this.request<unknown[]>('readonly', store => store.getAll());
    return rows.flatMap(row => { const parsed = schema.safeParse(row); return parsed.success ? [parsed.data as RecordedWalk] : []; })
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Loads a full saved report without contacting its external sources. */
  async get(id: string): Promise<RecordedWalk | null> {
    const row = await this.request<unknown>('readonly', store => store.get(id));
    const parsed = schema.safeParse(row);
    return parsed.success ? parsed.data as RecordedWalk : null;
  }

  /** Resolves only after the transaction commits, so the UI never confirms an uncommitted report. */
  async save(walk: RecordedWalk): Promise<void> { await this.request('readwrite', store => store.put(walk)); }

  /** Deletes only the recording selected by the user. */
  async remove(id: string): Promise<void> { await this.request('readwrite', store => store.delete(id)); }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('private-walks-recordings', 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
    });
    return this.database;
  }

  private async request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Сохранение записи прервано.'));
    });
  }
}
