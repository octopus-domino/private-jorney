export interface CitywallsIndexState {
  lastAttempt: number;
  squares: Record<string, [number, number, number][]>;
}

/** IndexedDB keeps index updates outside localStorage's small synchronous quota. */
export class CitywallsIndexStore {
  private database?: Promise<IDBDatabase>;
  private memory: CitywallsIndexState = { lastAttempt: 0, squares: {} };

  /** A read/write transaction prevents two WebViews or tabs from starting the daily refresh together. */
  async claimAttempt(now: number, interval: number): Promise<CitywallsIndexState | null> {
    if (typeof indexedDB === 'undefined') {
      if (this.memory.lastAttempt && now - this.memory.lastAttempt < interval) return null;
      this.memory = { ...this.memory, lastAttempt: now };
      return this.memory;
    }
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('index', 'readwrite');
      const records = transaction.objectStore('index');
      const request = records.get('current');
      let claimed: CitywallsIndexState | null = null;
      request.onsuccess = () => {
        const state: CitywallsIndexState = request.result ?? this.memory;
        if (state.lastAttempt && now - state.lastAttempt < interval) return;
        claimed = { ...state, lastAttempt: now };
        records.put(claimed, 'current');
      };
      transaction.oncomplete = () => resolve(claimed);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async read(): Promise<CitywallsIndexState> {
    if (typeof indexedDB === 'undefined') return this.memory;
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction('index').objectStore('index').get('current');
      request.onsuccess = () => resolve(request.result ?? this.memory);
      request.onerror = () => reject(request.error);
    });
  }

  async write(value: CitywallsIndexState): Promise<void> {
    this.memory = value;
    if (typeof indexedDB === 'undefined') return;
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('index', 'readwrite');
      transaction.objectStore('index').put(value, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('private-walks-citywalls', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('index');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
    });
    return this.database;
  }
}
