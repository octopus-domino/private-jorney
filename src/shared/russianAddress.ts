/** Normalizes the international aliases returned for the supported cities without translating street names. */
export function russianAddress(value: string): string {
  return value.replace(/Saint[ -]Petersburg|St\.? Petersburg|Sankt[ -]Peterburg/gi, 'Санкт-Петербург')
    .replace(/\bMoscow\b/gi, 'Москва').replace(/Russian Federation|\bRussia\b/gi, 'Россия');
}

/** Uses the standard locale dictionary for country names when the geocoder includes an ISO country code. */
export function russianCountry(name?: string, code?: string): string | undefined {
  if (code && /^[a-z]{2}$/i.test(code) && typeof Intl.DisplayNames === 'function') {
    return new Intl.DisplayNames(['ru'], { type: 'region' }).of(code.toUpperCase());
  }
  return name ? russianAddress(name) : undefined;
}
