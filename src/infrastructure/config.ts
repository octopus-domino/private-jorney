// src/infrastructure/config.ts
export interface AppConfig {
  codocApiUrl: string;
  placesEndpoint: string;
  photonUrl: string;
  codocAuthToken: string | null;
  mock: boolean;
}

function readEnv(key: string): string | undefined {
  const v = (import.meta.env as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export const config: AppConfig = {
  // DEV  → пустая строка, запросы уходят в Vite-proxy (same-origin).
  // PROD → КАНОНИЧЕСКИЙ www-хост: https://codoc.site отдаёт 301,
  //        а 301 без CORS-заголовков WebView не пропускает.
  codocApiUrl:
    readEnv('VITE_CODOC_API_URL') ??
    (import.meta.env.DEV ? '' : 'https://www.codoc.site'),
  placesEndpoint: readEnv('VITE_PLACES_ENDPOINT') ?? '/api/journeys/routes/places/themed',
  photonUrl: readEnv('VITE_PHOTON_URL') ?? 'https://photon.komoot.io/api/',
  codocAuthToken: readEnv('VITE_CODOC_TOKEN') ?? null,
  mock: readEnv('VITE_MOCK') === '1',
};