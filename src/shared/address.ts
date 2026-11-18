export function normalizeHouseAddress(address: string): string {
  const normalized = address.toLowerCase().replace(/ё/g, 'е')
    .replace(/васильевского\s+острова|в\.?\s*о\.(?=[\s,]|$)/g, ' васильевского острова ')
    .replace(/(?:г\.?\s*)?москва|moscow|saint petersburg|russia/g, '')
    .replace(/г\.?\s*санкт-петербург|санкт-петербург|россия|\b\d{6}\b/g, '')
    .replace(/проспект|просп\.|пр-т|пр\./g, ' проспект ')
    .replace(/улица|ул\./g, ' улица ')
    .replace(/набережная|наб\./g, ' набережная ')
    .replace(/переулок|пер\./g, ' переулок ')
    .replace(/строение|стр\./g, ' строение ')
    .replace(/корпус|корп\.|\bк\./g, ' корпус ')
    .replace(/(\d+)\s*к\s*(\d+)/g, '$1 корпус $2')
    .replace(/литера|лит\./g, ' литера ')
    .replace(/дом|д\./g, ' ')
    .replace(/[^а-яa-z\d/]+/g, ' ').trim().replace(/\s+/g, ' ');
  const tokens = normalized.split(' ');
  const types = new Set(['проспект', 'улица', 'набережная', 'линия', 'переулок', 'шоссе', 'площадь']);
  return [...tokens.filter((token) => types.has(token)).sort(), ...tokens.filter((token) => !types.has(token))].join(' ');
}

export function matchHouseAddress(wantedAddress: string, actualAddress: string, distanceMeters: number): 'exact' | 'main-letter-omitted' | 'corner-address' | null {
  const wanted = normalizeHouseAddress(wantedAddress);
  const actual = normalizeHouseAddress(actualAddress);
  if (!Number.isFinite(distanceMeters) || distanceMeters > 100) return null;
  if (wanted === actual) return 'exact';
  if (distanceMeters <= 60 && wanted.replace(/ литера а$/, '') === actual.replace(/ литера а$/, '')) return 'main-letter-omitted';
  const wantedCorner = wanted.match(/(\d+)\/(\d+)/);
  const actualCorner = actual.match(/(\d+)\/(\d+)/);
  if (distanceMeters <= 50 && wantedCorner && actualCorner && wantedCorner[1] === actualCorner[2]
    && wantedCorner[2] === actualCorner[1]) return 'corner-address';
  return null;
}
