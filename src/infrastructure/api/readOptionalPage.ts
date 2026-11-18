const OPTIONAL_PAGE_TIMEOUT_MS = 4000;

/** Prevents slow repair-program pages from blocking an already available technical passport. */
export async function readOptionalPage(url: string,
  read: (url: string, signal?: AbortSignal) => Promise<string>, parent?: AbortSignal): Promise<string | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(abort, OPTIONAL_PAGE_TIMEOUT_MS);

  try { return await read(url, controller.signal); }
  catch (failure) {
    if (!controller.signal.aborted) console.info('Optional repair program unavailable.', failure instanceof Error ? failure.name : 'SourceError');
    return null;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}
