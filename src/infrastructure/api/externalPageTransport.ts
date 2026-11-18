export interface NativeHttpResponse { status: number; data: unknown }
export interface ExternalPageTransport {
  native: boolean;
  webProxyUrl?: string;
  nativeGet(url: string, signal?: AbortSignal): Promise<NativeHttpResponse>;
  fetchPage(url: string, signal?: AbortSignal): Promise<Response>;
}

export class ExternalSourceError extends Error {
  constructor(public readonly code: 'network' | 'restricted' | 'source-unavailable' | 'timeout' | 'invalid-response', public readonly status?: number) {
    super(code === 'timeout' ? 'Источник не ответил за отведённое время.' : code === 'invalid-response' ? 'Источник вернул страницу без ожидаемых данных.' : code === 'network' ? 'Не удалось подключиться к источнику.' : code === 'restricted' ? 'Источник ограничил доступ. Можно открыть его сайт по ссылке.' : 'Источник временно не предоставляет данные.');
    this.name = 'ExternalSourceError';
  }
}

/** Android uses a native browser transport, never the application's localhost. */
async function fetchExternalPageOnce(sourceUrl: string, transport: ExternalPageTransport, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (transport.native) {
    let response: NativeHttpResponse;
    try { response = await transport.nativeGet(sourceUrl, signal); }
    catch (error) { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); throw error instanceof ExternalSourceError ? error : new ExternalSourceError(error instanceof Error && error.message === 'Source request timed out' ? 'timeout' : 'network'); }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (response.status !== 200) throw new ExternalSourceError(response.status === 0 ? 'network' : [403, 429, 439].includes(response.status) ? 'restricted' : 'source-unavailable', response.status);
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  }
  const controller = new AbortController();
  const target = transport.webProxyUrl ? `${transport.webProxyUrl}?url=${encodeURIComponent(sourceUrl)}` : sourceUrl;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 30000);
  try {
    const response = await transport.fetchPage(target, controller.signal);
    if (!response.ok) throw new ExternalSourceError([403, 429, 439].includes(response.status) ? 'restricted' : 'source-unavailable', response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const RETRY_DELAY_MS = 400;

function retryable(error: unknown): boolean {
  return error instanceof TypeError || error instanceof ExternalSourceError
    && (error.code === 'network' || error.code === 'timeout' || (error.status !== undefined && error.status >= 500));
}

function pauseBeforeRetry(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, RETRY_DELAY_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Retries one transient read, while respecting cancellation and never retrying access restrictions. */
export async function fetchExternalPage(sourceUrl: string, transport: ExternalPageTransport, signal?: AbortSignal): Promise<string> {
  try { return await fetchExternalPageOnce(sourceUrl, transport, signal); }
  catch (error) {
    if (signal?.aborted || !retryable(error)) throw error;
    await pauseBeforeRetry(signal);
    return fetchExternalPageOnce(sourceUrl, transport, signal);
  }
}
