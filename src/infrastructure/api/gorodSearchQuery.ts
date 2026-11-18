/** Expands OSM/Photon house suffixes which the city portal otherwise silently treats as no matches. */
export function gorodSearchQuery(address: string): string | null {
  const query = address
    .replace(/(?:г\.?\s*)?Санкт-Петербург|Россия|Russia|Saint Petersburg|\b\d{6}\b/gi, '')
    .replace(/(линия)\s+Васильевского\s+острова/gi, '$1 В.О.')
    .replace(/(\d)\s*(?:корп\.?|к\.?)\s*(\d+)/gi, '$1, корпус $2')
    .replace(/(\d)\s*стр\.?\s*(\d+)/gi, '$1, строение $2')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '').trim();

  return /\d/.test(query) && /[а-яa-z]/i.test(query) ? query : null;
}
