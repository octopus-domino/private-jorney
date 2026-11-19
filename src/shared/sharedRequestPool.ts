interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  consumers: number;
  settled: boolean;
  releaseTimer?: ReturnType<typeof setTimeout>;
}

/** Shares work while keeping each caller's cancellation independent from other subscribers. */
export class SharedRequestPool<T> {
  private readonly requests = new Map<string, SharedRequest<T>>();

  constructor(private readonly keepAliveMs = 0) {}

  /** A newly opened card never inherits an already-aborted request from the preceding card. */
  run(key: string, loader: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const request = this.requests.get(key) ?? this.create(key, loader);
    clearTimeout(request.releaseTimer);
    request.consumers++;
    return this.subscribe(key, request, signal);
  }

  private create(key: string, loader: (signal: AbortSignal) => Promise<T>): SharedRequest<T> {
    const request: SharedRequest<T> = {
      controller: new AbortController(), consumers: 0, settled: false,
      promise: Promise.resolve().then(() => loader(request.controller.signal)),
    };
    request.promise = request.promise.finally(() => {
      request.settled = true;
      clearTimeout(request.releaseTimer);
      if (this.requests.get(key) === request) this.requests.delete(key);
    });
    this.requests.set(key, request);
    return request;
  }

  private subscribe(key: string, request: SharedRequest<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (action: () => void) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        this.release(key, request);
        action();
      };
      const abort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')));
      signal?.addEventListener('abort', abort, { once: true });
      request.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      if (signal?.aborted) abort();
    });
  }

  private release(key: string, request: SharedRequest<T>) {
    request.consumers--;
    if (request.consumers > 0 || request.settled) return;
    if (this.keepAliveMs > 0) {
      request.releaseTimer = setTimeout(() => this.cancelUnused(key, request), this.keepAliveMs);
      return;
    }
    this.cancelUnused(key, request);
  }

  private cancelUnused(key: string, request: SharedRequest<T>) {
    if (request.consumers > 0 || request.settled) return;
    if (this.requests.get(key) === request) this.requests.delete(key);
    request.controller.abort();
  }
}
