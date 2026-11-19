// src/shared/queryCache.ts
import { SharedRequestPool } from './sharedRequestPool';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface QueryCacheOptions {
  /** Allows bounded read-only searches to finish and populate cache after the UI changes. */
  keepAliveMs?: number;
  /** Время жизни записи, мс. */
  ttlMs: number;
  /** Максимум записей в кэше; старые вытесняются FIFO. */
  maxEntries?: number;
  /**
   * Сохранять в localStorage, чтобы пережить перезагрузку страницы/приложения.
   * При превышении квоты запись тихо отключается — in-memory продолжает работать.
   */
  persist?: boolean;
  /** Ключ в localStorage. Обязателен при persist=true. Меняйте /v1/ → /v2/ при breaking changes. */
  storageKey?: string;
  /** Префикс для логов в dev-режиме. */
  name?: string;
}

/**
 * TTL-кэш с дедупликацией.
 *
 * Основное применение — обёртка над сетевыми вызовами к бэкенду,
 * чтобы не дёргать его на каждое движение ползунка радиуса, категории и т.д.
 *
 * Особенности:
 *  - in-memory всегда;
 *  - опционально localStorage для persistence между сессиями;
 *  - дедупликация одновременных запросов с одинаковым ключом;
 *  - при переполнении квоты localStorage запись тихо отключается.
 */
export class QueryCache<T> {
  private readonly cancellable: SharedRequestPool<T>;
  private memory = new Map<string, CacheEntry<T>>();
  private inflight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly persist: boolean;
  private readonly storageKey: string;
  private readonly name: string;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: QueryCacheOptions) {
    this.cancellable = new SharedRequestPool<T>(options.keepAliveMs);
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 100;
    this.persist = options.persist ?? false;
    this.storageKey = options.storageKey ?? '';
    this.name = options.name ?? 'cache';
    if (this.persist && this.storageKey) {
      this.loadFromStorage();
    }
  }

  /**
   * Возвращает значение из кэша или вызывает loader, кэширует результат.
   * Одновременные вызовы с одинаковым ключом разделяют один Promise
   * (дедупликация in-flight).
   *
   * Если loader выбросит (сеть, abort, 4xx) — ошибка пробросится,
   * ничего не закэшируется. Следующий вызов попробует заново.
   */
  async get(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // 1. In-memory hit
    const mem = this.memory.get(key);
    if (mem && mem.expiresAt > now) {
      this.log('hit', key);
      return mem.value;
    }

    // 2. In-flight — дедупликация
    const existing = this.inflight.get(key);
    if (existing) {
      this.log('dedup', key);
      return existing;
    }

    // 3. Load
    this.log('miss', key);
    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Shares network work without letting one card abort another card's subscription. */
  async getAbortable(key: string, loader: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cached = this.memory.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    return this.cancellable.run(key, async (sharedSignal) => {
      const value = await loader(sharedSignal);
      if (!sharedSignal.aborted) this.set(key, value);
      return value;
    }, signal);
  }

  /** Явный сброс (для кнопки «Обновить» или тестов). */
  clear(): void {
    this.memory.clear();
    this.inflight.clear();
    if (this.persist && this.storageKey) {
      try { localStorage.removeItem(this.storageKey); }
      catch (error) { console.warn('Unable to clear persistent query cache', error); }
    }
  }

  private set(key: string, value: T): void {
    const expiresAt = Date.now() + this.ttlMs;
    this.memory.set(key, { value, expiresAt });

    // FIFO eviction — самые старые ключи вытесняются первыми.
    while (this.memory.size > this.maxEntries) {
      const first = this.memory.keys().next();
      if (first.done) break;
      this.memory.delete(first.value);
    }

    if (this.persist) this.schedulePersist();
  }

  private schedulePersist(): void {
    if (!this.storageKey) return;
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
    }
    // Дебаунсим запись в localStorage на 500 мс, чтобы не блокировать UI
    // при массовом обновлении кэша.
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.saveToStorage();
    }, 500);
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, CacheEntry<T>>;
      const now = Date.now();
      let restored = 0;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.expiresAt === 'number' && v.expiresAt > now) {
          this.memory.set(k, v);
          restored += 1;
        }
      }
      if (restored > 0) this.log('restore', `${restored} entries`);
    } catch (error) {
      console.warn('Unable to restore query cache; using memory cache', error);
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const obj: Record<string, CacheEntry<T>> = {};
      for (const [k, v] of this.memory) obj[k] = v;
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
    } catch (error) {
      console.warn('Unable to persist query cache; using memory cache', error);
    }
  }

  private log(kind: 'hit' | 'miss' | 'dedup' | 'restore', key: string): void {
    if (!import.meta.env.DEV) return;
    console.debug(`[${this.name}] ${kind}:`, key);
  }
}
