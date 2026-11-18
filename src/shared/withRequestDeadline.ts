/** Bounds an optional network dependency even if its implementation ignores cancellation. */
export async function withRequestDeadline<T>(read: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  if (parent?.aborted) throw new DOMException('Aborted', 'AbortError');
  const controller = new AbortController();
  let rejectDeadline!: (error: Error) => void;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const abort = () => {
    controller.abort();
    rejectDeadline(new DOMException('Aborted', 'AbortError'));
  };
  const timer = setTimeout(() => {
    controller.abort();
    rejectDeadline(new Error('Address lookup timed out'));
  }, milliseconds);
  parent?.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([Promise.resolve().then(() => read(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}
