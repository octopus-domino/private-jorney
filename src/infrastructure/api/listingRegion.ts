/** Keeps regional search parameters consistent across the API, public search links and offer URLs. */
export function listingRegion(point?: { lat: number; lng: number }) {
  const moscow = point && point.lat > 55.1 && point.lat < 56.15 && point.lng > 36.6 && point.lng < 38.4;
  return moscow ? { cianOrigin: 'https://www.cian.ru', cianRegion: '1', avitoCity: 'moskva', avitoLocation: '637640' }
    : { cianOrigin: 'https://spb.cian.ru', cianRegion: '2', avitoCity: 'sankt-peterburg', avitoLocation: '653240' };
}
