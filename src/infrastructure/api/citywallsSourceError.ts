import { ExternalSourceError } from './externalPageTransport';

/** Safe diagnostics identify the failed Citywalls stage without revealing session IDs or response contents. */
export class CitywallsSourceError extends Error {
  constructor(stage: 'map' | 'points' | 'house', cause: unknown) {
    const label = stage === 'map' ? 'Карта Citywalls' : stage === 'points' ? 'Точки на карте Citywalls' : 'Страница здания Citywalls';
    const detail = cause instanceof ExternalSourceError
      ? `${cause.message}${cause.status ? ` (HTTP ${cause.status})` : ''}`
      : 'Ответ сайта не содержит ожидаемых данных.';
    super(`${label}: ${detail}`);
    this.name = 'CitywallsSourceError';
  }
}

/** Cancellation is a normal card lifecycle event and must never be presented as source failure. */
export async function readCitywallsStage<T>(stage: 'map' | 'points' | 'house', read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new CitywallsSourceError(stage, error);
  }
}
