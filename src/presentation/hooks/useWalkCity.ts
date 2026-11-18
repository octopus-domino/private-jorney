import { useEffect, useState } from 'react';
import type { WalkDraft } from '../../domain/WalkDraft';
import type { Poi } from '../../domain/Poi';
import { walkEndpoints } from '../../application/use-cases/walkEndpoints';
import { resolveCity, knownCity } from '../../application/use-cases/resolveCity';
import { geocoder } from '../../infrastructure';
import { russianAddress } from '../../shared/russianAddress';

/** Resolves once per route location, keeping city metadata stable during unrelated UI updates. */
export function useWalkCity(draft: WalkDraft, pois?: Poi[]): string | undefined {
  const { first } = walkEndpoints(draft, pois);
  const address = first && 'details' in first ? first.details?.address ?? '' : first && 'label' in first ? first.label ?? '' : '';
  const key = `${draft.id}:${first?.lat}:${first?.lng}`;
  const savedPoint = walkEndpoints(draft).first;
  const sameSavedLocation = first?.lat === savedPoint?.lat && first?.lng === savedPoint?.lng;
  const fallback = knownCity(address) ?? (sameSavedLocation && draft.city ? russianAddress(draft.city) : undefined);
  const [resolved, setResolved] = useState<{ key: string; city?: string }>({ key, city: fallback });

  useEffect(() => {
    if (!first || fallback) return;
    const controller = new AbortController();
    void resolveCity(first, geocoder, address, controller.signal).then(city => {
      if (!controller.signal.aborted) setResolved({ key, city });
    }).catch(error => { if (!controller.signal.aborted) console.warn('Route city unavailable.', error instanceof Error ? error.name : 'LookupError'); });
    return () => controller.abort();
  }, [key, fallback, address]);

  return fallback ?? (resolved.key === key ? resolved.city : undefined);
}
