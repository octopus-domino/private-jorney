import { createCodocSearchTransport } from './codocSearchTransport';
export type { CodocFetch } from './codocSearchTransport';

/** Preserves WebView fetch and cancellation while allowing the server's previous search to release its slot. */
export const codocFetch = createCodocSearchTransport((url, options) => fetch(url, options));
