import { useEffect, useRef, useState } from 'react';
import type { Poi } from '../../domain/Poi';

interface Repository<T> {
  requestKey?(poi: Poi): string;
  supports(poi: Poi): boolean;
  lookup(poi: Poi, signal?: AbortSignal): Promise<T | null>;
}
type Status = 'loading' | 'ready' | 'empty' | 'error' | 'unsupported';

export function usePoiEnrichment<T>(poi: Poi, repository: Repository<T>) {
  const key = repository.requestKey?.(poi) ?? `${poi.id}:${poi.lat}:${poi.lng}:${poi.details?.sourceUrl ?? ''}`;
  const currentPoi = useRef(poi);
  currentPoi.current = poi;
  const [state, setState] = useState<{ key: string; data: T | null; status: Status; error?: unknown }>({ key, data: null, status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const poi = currentPoi.current;
    if (!repository.supports(poi)) {
      setState({ key, data: null, status: 'unsupported' });
      return;
    }
    setState({ key, data: null, status: 'loading' });
    void repository.lookup(poi, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ key, data, status: data ? 'ready' : 'empty' });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, data: null, status: 'error', error });
    });
    return () => controller.abort();
  }, [key, repository, attempt]);
  return { ...(state.key === key ? state : { data: null, status: 'loading' as Status, error: undefined }), retry: () => setAttempt((n) => n + 1) };
}
