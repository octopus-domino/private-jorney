import { ExternalSourceError } from './externalPageTransport';

/** Exposes a safe loading stage without publishing source responses, addresses or request URLs. */
export class GorodSourceError extends Error {
  constructor(stage: 'address' | 'passport' | 'geocoder', cause: unknown) {
    const label = stage === 'address' ? 'Поиск адреса в реестре' : stage === 'passport' ? 'Загрузка паспорта дома' : 'Определение адреса на карте';
    const detail = cause instanceof ExternalSourceError
      ? `${cause.message}${cause.status ? ` (HTTP ${cause.status})` : ''}`
      : 'Не удалось обработать ответ источника.';
    super(`${label}: ${detail}`);
    this.name = 'GorodSourceError';
  }
}

/** Preserves cancellation, while identifying the failing stage for the house card. */
export async function readGorodStage<T>(stage: 'address' | 'passport' | 'geocoder', read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new GorodSourceError(stage, error);
  }
}
