import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalkGraph, type RoadWay } from '../src/domain/walkGraph';
import { WalkMapMatcher } from '../src/domain/walkMapMatcher';
import { locateAlongPath, countRevisits, correctTrackJitter } from '../src/domain/pathGeometry';
import { acceptsTrackPoint } from '../src/domain/trackQuality';
import { initialWalk, walkParagraphs } from '../src/domain/walkStory';
import { walkPathSpans, walkSections } from '../src/domain/walkSections';
import { RecordedWalkService } from '../src/application/use-cases/recordedWalkService';
import { RecordedWalkEnricher } from '../src/application/use-cases/enrichRecordedWalk';
import { CodocAreaPoiRepository } from '../src/infrastructure/api/codocAreaPoiRepository';
import { russianAddress, russianCountry } from '../src/shared/russianAddress';
import type { RawWalkSession, RecordedWalk, TrackPoint } from '../src/domain/RecordedWalk';
import type { Poi } from '../src/domain/Poi';
import { NativeWalkRecorder } from '../src/infrastructure/recording/nativeWalkRecorder';
import { AreaSearchSession, type AreaSearchUpdate } from '../src/application/use-cases/areaSearchSession';
import { HttpHistoricalHouseRepository } from '../src/infrastructure/api/httpHistoricalHouseRepository';

const origin = { lat: 59.94, lng: 30.27 };
const fix = (lat: number, lng: number, offset = 0): TrackPoint => ({ lat, lng, accuracy: 8, timestamp: 1000000 + offset });
const corner = { lat: origin.lat, lng: origin.lng + 0.002 };
const north = { lat: origin.lat + 0.001, lng: corner.lng };
const roads: RoadWay[] = [{ id: 1, nodes: [1, 2, 3], geometry: [origin, corner, north] }];
const raw: RawWalkSession = { id: 'walk_test', startedAt: 1000000, endedAt: 1200000, state: 'stopped',
  distanceMeters: 220, pointCount: 3, points: [fix(origin.lat, origin.lng), fix(corner.lat, corner.lng, 90000), fix(north.lat, north.lng, 180000)] };

test('pedestrian graph respects access and foot directions, but ignores vehicle one-way', () => {
  const graph = new WalkGraph([{ ...roads[0], tags: { oneway: 'yes' } }]);
  assert.ok(graph.shortestPath('osm:3', 'osm:1', 300));
  assert.equal(graph.shortestPath('osm:3', 'osm:1', 50), null);
  const directed = new WalkGraph([{ ...roads[0], tags: { 'oneway:foot': 'yes' } }]);
  assert.equal(directed.shortestPath('osm:3', 'osm:1', 300), null);
  assert.equal(new WalkGraph([{ ...roads[0], tags: { access: 'private' } }]).edges.length, 0);
});

test('geometrically crossing bridges remain disconnected when OSM node ids differ', () => {
  const graph = new WalkGraph([...roads, { id: 2, nodes: [4, 5], geometry: [origin, north], tags: { bridge: 'yes' } }]);
  assert.equal(graph.shortestPath('osm:1', 'osm:5', 1000), null);
});

test('Viterbi retains a real return and reconstructs local corners instead of a start/end shortcut', () => {
  const points = [...raw.points!, fix(corner.lat, corner.lng, 270000), fix(origin.lat, origin.lng, 360000)];
  const result = new WalkMapMatcher(new WalkGraph(roads), origin.lat).match(points);
  assert.equal(result.matchedSamples, 5);
  assert.ok(result.path.some(point => Math.abs(point.lat - north.lat) < 0.00001));
  assert.ok(countRevisits(result.path) > 0);
  assert.ok(result.path.length >= points.length);
});

test('Viterbi keeps missing-map GPS observations instead of dropping a whole walk', () => {
  const result = new WalkMapMatcher(new WalkGraph([]), origin.lat).match(raw.points!);
  assert.equal(result.matchedSamples, 0);
  assert.deepEqual(result.path, raw.points!.map(({ lat, lng }) => ({ lat, lng })));
});

test('sequence matching resists one noisy fix near a disconnected parallel street', () => {
  const graph = new WalkGraph([
    { id: 10, nodes: [1, 2], geometry: [origin, corner] },
    { id: 11, nodes: [10, 11], geometry: [{ ...origin, lat: origin.lat + 0.0002 }, { ...corner, lat: corner.lat + 0.0002 }] },
  ]);
  const noisy = { ...fix(origin.lat + 0.00016, origin.lng + 0.001, 60000), accuracy: 20 };
  const matched = new WalkMapMatcher(graph, origin.lat).match([fix(origin.lat, origin.lng), noisy, fix(corner.lat, corner.lng, 120000)]);
  assert.equal(matched.matchedSamples, 3);
  assert.ok(matched.path.every(point => Math.abs(point.lat - origin.lat) < 0.00001));
});

test('alternating sidewalk fixes stay on one side and sustained movement crosses at the mapped crossing', () => {
  const sidewalk = (lat: number) => [0, .001, .002].map(offset => ({ lat, lng: origin.lng + offset }));
  const south = sidewalk(origin.lat), northSide = sidewalk(origin.lat + .00021);
  const graph = new WalkGraph([
    { id: 10, nodes: [1, 2, 3], geometry: south, tags: { footway: 'sidewalk' } },
    { id: 11, nodes: [4, 5, 6], geometry: northSide, tags: { footway: 'sidewalk' } },
    { id: 12, nodes: [2, 5], geometry: [south[1], northSide[1]], tags: { footway: 'crossing' } },
  ]);
  const matcher = new WalkMapMatcher(graph, origin.lat);
  assert.equal(graph.shortestPath('osm:2', 'osm:5', 100, false), null);
  const noisy = [0, 0, .00021, 0, .00021, 0, 0, 0].map((latitude, index) =>
    fix(origin.lat + latitude, origin.lng + index * .00023, index * 13000));
  const noCrossing = matcher.match(noisy).path;
  assert.ok(noCrossing.every(point => Math.abs(point.lat - origin.lat) < 1e-6), JSON.stringify(noCrossing));

  const crossing = [
    fix(origin.lat, origin.lng), fix(origin.lat, origin.lng + .00055, 25000),
    fix(origin.lat, origin.lng + .001, 45000), fix(northSide[1].lat, northSide[1].lng, 65000),
    fix(northSide[1].lat, northSide[1].lng + .0005, 85000), fix(northSide[2].lat, northSide[2].lng, 110000),
  ];
  const path = matcher.match(crossing).path;
  const changes = path.slice(1).flatMap((point, index) => Math.abs(point.lat - path[index].lat) > 1e-6
    ? [[path[index], point]] : []);
  assert.deepEqual(changes, [[south[1], northSide[1]]]);
});

test('isolated inaccurate lateral drift is corrected without changing the stored fix', () => {
  const observations = [0, 0, .00017, 0, 0].map((latitude, index) =>
    ({ ...fix(origin.lat + latitude, origin.lng + index * .00035, index * 10000), accuracy: 23 }));
  const corrected = correctTrackJitter(observations);
  assert.equal(corrected[2].lat, origin.lat);
  assert.equal(observations[2].lat, origin.lat + .00017);
});

test('the timeline uses real graph intersections and shows recording gaps separately', () => {
  const graph = new WalkGraph([
    { id: 21, nodes: [11, 12], geometry: [origin, corner], tags: { name: 'Первая улица' } },
    { id: 22, nodes: [12, 13], geometry: [corner, north], tags: { name: 'Вторая улица' } },
  ]);
  const matcher = new WalkMapMatcher(graph, origin.lat);
  const matched = matcher.match(raw.points!);
  const sections = walkSections(matched.path, matched.steps);
  assert.deepEqual(sections.map(section => [section.from, section.to, section.street]), [
    ['Место выхода', 'Первая улица × Вторая улица', 'Первая улица'],
    ['Первая улица × Вторая улица', 'Финиш', 'Вторая улица'],
  ]);
  const sparse = [raw.points![0], raw.points![1], { ...raw.points![2], timestamp: raw.points![1].timestamp + 140000 }];
  const gap = matcher.match(sparse);
  const gapSections = walkSections(gap.path, gap.steps);
  assert.equal(gapSections.at(-1)?.gpsGap, true);
  assert.equal(gapSections.at(-1)?.street, undefined);
  assert.deepEqual(walkPathSpans(gap.path, gapSections).map(span => span.gap), [false, true]);
});

test('the incomplete report is committed while graph and discovery requests are still pending', async () => {
  let finish!: (roads: RoadWay[]) => void;
  const routeData = new Promise<RoadWay[]>(resolve => { finish = resolve; });
  const place: Poi = { ...origin, id: 'early-house', name: 'Первый дом', source: 'historical-house', categoryIds: ['historical-house'], facts: [] };
  const saved: RecordedWalk[] = [];
  const service = new RecordedWalkEnricher({ roads: async () => routeData }, { search: async params => {
    params.onPartial?.([place]); return [place];
  } }, { supports: () => false, lookup: async () => null }, { search: async () => [], reverse: async () => ({ label: 'Адрес' }) });
  const result = service.enrich(initialWalk(raw), [], async value => { saved.push(value); });
  await new Promise(done => setImmediate(done));
  assert.ok(saved[0].sections?.length);
  assert.equal(saved[0].places.length, 0);
  assert.ok(saved.some(value => value.places[0]?.poi.id === place.id));
  finish(roads);
  assert.equal((await result).status, 'ready');
});

test('houses are ordered along the path and left/right changes with walking direction', () => {
  const house = { lat: origin.lat + 0.00015, lng: origin.lng + 0.001 };
  assert.equal(locateAlongPath(house, [origin, corner])?.side, 'left');
  assert.equal(locateAlongPath(house, [corner, origin])?.side, 'right');
  assert.ok(locateAlongPath(house, [origin, corner])!.progress > 40);
});

test('GPS policy rejects stale, low-accuracy, stationary, reordered and teleport fixes', () => {
  const first = fix(origin.lat, origin.lng);
  assert.equal(acceptsTrackPoint(first, undefined, first.timestamp), true);
  assert.equal(acceptsTrackPoint({ ...first, accuracy: 60 }, undefined, first.timestamp), false);
  assert.equal(acceptsTrackPoint(first, undefined, first.timestamp + 61000), false);
  assert.equal(acceptsTrackPoint({ ...first, timestamp: first.timestamp + 12000 }, first, first.timestamp + 12000), false);
  const moved = fix(origin.lat + 0.00015, origin.lng, 12000);
  assert.equal(acceptsTrackPoint(moved, first, moved.timestamp), true);
  assert.equal(acceptsTrackPoint({ ...moved, lat: origin.lat + 0.1 }, first, moved.timestamp), false);
  assert.equal(acceptsTrackPoint(first, moved, moved.timestamp), false);
});

test('Android start primes exactly one precise map position without a second ongoing GPS watcher', async () => {
  const actions: string[] = [];
  let seeded: TrackPoint | undefined;
  const bridge = { start: async () => { actions.push('service'); }, stop: async () => {},
    status: async () => ({ active: true, session: raw }), list: async () => ({ sessions: [] }), read: async () => raw,
    remove: async () => {}, seed: async (point: TrackPoint) => { seeded = point; actions.push('seed'); } };
  const geolocation = { getCurrentPosition(success: PositionCallback, _error?: PositionErrorCallback, options?: PositionOptions) {
    actions.push('one-shot'); assert.equal(options?.enableHighAccuracy, true);
    success({ coords: { latitude: origin.lat, longitude: origin.lng, accuracy: 8 }, timestamp: 1000000 } as GeolocationPosition);
  }, watchPosition() { throw new Error('A second watcher would waste battery'); }, clearWatch() {} };
  await new NativeWalkRecorder(bridge, () => geolocation).start();
  assert.deepEqual(actions, ['service', 'one-shot', 'seed']);
  assert.equal(seeded?.lat, origin.lat);
});

test('raw recording and preview are saved before optional enrichment and survive offline errors', async () => {
  const saved = new Map<string, RecordedWalk>();
  let active = true, enrichCalls = 0;
  const recorder = { backgroundCapable: true, start: async () => {}, stop: async () => { active = false; },
    status: async () => ({ active, session: active ? raw : null }), list: async () => [raw], read: async () => raw, remove: async () => {} };
  const archive = { list: async () => [...saved.values()], get: async (id: string) => saved.get(id) ?? null,
    save: async (walk: RecordedWalk) => { saved.set(walk.id, structuredClone(walk)); }, remove: async (id: string) => { saved.delete(id); } };
  const enrichment = { enrich: async () => { enrichCalls++; throw new Error('offline'); } };
  const service = new RecordedWalkService(recorder, archive, enrichment as unknown as RecordedWalkEnricher);
  await service.stop();
  assert.equal(enrichCalls, 0);
  assert.deepEqual(saved.get(raw.id)?.points, raw.points);
  assert.match(saved.get(raw.id)!.previewSvg, /<svg/);
  await assert.rejects(service.enrich(raw.id, [], () => {}));
  assert.equal(saved.get(raw.id)?.points.length, 3);
});

test('recovery imports only interrupted/stopped journals and does not overwrite existing reports', async () => {
  const saved = new Map<string, RecordedWalk>();
  const interrupted = { ...raw, state: 'recording' as const };
  const recorder = { backgroundCapable: true, start: async () => {}, stop: async () => {}, status: async () => ({ active: false, session: null }),
    list: async () => [interrupted], read: async () => interrupted, remove: async () => {} };
  const archive = { list: async () => [...saved.values()], get: async (id: string) => saved.get(id) ?? null,
    save: async (walk: RecordedWalk) => { saved.set(walk.id, walk); }, remove: async () => {} };
  const service = new RecordedWalkService(recorder, archive, {} as RecordedWalkEnricher);
  await service.recover();
  assert.equal(saved.get(raw.id)?.interrupted, true);
  saved.get(raw.id)!.title = 'Мой рассказ';
  await service.recover();
  assert.equal(saved.get(raw.id)?.title, 'Мой рассказ');
});

test('recording enrichment preserves original GPS, factual history and offline preview', async () => {
  const place: Poi = { id: 'house', name: 'Дом у поворота', lat: origin.lat + 0.00015, lng: origin.lng + 0.001,
    categoryIds: ['historical-house'], source: 'historical-house', facts: [] };
  const enricher = new RecordedWalkEnricher({ roads: async () => roads }, { search: async () => [place] },
    { supports: () => true, lookup: async () => ({ excerpt: 'Дом построен архитектором по опубликованному проекту.', sourceUrl: 'https://example.com/house' }) },
    { search: async () => [], reverse: async () => ({ label: 'Адрес', city: 'Санкт-Петербург' }) });
  const result = await enricher.enrich(initialWalk(raw), [], async () => {});
  assert.deepEqual(result.points, raw.points);
  assert.equal(result.places[0]?.side, 'left');
  assert.match(result.paragraphs.join(' '), /Дом построен архитектором/);
  assert.match(result.title, /Санкт-Петербург/);
  assert.match(result.previewSvg, /stroke="#317559"/);
  assert.equal(result.graph?.matchedSamples, 3);
});

test('a recording retains successful codoc houses when another discovery category fails', async () => {
  const place: Poi = { id: 'partial-house', name: 'Дом', lat: 59.9401, lng: 30.2703,
    source: 'historical-house', categoryIds: ['historical-house'], facts: ['Подтверждённый факт'] };
  const enricher = new RecordedWalkEnricher({ roads: async () => [] }, { search: async params => {
    params.onPartial?.([place]); throw new Error('Another category unavailable');
  } }, { supports: () => false, lookup: async () => null }, { search: async () => [], reverse: async () => ({ label: 'Адрес' }) });
  const result = await enricher.enrich(initialWalk(raw), [], async () => {});
  assert.equal(result.places[0]?.poi.id, place.id);
  assert.equal(result.status, 'partial');
});

test('story omits zero distance and duration and never invents historical facts', () => {
  const walk = initialWalk({ ...raw, distanceMeters: 0, endedAt: raw.startedAt, points: [] });
  const story = walkParagraphs(walk).join(' ');
  assert.doesNotMatch(story, /\b0 (м|мин)/);
  assert.match(story, /Сведения о местах можно дополнить/);
});

test('area discovery searches both anchors and deduplicates overlapping house results', async () => {
  const seen: number[] = [];
  const repository = new CodocAreaPoiRepository({ byPoint: async () => null, nearby: async point => {
    seen.push(point.lon);
    return [{ id: 42, latitude: point.lat, longitude: point.lon, address: null, name: 'Дом', osmId: null, constructionYear: null,
      constructionPeriod: null, architect: null, style: null, heritageStatus: null, source: 'codoc', sourceUrl: null }];
  } }, { search: async () => ({ available: true, places: [], source: 'codoc' }), themes: async () => [] });
  const points = await repository.search({ anchors: [origin, corner], radiusMeters: 300, categoryIds: ['historical-house'] });
  assert.deepEqual(seen, [origin.lng, corner.lng]);
  assert.equal(points.length, 1);
});

test('city and country labels remain Russian even when Photon returns English names', () => {
  assert.equal(russianAddress('Moscow, Russia'), 'Москва, Россия');
  assert.equal(russianAddress('Saint Petersburg, Russia'), 'Санкт-Петербург, Россия');
  assert.equal(russianCountry('Russia', 'RU'), 'Россия');
});

test('filter sessions clear stale points immediately, time out and ignore late obsolete responses', async () => {
  const updates: AreaSearchUpdate[] = [];
  let resolve!: (points: Poi[]) => void;
  const pending = new Promise<Poi[]>(done => { resolve = done; });
  const params = { anchors: [origin], radiusMeters: 300, categoryIds: ['historical-house'] };
  new AreaSearchSession({ search: () => pending }, params, update => updates.push(update), 15).start();
  assert.deepEqual(updates[0], { points: [], status: 'loading' });
  await new Promise(done => setTimeout(done, 25));
  assert.equal(updates.at(-1)?.status, 'error');
  resolve([{ ...origin, id: 'old', name: 'Old', categoryIds: ['historical-house'], source: 'overpass', facts: [] }]);
  await Promise.resolve();
  assert.equal(updates.length, 2);
});

test('filter timeout retains fresh partial data and cancellation never publishes old-filter points', async () => {
  const fresh: Poi = { ...origin, id: 'fresh', name: 'New', categoryIds: ['bars'], source: 'overpass', facts: [] };
  const updates: AreaSearchUpdate[] = [];
  let signal: AbortSignal | undefined;
  const repository = { search: async (params: import('../src/application/ports/PoiRepository').PoiSearchParams) => {
    signal = params.signal; params.onPartial?.([fresh]); return new Promise<Poi[]>(() => {});
  } };
  new AreaSearchSession(repository, { anchors: [origin], radiusMeters: 100, categoryIds: ['bars'] }, update => updates.push(update), 15).start();
  await new Promise(done => setTimeout(done, 25));
  assert.equal(updates.at(-1)?.status, 'ready');
  assert.equal(updates.at(-1)?.points[0].id, 'fresh');
  assert.equal(signal?.aborted, true);
  const cancel = new AreaSearchSession(repository, { anchors: [origin], radiusMeters: 100, categoryIds: ['bars'] }, update => updates.push(update), 15).start();
  cancel(); const count = updates.length;
  await new Promise(done => setTimeout(done, 25));
  assert.equal(updates.length, count);
});

test('a legitimate cold codoc response after twenty seconds is not aborted', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const updates: AreaSearchUpdate[] = [];
  let resolve!: (points: Poi[]) => void, signal: AbortSignal | undefined;
  const pending = new Promise<Poi[]>(done => { resolve = done; });
  const stop = new AreaSearchSession({ search: params => { signal = params.signal; return pending; } },
    { anchors: [origin], radiusMeters: 300, categoryIds: ['historical-house'] }, update => updates.push(update)).start();
  context.mock.timers.tick(25000);
  assert.equal(signal?.aborted, false);
  assert.equal(updates.at(-1)?.status, 'loading');
  resolve([{ ...origin, id: 'cold-house', name: 'Дом', source: 'historical-house', categoryIds: ['historical-house'], facts: [] }]);
  await new Promise(done => setImmediate(done));
  assert.equal(updates.at(-1)?.status, 'ready');
  assert.equal(updates.at(-1)?.points[0].id, 'cold-house');
  stop();
});

test('recording discovery also waits for a legitimate cold codoc answer instead of aborting at eighteen seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let firstSignal: AbortSignal | undefined, resolve!: (points: Poi[]) => void, calls = 0;
  const pending = new Promise<Poi[]>(done => { resolve = done; });
  const point: Poi = { ...origin, id: 'cold-record-house', name: 'Дом', source: 'historical-house', categoryIds: ['historical-house'], facts: [] };
  const service = new RecordedWalkEnricher({ roads: async () => [] }, { search: params => {
    if (++calls > 1) return Promise.resolve([point]);
    firstSignal = params.signal; return pending;
  } }, { supports: () => false, lookup: async () => null }, { search: async () => [], reverse: async () => ({ label: 'Адрес' }) });
  const result = service.enrich(initialWalk(raw), [], async () => {});
  await new Promise(done => setImmediate(done));
  assert.ok(firstSignal);
  context.mock.timers.tick(25000);
  assert.equal(firstSignal.aborted, false);
  resolve([point]);
  assert.equal((await result).places[0]?.poi.id, point.id);
});

test('discovery restores the exact house request and fetch transport from working APK 1.0.2', async () => {
  const original = globalThis.fetch;
  let captured: { url: string; options?: RequestInit } | undefined;
  globalThis.fetch = async (request, options) => {
    captured = { url: String(request), options };
    return new Response(JSON.stringify([{ id: 991223, latitude: 59.96321, longitude: 30.34621, name: 'Дом' }]));
  };
  try {
    const repository = new CodocAreaPoiRepository(new HttpHistoricalHouseRepository('https://www.codoc.site'),
      { search: async () => ({ available: true, source: 'codoc', places: [] }), themes: async () => [] });
    const points = await repository.search({ anchors: [{ lat: 59.96321, lng: 30.34621 }], radiusMeters: 800, categoryIds: ['historical-house'] });
    assert.equal(captured?.url, 'https://www.codoc.site/api/journeys/buildings/nearby?lon=30.34621&lat=59.96321&limit=200&radiusKm=1&beforeYear=0');
    assert.equal(new Headers(captured?.options?.headers).get('Accept'), 'application/json');
    assert.equal(points[0]?.name, 'Дом');
  } finally { globalThis.fetch = original; }
});
