import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { CitywallsLocalIndex } from '../src/infrastructure/api/citywallsLocalIndex';
import { CitywallsIndexStore } from '../src/infrastructure/persistence/citywallsIndexStore';
import { IndexedCitywallsHistoryRepository } from '../src/infrastructure/api/indexedCitywallsHistoryRepository';
import { CitywallsHistoryRepository } from '../src/infrastructure/api/citywallsHistoryRepository';
import { resolveBuildingFootprint, type BuildingFootprint } from '../src/domain/BuildingFootprint';
import { gpsMode, GPS_MODES } from '../src/domain/GpsMode';

test('bundled Citywalls ID is stable across distant wings and reads only the direct house page once', async () => {
  Object.assign(globalThis, { DOMParser });
  const building: BuildingFootprint = { id: 'long', address: '', polygons: [[[
    { lat: 59.94, lng: 30.27 }, { lat: 59.94, lng: 30.274 },
    { lat: 59.941, lng: 30.274 }, { lat: 59.941, lng: 30.27 }, { lat: 59.94, lng: 30.27 },
  ]]] };
  const urls: string[] = [];
  const index = new CitywallsLocalIndex(async () => [[36080, 59.9405, 30.2705]]);
  const history = new CitywallsHistoryRepository(async url => {
    urls.push(url);
    return '<div class="mceContentBody"><p>' + 'История старого дома и его архитектурные детали. '.repeat(4) + '</p></div>';
  });
  const repository = new IndexedCitywallsHistoryRepository(index, history,
    { lookup: async point => resolveBuildingFootprint(point, [building]) });
  for (const lng of [30.2702, 30.2738]) {
    const result = await repository.lookup({ id: String(lng), lat: 59.9405, lng, name: 'Дом', source: 'manual', categoryIds: [], facts: [] });
    assert.equal(result?.sourceUrl, 'https://www.citywalls.ru/house36080.html');
  }
  assert.deepEqual(urls, ['https://www.citywalls.ru/house36080.html']);
});

test('failed daily update keeps bundled catalogue and is not retried until the next day, including after restart', async () => {
  const store = new CitywallsIndexStore();
  let now = 100000000, calls = 0;
  const read = async () => { calls++; throw new Error('offline'); };
  const create = () => new CitywallsLocalIndex(async () => [[1, 59.94, 30.27]], store, read, () => now);
  const first = create();
  await assert.rejects(first.refresh(55));
  await Promise.all([first.refresh(55), create().refresh(56)]);
  assert.equal(calls, 1);
  assert.equal((await first.points())[0].id, 1);
  now += 86400000;
  await assert.rejects(create().refresh(55));
  assert.equal(calls, 2);
});

test('validated daily updates overlay IDs while preserving the shipped offline catalogue', async () => {
  const store = new CitywallsIndexStore();
  const index = new CitywallsLocalIndex(async () => [[1, 59.94, 30.27]], store, async url =>
    url.includes('map_around') ? "SID: 's=abc123'" : JSON.stringify({ result: 'ok', geodata: { features: [{ geometry: {
      geometries: [{ type: 'Point', id: 2, coordinates: [30.28, 59.95] }],
    } }] } }), () => 100000000);
  await index.refresh(55);
  assert.deepEqual((await index.points()).map(point => point.id), [1, 2]);
});

test('GPS profiles keep battery and accuracy choices explicit', () => {
  assert.equal(gpsMode('unknown'), 'balanced');
  assert.ok(GPS_MODES.economy.intervalMs > GPS_MODES.precise.intervalMs);
  assert.ok(GPS_MODES.economy.maxAccuracy > GPS_MODES.precise.maxAccuracy);
});
