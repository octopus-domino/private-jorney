import { test, beforeEach } from 'node:test';
import './recording.test';
import './moscow-data.test';
import './building-footprints.test';
import './ready-walks.test';
import './codoc-search-transport.test';
import './citywalls-local-index.test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { parseGorodProfile, parseGorodPlans } from '../src/infrastructure/api/parseGorodProfile';
import { maintenanceCategory } from '../src/domain/maintenancePolicy';
import { summarizeBuildingProfile } from '../src/application/use-cases/summarizeBuildingProfile';
import { snapshotWalk } from '../src/application/use-cases/snapshotWalk';
import { createDraft, useWalkStore } from '../src/presentation/state/walkStore';
import { LocalDraftStore } from '../src/infrastructure/persistence/localDraftStore';
import { parseCianListings, CianApartmentListingsRepository } from '../src/infrastructure/api/cianApartmentListingsRepository';
import { parseAvitoMapListings, AvitoApartmentListingsRepository } from '../src/infrastructure/api/avitoApartmentListingsRepository';
import { normalizeHouseAddress } from '../src/shared/address';
import { citywallsSquares, parseCitywallsPoints, matchCitywallsPoint } from '../src/infrastructure/api/citywallsMap';
import { CitywallsHistoryRepository } from '../src/infrastructure/api/citywallsHistoryRepository';
import type { Poi } from '../src/domain/Poi';
import type { WalkingRoute } from '../src/domain/WalkingRoute';
import { fetchExternalPage } from '../src/infrastructure/api/externalPageTransport';
import { ExternalSourceError } from '../src/infrastructure/api/externalPageTransport';
import { GorodSourceError, readGorodStage } from '../src/infrastructure/api/gorodSourceError';
import { GorodHouseLocator } from '../src/infrastructure/api/gorodHouseLocator';
import { withRequestDeadline } from '../src/shared/withRequestDeadline';
import { CitywallsMapCache } from '../src/infrastructure/api/citywallsMapCache';
import { publishedSourceUrl } from '../src/infrastructure/api/publishedSourceUrl';

test('external house sources are never redirected to a CoDoc relay', () => {
  for (const url of ['https://www.citywalls.ru/map_around.html', 'https://gorod.gov.spb.ru/public_api/maps/get_nearest/?latitude=59.94',
    'https://api.cian.ru/search-engine/v1/search-offers-mobile-site/', 'https://www.avito.ru/js/1/map/items'])
    assert.equal(publishedSourceUrl(url), url);
});

test('a cached Citywalls map index avoids another mobile map and multi-megabyte square download', async () => {
  const storage = new Map<string, unknown>();
  const mapCache = new CitywallsMapCache({ get: key => storage.get(key) as never,
    set: (key, value) => { storage.set(key, structuredClone(value)); } });
  let maps = 0, squares = 0, houses = 0;
  const point: Poi = { id: 'cached-map', lat: 59.94, lng: 30.27, source: 'manual', name: 'Дом', categoryIds: [], facts: [] };
  const read = async (url: string) => {
    if (url.includes('map_around')) { maps++; return 'SID: "s=test123"'; }
    if (url.includes('map_handler')) { squares++; return JSON.stringify({ result: 'ok', geodata: { features: [{ geometry: {
      geometries: [{ type: 'Point', coordinates: [point.lng, point.lat], id: 1709, title: 'Дом' }],
    } }] } }); }
    houses++; return fixture('citywalls-house.html');
  };
  for (let pass = 0; pass < 2; pass++) {
    const repository = new CitywallsHistoryRepository(read, { get: () => undefined, set: () => undefined }, mapCache);
    assert.ok(await repository.lookup(point));
  }
  assert.deepEqual({ maps, squares, houses }, { maps: 1, squares: 1, houses: 2 });
});

test('Petersburg resolves the reported point through the portal without calling a broken Photon', async () => {
  const point = { id: 'reported', lat: 59.9394057944393, lng: 30.269812345504764, name: 'Дом', source: 'manual' as const, categoryIds: [], facts: [] };
  const locator = new GorodHouseLocator({ search: async () => [], reverse: async () => { throw new Error('Photon must not be called'); } }, async url => {
    const request = new URL(url);
    assert.equal(request.pathname, '/public_api/maps/get_nearest/');
    assert.equal(Number(request.searchParams.get('latitude')), point.lat);
    return JSON.stringify({ buildings: [{ id: 198090, full_address: '14-я линия В.О., дом 35, литера А', latitude: 59.9393728, longitude: 30.2697387 }] });
  });
  assert.equal((await locator.find(point))?.id, 198090);
});

test('Petersburg coordinate lookup rejects ambiguous and distant neighbours, and cancellation cannot trigger Photon', async () => {
  const point = { id: 'point', lat: 59.94, lng: 30.27, name: 'Дом', source: 'manual' as const, categoryIds: [], facts: [] };
  const rows = [{ id: 1, latitude: point.lat, longitude: point.lng }, { id: 2, latitude: point.lat, longitude: point.lng }];
  const locator = new GorodHouseLocator({ search: async () => [], reverse: async () => ({ label: 'Координаты' }) }, async () => JSON.stringify({ buildings: rows }));
  assert.equal(await locator.find(point), null);
  const controller = new AbortController(); controller.abort();
  const cancelled = new GorodHouseLocator({ search: async () => [], reverse: async () => { throw new Error('Unexpected reverse'); } }, async () => { throw new DOMException('Aborted', 'AbortError'); });
  await assert.rejects(cancelled.find(point, controller.signal), error => error instanceof DOMException && error.name === 'AbortError');
});

test('portal passport under revision retains confirmed header facts without fabricating residents or wear', () => {
  const profile = parseGorodProfile(fixture('gorod-passport-updating.html'), 'Дом', 'https://gorod.gov.spb.ru/facilities/139493/info/');
  assert.equal(profile.passportStatus, 'updating');
  assert.match(profile.address, /Мойки, дом 74/);
  assert.equal(profile.yearBuilt, null);
  assert.equal(profile.floors, null);
  assert.equal(profile.residents, null);
  assert.deepEqual(summarizeBuildingProfile(profile), [{ label: 'Назначение', value: 'Нежилое здание' }]);
  assert.throws(() => parseGorodProfile('<html><h1>Login</h1></html>', 'Дом', profile.sourceUrl), /unavailable/);
  assert.throws(() => parseGorodProfile('<div class="facility-no-tep">Unknown response</div>', 'Дом', profile.sourceUrl), /unavailable/);
});

test('updating passport skips programs and is not cached as a complete profile; retry loads published data', async () => {
  let updating = true, passportReads = 0, programReads = 0;
  const repository = new GorodBuildingProfileRepository({ search: async () => [], reverse: async () => { throw new Error('Unexpected Photon'); } }, async url => {
    if (new URL(url).hostname === 'api.openstreetmap.org') return '<osm version="0.6"/>';
    if (url.includes('/get_nearest/')) return JSON.stringify({ buildings: [{ id: 139493, full_address: 'Мойки, 74', latitude: poi.lat, longitude: poi.lng }] });
    if (url.includes('/programs/')) { programReads++; return fixture('gorod-programs.html'); }
    passportReads++;
    return fixture(updating ? 'gorod-passport-updating.html' : 'gorod-36556.html');
  });
  assert.equal((await repository.lookup(poi))?.passportStatus, 'updating');
  assert.equal(programReads, 0);
  updating = false;
  const complete = await repository.lookup(poi);
  assert.equal(complete?.passportStatus, undefined);
  assert.ok(complete?.residents);
  assert.equal(programReads, 1);
  assert.equal(passportReads, 2);
});

test('address deadline releases stalled lookups and preserves caller cancellation', async () => {
  let child: AbortSignal | undefined;
  await assert.rejects(withRequestDeadline(signal => { child = signal; return new Promise(() => {}); }, 15), /timed out/);
  assert.equal(child?.aborted, true);
  const controller = new AbortController();
  const pending = withRequestDeadline(() => new Promise(() => {}), 1000, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
});

test('portal diagnostics identify failed stage and HTTP restriction without exposing source content', async () => {
  await assert.rejects(readGorodStage('address', async () => { throw new ExternalSourceError('restricted', 403); }),
    error => error instanceof GorodSourceError && error.message.includes('Поиск адреса') && error.message.includes('HTTP 403'));
  await assert.rejects(readGorodStage('passport', async () => { throw new Error('private source body'); }),
    error => error instanceof GorodSourceError && error.message.includes('Загрузка паспорта') && !error.message.includes('private source body'));
});

test('portal diagnostics preserve cancellation and distinguish native timeout from network failure', async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = new DOMException('Aborted', 'AbortError');
  await assert.rejects(readGorodStage('passport', async () => { throw aborted; }, controller.signal), error => error === aborted);
  await assert.rejects(fetchExternalPage('https://gorod.gov.spb.ru/facilities/36556/info/', {
    native: true, nativeGet: async () => { throw new Error('Source request timed out'); },
    fetchPage: async () => { throw new Error('Web transport must not be used'); },
  }), error => error instanceof ExternalSourceError && error.code === 'timeout');
});
import { gorodSearchQuery } from '../src/infrastructure/api/gorodSearchQuery';
import { GorodBuildingProfileRepository } from '../src/infrastructure/api/gorodBuildingProfileRepository';
import { PersistentSuccessCache } from '../src/shared/persistentSuccessCache';
import { SharedRequestPool } from '../src/shared/sharedRequestPool';
import { FavoritePlacesService } from '../src/application/use-cases/favoritePlacesService';
import { LocalFavoritesRepository } from '../src/infrastructure/persistence/localFavoritesRepository';
import { walkEndpoints } from '../src/application/use-cases/walkEndpoints';
import { MoscowHistoryRepository } from '../src/infrastructure/api/moscowHistoryRepository';
import { CianAreaCache } from '../src/infrastructure/api/cianAreaCache';

Object.assign(globalThis, { DOMParser });
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');
const poi: Poi = { id: 'test', name: 'Дом', lat: 59.9386, lng: 30.3141, categoryIds: ['historical-house'], facts: [], source: 'historical-house' };
const second: Poi = { ...poi, id: 'custom', source: 'manual', lng: 30.34 };
const route: WalkingRoute = { geometry: [[poi.lat, poi.lng], [second.lat, second.lng]], legs: [{ fromIndex: 0, toIndex: 1, geometry: [[poi.lat, poi.lng], [second.lat, second.lng]], distanceMeters: 1200, durationSeconds: 900 }], totalDistanceMeters: 1200, totalDurationSeconds: 900 };
beforeEach(() => { memory.clear(); useWalkStore.getState().createNewDraft(); });

test('current CIAN search payload is parsed without href and matches the selected corner building', () => {
  const response = JSON.parse(fixture('cian-search.json'));
  const point = { lat: 59.940902, lng: 30.271743 };
  const items = parseCianListings(response, 'Санкт-Петербург, Средний Васильевского острова проспект, 48/27', point);
  assert.equal(items[0]?.id, '335039742');
  assert.equal(items[0]?.priceRub, 47500000);
  assert.equal(items[0]?.url, 'https://spb.cian.ru/sale/flat/335039742/');
  assert.equal(items[0]?.title, '3-комн. квартира · 148 м² · 4/4 этаж');
  assert.equal(parseCianListings(response, 'Санкт-Петербург, 12-я линия В.О., 27/48', point)[0]?.matchNote?.startsWith('Угловой дом'), true);
  assert.equal(parseCianListings(response, 'Санкт-Петербург, 13-я линия В.О., 44', point).length, 0);
  assert.equal(parseCianListings(response, 'Санкт-Петербург, 12-я линия В.О., 27/48', { lat: point.lat + 0.002, lng: point.lng }).length, 0);
});

test('CIAN bbox cache lasts ten minutes, restores across instances, and checks cached houses before either API', async () => {
  let now = 1000;
  const area = { south: 59.9, west: 30.2, north: 60, east: 30.4 };
  const cache = new CianAreaCache<any>(response => (response as {offers:unknown[]}).offers, () => now);
  cache.remember(area, 'modern', JSON.parse(fixture('cian-search.json')).offers);
  const restored = new CianAreaCache<any>(response => (response as {offers:unknown[]}).offers, () => now);
  assert.equal(restored.get(area, 'modern')?.length, 1);
  assert.equal(restored.get(area, 'legacy'), undefined);
  const repository = new CianApartmentListingsRepository(async () => { throw new Error('Legacy must not run'); },
    async () => { throw new Error('POST must not run'); }, restored);
  assert.equal((await repository.lookup('Санкт-Петербург, Средний Васильевского острова проспект, 48/27', undefined,
    { lat: 59.940902, lng: 30.271743 }))[0]?.id, '335039742');
  now += 10 * 60 * 1000 + 1;
  assert.equal(restored.get(area, 'modern'), undefined);
  assert.equal(restored.allOffers().length, 0);
});

test('CIAN keeps the old map route and falls back to the new POST search only when needed', async () => {
  let posts = 0;
  const repository = new CianApartmentListingsRepository(async () => { throw new Error('Legacy unavailable'); },
    async (url, payload) => {
      posts++;
      assert.equal(url, 'https://api.cian.ru/search-engine/v1/search-offers-mobile-site/');
      assert.equal(new URL((payload as any).path, 'https://api.cian.ru').pathname, '/v1/get-results-for-map');
      assert.equal(new URL((payload as any).path, 'https://api.cian.ru').searchParams.get('offer_type'), 'flat');
      assert.equal(new URL((payload as any).path, 'https://api.cian.ru').searchParams.get('bbox'), '59.9,30.2,60,30.4');
      return fixture('cian-search.json');
    });
  assert.equal((await repository.lookup('Санкт-Петербург, Средний Васильевского острова проспект, 48/27', undefined,
    { lat: 59.940902, lng: 30.271743 }, { south: 59.9, west: 30.2, north: 60, east: 30.4 }))[0]?.id, '335039742');
  assert.equal(posts, 1);
  const legacy = new CianApartmentListingsRepository(async () => fixture('cian-map.json'), async () => { throw new Error('New strategy must not be called'); });
  assert.equal((await legacy.lookup('Санкт-Петербург, 8-я линия В.О., дом 45/34', undefined, { lat: 59.942038, lng: 30.276872 }))[0]?.id, '334867477');
});

test('Moscow history matches catalogue coordinates and the selected address and persists across restart', async () => {
  const point = { ...poi, id: 'moscow', lat: 55.75943295911467, lng: 37.56834975865027,
    details: { address: 'Москва, Большой Предтеченский переулок, 13, строение 1' } };
  let reads = 0;
  const reader = async (url: string) => { reads++; return fixture(url.includes('/api/v2/points') ? 'moscow-points.json' : 'moscow-house.html'); };
  const repository = new MoscowHistoryRepository(reader);
  const history = await repository.lookup(point);
  assert.equal(history?.sourceName, 'Узнай Москву');
  assert.equal(history?.sourceUrl, 'https://um.mos.ru/houses/gidrometcentr-rossii/');
  assert.ok(history!.excerpt.length > 80);
  assert.equal((await new MoscowHistoryRepository(reader).lookup(point))?.sourceUrl, history?.sourceUrl);
  assert.equal(reads, 2);
  assert.equal(await repository.lookup({ ...point, lat: point.lat + 0.002 }), null);
  assert.equal(await repository.lookup({ ...point, lng: point.lng + 0.00001, details: { address: 'Москва, Большой Предтеченский переулок, 15' } }), null);
});

test('successful building cache survives restart, validates records, expires and isolates copies', () => {
  let now = 1000;
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  const cache = () => new PersistentSuccessCache<{ title: string }>('test-cache', 100, raw => raw && typeof raw === 'object' && 'title' in raw && typeof raw.title === 'string' ? { title: raw.title } : undefined, () => storage, () => now);
  cache().set('house', { title: 'Дом' });
  const copy = cache().get('house')!;
  copy.title = 'Изменено';
  assert.equal(cache().get('house')?.title, 'Дом');
  now += 101;
  assert.equal(cache().get('house'), undefined);
});

test('Citywalls and passport successes survive repository recreation without new requests', async () => {
  const selected = { ...poi, details: { address: 'Санкт-Петербург, улица Тестовая, 15', sourceUrl: 'https://www.citywalls.ru/house1709.html' } };
  const history = new CitywallsHistoryRepository(async () => fixture('citywalls-house.html'));
  await history.lookup(selected);
  const offline = async (): Promise<string> => { throw new Error('Network must not be requested'); };
  assert.equal((await new CitywallsHistoryRepository(offline).lookup({ ...selected, id: 'same-house-another-card' }))?.sourceUrl, selected.details.sourceUrl);
  const geocoder = { search: async () => [], reverse: async () => ({ label: selected.details.address }) };
  const profile = new GorodBuildingProfileRepository(geocoder, async source => source.includes('/search/ajax/')
    ? JSON.stringify([{ data: 36556, lat: poi.lat, lon: poi.lng, main_address: selected.details.address }])
    : fixture(source.includes('/programs/') ? 'gorod-programs.html' : 'gorod-36556.html'));
  await profile.lookup(selected);
  assert.equal((await new GorodBuildingProfileRepository(geocoder, offline).lookup(selected))?.sourceUrl,
    'https://gorod.gov.spb.ru/facilities/36556/info/');
});

test('shared cancellation leaves another subscriber alive and new cards never inherit aborted work', async () => {
  const pool = new SharedRequestPool<string>();
  const controller = new AbortController();
  let finish!: (value: string) => void;
  const first = pool.run('house', () => new Promise<string>(resolve => { finish = resolve; }), controller.signal);
  const firstResult = assert.rejects(first, (error: any) => error.name === 'AbortError');
  const second = pool.run('house', async () => 'must share');
  await Promise.resolve();
  controller.abort();
  finish('ready');
  await firstResult;
  assert.equal(await second, 'ready');
  const abandoned = new AbortController();
  const pending = pool.run('next', signal => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))), abandoned.signal);
  const rejected = assert.rejects(pending);
  await Promise.resolve();
  abandoned.abort();
  assert.equal(await pool.run('next', async () => 'new request'), 'new request');
  await rejected;
});

test('favorites persist independently, distinguish cities, prevent duplicates and support deletion', async () => {
  const repository = new LocalFavoritesRepository();
  const service = new FavoritePlacesService(repository, { search: async () => [], reverse: async () => ({ label: '', city: 'Москва' }) });
  const petersburg = { ...poi, details: { address: 'Санкт-Петербург, 13-я линия, 44' } };
  await service.add(petersburg);
  await service.add(petersburg);
  await service.add({ ...second, details: { address: 'Москва, Тверская, 1' } });
  const restored = new LocalFavoritesRepository().list();
  assert.deepEqual(restored.map(item => item.city), ['Санкт-Петербург', 'Москва']);
  assert.equal(service.remove(poi.id).length, 1);
  assert.equal(useWalkStore.getState().draft.selectedPoiIds.length, 0);
});

test('saved route endpoints follow itinerary order and city survives serialization', () => {
  const draft = { ...createDraft(), city: 'Санкт-Петербург', selectedPoiIds: [second.id, poi.id], savedPois: [poi, second] };
  assert.equal(walkEndpoints(draft).from, second.name);
  assert.equal(walkEndpoints(draft).to, poi.name);
});

test('city portal search expands compact house blocks without changing numbered street names', () => {
    // The live portal returns [] for the expanded island name and finds houses for its official abbreviation.
    assert.equal(gorodSearchQuery('13-я линия Васильевского острова, 44, Санкт-Петербург, Россия'), '13-я линия В.О., 44');
  for (const suffix of ['19к2', '19 к2', '19 корп. 2']) {
    assert.equal(gorodSearchQuery(`проспект Космонавтов, ${suffix}, Saint Petersburg, Russia`), 'проспект Космонавтов, 19, корпус 2');
  }
  assert.equal(gorodSearchQuery('Санкт-Петербург, 19-я линия В.О., 24'), '19-я линия В.О., 24');
  assert.equal(gorodSearchQuery('59.9407, 30.3214'), null);
});

test('transient source failures get one retry but restrictions are not retried', async () => {
  let calls = 0;
  const body = await fetchExternalPage('https://www.citywalls.ru/house1709.html', {
    native: true,
    nativeGet: async () => ({ status: ++calls === 1 ? 503 : 200, data: 'history' }),
    fetchPage: async () => { throw new Error('not used'); },
  });
  assert.equal(body, 'history');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchExternalPage('https://www.citywalls.ru/house1709.html', {
    native: true, nativeGet: async () => { calls++; return { status: 403, data: '' }; },
    fetchPage: async () => { throw new Error('not used'); },
  }));
  assert.equal(calls, 1);
});

test('leaving the card cancels retry backoff and sends no further source requests', async () => {
  let calls = 0;
  const controller = new AbortController();
  const promise = fetchExternalPage('https://www.citywalls.ru/house1709.html', {
    native: true, nativeGet: async () => { calls++; return { status: 503, data: '' }; },
    fetchPage: async () => { throw new Error('not used'); },
  }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(promise, (error: any) => error.name === 'AbortError');
  assert.equal(calls, 1);
});

test('Citywalls refreshes an expired map session within the same lookup', async () => {
  let sessions = 0;
  const repository = new CitywallsHistoryRepository(async (source) => {
    const url = new URL(source);
    if (url.pathname === '/map_around.html') return `SID:"s=session${++sessions}"`;
    if (url.pathname === '/include/map_handler.php') return JSON.stringify(url.searchParams.get('s') === 'session1'
      ? { result: 'error' }
      : { result: 'ok', geodata: { features: [{ geometry: { geometries: [{ type: 'Point', id: 1709, title: 'Дом', coordinates: [poi.lng, poi.lat] }] } }] } });
    return fixture('citywalls-house.html');
  });
  assert.equal((await repository.lookup(poi))?.sourceUrl, 'https://www.citywalls.ru/house1709.html');
  assert.equal(sessions, 2);
});

test('city portal falls back to the clicked coordinates when the POI address finds no house', async () => {
  let reversed = false;
  const repository = new GorodBuildingProfileRepository({
    search: async () => [], reverse: async () => { reversed = true; return { label: 'Нужная улица, 15' }; },
  }, async (source) => {
    const url = new URL(source);
    if (url.pathname.includes('/search/ajax/')) return JSON.stringify(url.searchParams.get('query') === 'Нужная улица, 15'
      ? [{ data: 36556, lat: poi.lat, lon: poi.lng, main_address: 'Нужная улица, дом 15' }] : []);
    return fixture(url.pathname.includes('/programs/') ? 'gorod-programs.html' : 'gorod-36556.html');
  });
  const result = await repository.lookup({ ...poi, details: { address: 'Старое название, 15' } });
  assert.equal(result?.sourceUrl, 'https://gorod.gov.spb.ru/facilities/36556/info/');
  assert.equal(reversed, true);
});

test('building lookup sends expanded address and still verifies the returned house coordinates', async () => {
  const selected = { ...poi, lat: 59.86181641, lng: 30.34551239 };
  const urls: URL[] = [];
  const repository = new GorodBuildingProfileRepository({
    search: async () => [], reverse: async () => ({ label: 'проспект Космонавтов 19 к2, Saint Petersburg, Russia' }),
  }, async (source) => {
    const url = new URL(source); urls.push(url);
    if (url.pathname.endsWith('/search/ajax/')) {
      assert.equal(url.searchParams.get('query'), 'проспект Космонавтов 19, корпус 2');
      return JSON.stringify([{ data: 110378, lat: 59.8617658, lon: 30.3454781, main_address: 'проспект Космонавтов, дом 19, корпус 2' }]);
    }
    return fixture(url.pathname.includes('/programs/') ? 'gorod-programs.html' : 'gorod-36556.html');
  });
  const profile = await repository.lookup(selected);
  assert.equal(profile?.sourceUrl, 'https://gorod.gov.spb.ru/facilities/110378/info/');
  assert.ok(urls.some((url) => url.pathname === '/facilities/110378/programs/'));
});

test('full route, geometry and custom points survive save/load and background POI failure', async () => {
  const s = useWalkStore.getState();
  s.setPois([poi, second], 'ready'); s.togglePoi(poi.id); s.togglePoi(second.id); s.setRoute(route, 'ready');
  const snapshot = snapshotWalk(useWalkStore.getState().draft, [poi, second], route, []);
  const persistence = new LocalDraftStore();
  await persistence.save(snapshot);
  s.createNewDraft();
  const restored = await persistence.load(snapshot.id);
  assert.ok(restored);
  s.hydrate(restored);
  s.setPois([], 'error', 'network');
  const result = useWalkStore.getState();
  assert.deepEqual(result.route, route);
  assert.deepEqual(result.draft.selectedPoiIds, [poi.id, second.id]);
  assert.equal(result.customPois[0].id, second.id);
  assert.equal(result.pois.length, 2);
  s.movePoi(second.id, -1);
  assert.equal(useWalkStore.getState().route, null);
});

test('partial route keeps failed sections when restored', () => {
  useWalkStore.getState().hydrate({ ...createDraft(), selectedPoiIds: [poi.id, second.id], savedPois: [poi, second], savedRoute: route, savedFailedSegments: [0] });
  assert.equal(useWalkStore.getState().routeStatus, 'error');
  assert.deepEqual(useWalkStore.getState().routeFailedSegments, [0]);
});

test('old drafts remain readable and malformed records are skipped', async () => {
  const old = createDraft();
  memory.set('private-walks/drafts/v1', JSON.stringify([old, { id: 'broken' }]));
  const persistence = new LocalDraftStore();
  assert.equal((await persistence.list()).length, 1);
  useWalkStore.getState().hydrate((await persistence.load(old.id))!);
  assert.equal(useWalkStore.getState().route, null);
  memory.set('private-walks/drafts/v1', '{}');
  assert.deepEqual(await persistence.list(), []);
});

test('maintenance categories follow SP 547 boundaries and whole-number rounding', () => {
  for (const [wear, category] of [[0, null], [30, 1], [30.49, 1], [30.5, 2], [50, 2], [50.5, 3], [65, 3], [65.5, 4], [100, 4], [101, null]]) assert.equal(maintenanceCategory(wear!), category);
});

test('real city passport provides aggregate age data without reading personal records', () => {
  const profile = parseGorodProfile(fixture('gorod-36556.html'), 'Дом', 'https://gorod.gov.spb.ru/facilities/36556/info/');
  assert.deepEqual(profile.ages, { children: 18, working: 55, older: 35 });
  assert.equal(profile.wear['Кровля'], 21.08);
  const facts = summarizeBuildingProfile(profile, 2026);
  assert.ok(facts.some((f) => f.label === 'Кто живёт в доме' && /Большинство/.test(f.value)));
  assert.ok(facts.find((f) => f.label === 'Капремонт')?.value.includes('нужен ремонт'));
  assert.ok(!facts.some((f) => /%|недавно|давно|постановлен/i.test(f.value)));
});

test('separate and communal apartments are parsed from their own tables', () => {
  const profile = parseGorodProfile(fixture('gorod-111980.html'), 'Дом', 'source');
  assert.equal(profile.communalFlats, 49);
  assert.equal(profile.separateFlats, 254);
  assert.ok(profile.features.some((f) => f.label === 'Плитка'));
  assert.ok(!profile.features.some((f) => /старая плитка|историческая плитка|деревянные лестницы|камины/i.test(f.value)));
});

test('zero fields are omitted; missing and unknown values do not become zeros', () => {
  const profile = parseGorodProfile(fixture('gorod-36556.html'), 'Дом', 'source');
  Object.assign(profile, { residents: 0, floors: 0, yearBuilt: 0, communalFlats: 0, separateFlats: 0, ages: { children: 0, working: 0, older: 0 }, wear: { Крыша: 0 }, repairs: [], features: [], plans: [] });
  assert.deepEqual(summarizeBuildingProfile(profile), []);
  profile.residents = null;
  assert.deepEqual(summarizeBuildingProfile(profile), []);
});

test('materials and fireplaces require explicit positive evidence; wooden floors do not imply wooden stairs', () => {
  const html = `<div class="sidebar-page__content"><div class="facility-tep"></div>
    <table><thead><tr><th>Тип</th><th>Описание конструктивного элемента</th><th>Износ элемента</th></tr></thead><tbody>
      <tr><td>Лестницы</td><td>Деревянные по металлическим косоурам</td><td>35</td></tr>
      <tr><td>Стены</td><td>Кирпичные</td><td>20</td></tr>
    </tbody></table>
    <table><tbody><tr><td>Площадь дощатых полов на лестничных клетках</td><td>кв. м</td><td>12</td></tr>
    <tr><td>Количество каминов</td><td>шт.</td><td>2</td></tr></tbody></table></div>`;
  const profile = parseGorodProfile(html, 'Дом', 'source');
  assert.ok(profile.features.some((f) => f.label === 'Лестницы' && /Деревянные/.test(f.value)));
  assert.ok(profile.features.some((f) => f.label === 'Камины'));
  assert.ok(profile.features.some((f) => f.label === 'Дерево в интерьере' && /не подтверждает/.test(f.detail!)));
  assert.ok(!profile.features.some((f) => /старинные|действующие/.test(f.value)));
});

test('absence of one gender or age cell prevents invented demographic percentages', () => {
  const html = fixture('gorod-36556.html').replace(/<td>Дети и подростки \(мужчины\)<\/td>\s*<td>\s*11\s*<\/td>/, '<td>Дети и подростки (мужчины)</td><td>-</td>');
  const profile = parseGorodProfile(html, 'Дом', 'source');
  assert.equal(profile.ages.children, null);
  assert.ok(!summarizeBuildingProfile(profile).some((f) => f.label === 'Кто живёт в доме'));
});

test('gas and lifts do not determine the SP maintenance classification', () => {
  const profile = parseGorodProfile(fixture('gorod-36556.html'), 'Дом', 'source');
  profile.wear = { 'Газовое оборудование': 90, 'Лифтовое оборудование': 95, Кровля: 20 };
  const facts = summarizeBuildingProfile(profile);
  assert.match(facts.find((f) => f.label === 'Капремонт')!.value, /пока не требуется/);
});

test('planned work is not treated as completed repair', () => {
  const profile = parseGorodProfile(fixture('gorod-36556.html'), 'Дом', 'source');
  profile.plans = parseGorodPlans(fixture('gorod-programs.html'));
  assert.ok(profile.plans.some((p) => /Теплоснабжение/.test(p.work) && p.startYear === 2027));
  assert.ok(!profile.plans.some((p) => /документац/i.test(p.work)));
  profile.repairs = [{ year: 2030, work: 'Ремонт крыши' }];
  const facts = summarizeBuildingProfile(profile, 2026);
  assert.ok(!facts.some((f) => /Выполненные работы.*2030/.test(f.detail ?? '')));
});

test('Citywalls map grid, GeoJSON and ambiguity protection', () => {
  assert.ok(citywallsSquares(poi).includes(55));
  assert.deepEqual(citywallsSquares({ lat: 55.75, lng: 37.61 }), []);
  const points = parseCitywallsPoints({ features: [{ geometry: { geometries: [{ type: 'Point', id: 1709, title: 'Дом', coordinates: [poi.lng, poi.lat] }, { type: 'Point', id: 'bad', coordinates: [] }] } }] });
  assert.equal(matchCitywallsPoint(poi, points)?.id, 1709);
  assert.equal(matchCitywallsPoint(poi, [...points, { ...points[0], id: 1710 }]), null);
});

test('Citywalls loads actual history and direct source URL with caching', async () => {
  let count = 0;
  const repository = new CitywallsHistoryRepository(async () => { count++; return fixture('citywalls-house.html'); });
  const point = { ...poi, details: { sourceUrl: 'https://www.citywalls.ru/house1709.html?s=ignored' } };
  const history = await repository.lookup(point);
  assert.equal(history?.sourceUrl, 'https://www.citywalls.ru/house1709.html');
  assert.ok(history?.excerpt && history.excerpt.length >= 80 && !history.excerpt.endsWith('…'));
  await repository.lookup(point);
  assert.equal(count, 1);
});

test('Android public house-info sources use native transport even when app origin is localhost', async () => {
  const urls = ['https://www.citywalls.ru/house1709.html', 'https://gorod.gov.spb.ru/facilities/36556/info/',
    'https://www.avito.ru/js/1/map/items?categoryId=24', 'https://api.cian.ru/mobile-search-frontend/v1/get-results-for-map-microfrontend/'];
  const received: string[] = [];
  for (const url of urls) {
    const body = await fetchExternalPage(url, {
      native: true, webProxyUrl: '/history-source',
      nativeGet: async (target) => { received.push(target); return { status: 200, data: '{"ok":true}' }; },
      fetchPage: async () => { throw new Error('Browser/localhost fetch must never be used on Android'); },
    });
    assert.equal(body, '{"ok":true}');
  }
  assert.deepEqual(received, urls);
});

test('Android handles blocked sources and cancellation without newer AbortSignal static methods', async () => {
  const transport = { native: true, nativeGet: async () => ({ status: 403, data: '' }), fetchPage: async () => { throw new Error('not used'); } };
  await assert.rejects(fetchExternalPage('https://www.avito.ru/js/1/map/items', transport), (error: any) => error.code === 'restricted');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchExternalPage('https://www.citywalls.ru/', transport, controller.signal), (error: any) => error.name === 'AbortError');
});

test('Citywalls retains full paragraphs and selects building photo rather than an arbitrary portrait', async () => {
  const paragraph = 'Историческое здание с сохранившимися архитектурными деталями. '.repeat(12).trim();
  const html = `<div class="cssHouseHead"><h1>Дом</h1><img src="https://p2.citywalls.ru/thumb0_9-9530.jpg"></div><div class="mceContentBody"><p>${paragraph}</p></div>`;
  const repository = new CitywallsHistoryRepository(async () => html);
  const result = await repository.lookup({ ...poi, details: { sourceUrl: 'https://www.citywalls.ru/house1709.html' } });
  assert.equal(result?.excerpt, paragraph);
  assert.equal(result?.imageUrl, 'https://p2.citywalls.ru/photo_9-9530.jpg');
});

test('CIAN real map manifest yields price, photo, title and clean link for exact house', () => {
  const response = JSON.parse(fixture('cian-map.json'));
  const listings = parseCianListings(response, 'Санкт-Петербург, 8-я Васильевского острова линия, дом 45/34', { lat: 59.942038, lng: 30.276872 });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].priceRub, 29100000);
  assert.equal(listings[0].url, 'https://spb.cian.ru/sale/flat/334867477/');
  assert.ok(listings[0].imageUrl);
  assert.deepEqual(parseCianListings(response, 'Санкт-Петербург, 8-я Васильевского острова линия, 46', { lat: 59.942038, lng: 30.276872 }), []);
});

test('Avito supplied map payload yields exact-house listing and rejects neighbouring buildings', () => {
  const response = JSON.parse(fixture('avito-map.json'));
  const point = { lat: 59.86181641, lng: 30.34551239 };
  assert.equal(normalizeHouseAddress('Санкт-Петербург, Космонавтов проспект, дом 19, корпус 2'), normalizeHouseAddress('Санкт-Петербург, проспект Космонавтов, 19к2'));
  const listings = parseAvitoMapListings(response, 'Санкт-Петербург, Космонавтов проспект, дом 19, корпус 2', point);
  assert.equal(listings[0]?.priceRub, 18100000);
  assert.equal(listings[0]?.url, 'https://www.avito.ru/sankt-peterburg/kvartiry/2-k._kvartira_55_m_55_et._8493504075');
  assert.ok(parseAvitoMapListings(response, 'Санкт-Петербург, Космонавтов проспект, 19к2, литера А', point)[0]?.matchNote);
  assert.deepEqual(parseAvitoMapListings(response, 'Санкт-Петербург, Космонавтов проспект, 19к2, литера Б', point), []);
  assert.deepEqual(parseAvitoMapListings(response, 'Санкт-Петербург, Космонавтов проспект, 19, корпус 1', point), []);
  response.items[0].priceDetailed.value = 0;
  assert.deepEqual(parseAvitoMapListings(response, 'Санкт-Петербург, Космонавтов проспект, 19к2', point), []);
});

test('listing repositories send current building bounds instead of hardcoded example coordinates', async () => {
  const urls: URL[] = [];
  const read = async (url: string) => { urls.push(new URL(url)); return urls.length === 1 ? fixture('cian-map.json') : fixture('avito-map.json'); };
  const point = { lat: 59.942038, lng: 30.276872 };
  await new CianApartmentListingsRepository(read, async () => '{"offers":[]}').lookup('Дом 1', undefined, point);
  await new AvitoApartmentListingsRepository(read).lookup('Дом 1', undefined, point);
  assert.equal(urls[0].hostname, 'api.cian.ru');
  assert.equal(urls[0].searchParams.get('center'), `${point.lat},${point.lng}`);
  const area = JSON.parse(atob(urls[1].searchParams.get('map')!)).searchArea;
  assert.ok(area.latBottom < point.lat && area.latTop > point.lat);
});
