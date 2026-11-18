export interface SuccessCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Entry<T> { key: string; expires: number; value: T }
const MAX_ENTRIES = 60;

/** Cache-Aside: persists validated successes only; storage failure leaves the memory cache usable. */
export class PersistentSuccessCache<T> implements SuccessCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private restored = false;

  /** Injects storage, validation and time so persistence does not depend on a browser during tests. */
  constructor(
    private readonly storageKey: string,
    private readonly ttlMs: number,
    private readonly decode: (value: unknown) => T | undefined,
    private readonly storage: () => StoragePort | undefined = () => globalThis.localStorage,
    private readonly now = Date.now,
    private readonly maxEntries = MAX_ENTRIES,
  ) {}

  /** Returns an independent copy so UI consumers cannot mutate a future cached response. */
  get(key: string): T | undefined {
    this.restore();
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= this.now()) return undefined;
    return JSON.parse(JSON.stringify(entry.value)) as T;
  }

  /** Called only after parsing and matching a real building; null/error responses are never entries. */
  set(key: string, value: T): void {
    this.restore();
    const decoded = this.decode(value);
    if (decoded === undefined) return;
    this.entries.delete(key);
    this.entries.set(key, { key, expires: this.now() + this.ttlMs, value: JSON.parse(JSON.stringify(decoded)) });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    try { this.storage()?.setItem(this.storageKey, JSON.stringify([...this.entries.values()])); }
    catch (error) { console.warn('Building cache could not persist; using memory cache.', error instanceof Error ? error.name : 'StorageError'); }
  }

  private restore(): void {
    if (this.restored) return;
    this.restored = true;
    try {
      const parsed: unknown = JSON.parse(this.storage()?.getItem(this.storageKey) ?? '[]');
      if (Array.isArray(parsed)) parsed.slice(-this.maxEntries).forEach((entry) => this.restoreEntry(entry));
    } catch (error) {
      console.warn('Building cache could not be restored; fresh data will be requested.', error instanceof Error ? error.name : 'StorageError');
    }
  }

  /** Enumerates fresh independent snapshots for consumers that search across cached map areas. */
  values(): T[] {
    this.restore();
    return [...this.entries.keys()].flatMap(key => { const value = this.get(key); return value === undefined ? [] : [value]; });
  }

  private restoreEntry(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const entry = raw as Partial<Entry<unknown>>;
    if (typeof entry.key !== 'string' || typeof entry.expires !== 'number' || entry.expires <= this.now()) return;
    const value = this.decode(entry.value);
    if (value !== undefined) this.entries.set(entry.key, { key: entry.key, expires: entry.expires, value });
  }
}
