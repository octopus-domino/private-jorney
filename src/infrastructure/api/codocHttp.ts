export type CodocFetch = (url: string, options?: RequestInit) => Promise<Response>;

/** Preserves the fetch transport used by the working 1.0.2 APK, including its URL, headers and abort signal. */
export const codocFetch: CodocFetch = (url, options) => fetch(url, options);
