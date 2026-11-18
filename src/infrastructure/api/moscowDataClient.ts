import { Capacitor } from '@capacitor/core';
import { readExternalPage } from './readExternalPage';
import { fetchExternalPage } from './externalPageTransport';

/** Reads the official API directly: cancellable native transport on Android, documented CORS on the web. */
export async function readMoscowData(url: string, signal?: AbortSignal): Promise<string> {
  if (Capacitor.isNativePlatform() || import.meta.env.VITE_PUBLIC_SOURCES_BASE_URL) return readExternalPage(url, signal);
  return fetchExternalPage(url, { native: false, nativeGet: async () => { throw new Error('Native transport not selected'); },
    fetchPage: (target, abort) => fetch(target, { signal: abort, headers: { Accept: 'application/json' } }) }, signal);
}

/** Keeps authentication in requests rather than public source links or cache keys. */
export class MoscowDataClient {
  constructor(private readonly apiKey: string, private readonly read = readMoscowData) {}

  /** Only the address geometry and house-management datasets are used by house cards. */
  async get(dataset: 60562 | 2681 | 62963, resource: 'features' | 'rows', query: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    if (!this.apiKey) throw new Error('Не настроен ключ открытых данных Москвы.');
    const url = new URL(`https://apidata.mos.ru/v1/datasets/${dataset}/${resource}`);
    url.search = new URLSearchParams({ '$format': 'json', ...query, api_key: this.apiKey }).toString();
    return JSON.parse(await this.read(url.href, signal));
  }
}
