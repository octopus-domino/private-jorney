import type { Geocoder } from '../ports/Geocoder';

/** Uses explicit address evidence before requesting a city; never groups unknown places under a guessed city. */
export async function resolveCity(point: { lat: number; lng: number }, geocoder: Geocoder,
  address = '', signal?: AbortSignal): Promise<string> {
  const known = knownCity(address);
  if (known) return known;
  const result = await geocoder.reverse(point.lat, point.lng, signal);
  const city = result.city?.trim() || knownCity(result.label);
  if (!city) throw new Error('Не удалось определить город. Повторите попытку с доступной сетью.');
  return knownCity(city) ?? city;
}

/** Normalizes the Russian and English names returned by Photon for the two federal cities. */
export function knownCity(address: string): string | undefined {
  if (/Санкт-Петербург|Saint Petersburg|St\.? Petersburg/i.test(address)) return 'Санкт-Петербург';
  if (/Москва|Moscow/i.test(address)) return 'Москва';
  return undefined;
}
