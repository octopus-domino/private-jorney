export type CodocFetch = (url: string, options?: RequestInit) => Promise<Response>;

const SEARCH_PATH = /^\/api\/journeys\/(routes\/places(?:\/themed)?|buildings\/nearby)$/;
const MAX_RETRIES = 8;
const MAX_DELAY_MS = 5000;
const INITIAL_DELAY_MS = 1000;

/** Waits without holding a network connection and stops as soon as the filter changes. */
export function waitForSearchSlot(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);

    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function isSearchRead(url: string, options?: RequestInit): boolean {
  if ((options?.method ?? 'GET').toUpperCase() !== 'GET') return false;
  return SEARCH_PATH.test(new URL(url, 'https://www.codoc.site').pathname);
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get('Retry-After');
  const seconds = header === null ? NaN : Number(header);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000
    : header ? Date.parse(header) - Date.now() : NaN;

  return Number.isFinite(milliseconds)
    ? Math.min(MAX_DELAY_MS, Math.max(INITIAL_DELAY_MS, milliseconds))
    : Math.min(MAX_DELAY_MS, INITIAL_DELAY_MS * (attempt + 1));
}

/** Decorator: only public CoDoc searches retry a busy slot; writes and external sites are never retried here. */
export function createCodocSearchTransport(
  http: CodocFetch,
  wait: typeof waitForSearchSlot = waitForSearchSlot,
): CodocFetch {
  return async (url, options) => {
    for (let attempt = 0; ; attempt++) {
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await http(url, options);
      if (response.status !== 429 || !isSearchRead(url, options) || attempt >= MAX_RETRIES) return response;

      const delay = retryDelay(response, attempt);
      await response.body?.cancel();
      await wait(delay, options?.signal);
    }
  };
}
