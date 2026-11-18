const SOURCE_HOSTS: Record<string, string> = {
  'gorod.gov.spb.ru': 'gorod', 'www.citywalls.ru': 'citywalls',
  'um.mos.ru': 'moscow-history', 'api.cian.ru': 'cian', 'www.avito.ru': 'avito',
  'apidata.mos.ru': 'moscow-data', 'api.openstreetmap.org': 'osm', 'overpass-api.de': 'overpass',
  'photon.komoot.io': 'photon', 'ru.wikipedia.org': 'wikipedia',
};

/** Maps known public sources to fixed upstreams on the existing CoDoc web host. */
export function publishedSourceUrl(target: string): string {
  const base = import.meta.env.VITE_PUBLIC_SOURCES_BASE_URL as string | undefined;
  if (!base || !/^https:\/\//.test(target)) return target;
  const url = new URL(target);
  const alias = SOURCE_HOSTS[url.hostname];
  return alias ? `${base.replace(/\/$/, '')}/${alias}${url.pathname}${url.search}` : target;
}
