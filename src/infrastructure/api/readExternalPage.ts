import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { fetchExternalPage } from './externalPageTransport';
import { ExternalSourceError } from './externalPageTransport';
import { newId } from '../../shared/id';
import { publishedSourceUrl } from './publishedSourceUrl';

const publicSources = registerPlugin<{
  read(options: { url: string; requestId: string; method?: string; body?: string }): Promise<{ status: number; data: string }>;
  cancel(options: { requestId: string }): Promise<void>;
}>('PublicSources');

async function nativeRead(url: string, signal?: AbortSignal, request?: { method: 'POST'; body: string }) {
  if (Capacitor.getPlatform() !== 'android') return CapacitorHttp.request({ url, method: request?.method ?? 'GET',
    data: request ? JSON.parse(request.body) : undefined, headers: request ? { 'Content-Type': 'application/json' } : undefined,
    responseType: 'text', connectTimeout: 10000, readTimeout: 30000 });
  const requestId = newId('source');
  const cancel = () => { void publicSources.cancel({ requestId }).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try { return await publicSources.read({ url, requestId, ...request }); }
  finally { signal?.removeEventListener('abort', cancel); }
}

/** Sends the public CIAN search JSON through the same cancellable native/dev transport as GET sources. */
export async function postExternalJson(url: string, payload: unknown, signal?: AbortSignal): Promise<string> {
  const body = JSON.stringify(payload);
  const result = await fetchExternalPage(url, {
    native: Capacitor.isNativePlatform(),
    webProxyUrl: import.meta.env.DEV ? '/history-source' : undefined,
    nativeGet: (target, abortSignal) => nativeRead(target, abortSignal, { method: 'POST', body }),
    fetchPage: (target, abortSignal) => fetch(publishedSourceUrl(target), { method: 'POST', body, signal: abortSignal,
      cache: 'no-store', headers: { 'Content-Type': 'application/json' } }),
  }, signal);
  return checkedSourceBody(url, result);
}

export async function readExternalPage(url: string, signal?: AbortSignal): Promise<string> {
  const result = await fetchExternalPage(url, {
    native: Capacitor.isNativePlatform(),
    webProxyUrl: import.meta.env.DEV ? '/history-source' : undefined,
    nativeGet: nativeRead,
    fetchPage: (target, abortSignal) => fetch(publishedSourceUrl(target), { signal: abortSignal, cache: 'no-store' }),
  }, signal);
  return checkedSourceBody(url, result);
}

function checkedSourceBody(url: string, body: string): string {
  const host = new URL(url).hostname;
  if (['api.cian.ru', 'www.avito.ru'].includes(host) && /^\s*</.test(body)
    && /captcha|подтверд|проверьте|forbidden|доступ.*(?:огранич|заблок)/i.test(body)) {
    throw new ExternalSourceError('restricted', 403);
  }
  return body;
}
