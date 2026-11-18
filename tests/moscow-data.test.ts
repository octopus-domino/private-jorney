import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MoscowBuildingProfileRepository } from '../src/infrastructure/api/moscowBuildingProfileRepository';
import { MoscowDataClient } from '../src/infrastructure/api/moscowDataClient';
import { matchMoscowAddress, parseMoscowAddresses } from '../src/infrastructure/api/moscowAddressGeometry';
import { moscowAddressKey } from '../src/infrastructure/api/moscowAddressKey';
import { summarizeBuildingProfile } from '../src/application/use-cases/summarizeBuildingProfile';
import type { Poi } from '../src/domain/Poi';
import { CodocAreaPoiRepository } from '../src/infrastructure/api/codocAreaPoiRepository';
import { HttpHistoricalHouseRepository } from '../src/infrastructure/api/httpHistoricalHouseRepository';
import { HttpPlaceRecommendationsRepository } from '../src/infrastructure/api/httpPlaceRecommendationsRepository';
import { MoscowMaintenanceRepository } from '../src/infrastructure/api/moscowMaintenanceRepository';
import { summarizeBuildingMaintenance } from '../src/application/use-cases/summarizeBuildingMaintenance';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));
const house: Poi = { id: 'moscow-house', name: 'Дом', lat: 55.78533905, lng: 37.736673419,
  categoryIds: ['historical-house'], source: 'historical-house', facts: [], details: { address: 'Москва, Борисовская ул., 4' } };
const index = async () => ({ companies: [{ row: 0, name: 'Управляющая компания', unoms: [260138] }],
  addresses: [[260138, 'Борисовская улица, дом 4']] });

test('Moscow uses official building contours without invoking Photon when an address is absent', async () => {
  const geometry = fixture('moscow-address.json');
  const ring = geometry.features[0].geometry.coordinates[0][0];
  const point = { ...house, details: undefined,
    lat: ring.reduce((sum: number, value: number[]) => sum + value[1], 0) / ring.length,
    lng: ring.reduce((sum: number, value: number[]) => sum + value[0], 0) / ring.length };
  const technical = fixture('moscow-building-profile.json');
  technical[0].Cells.MKD[0].UNOM = 4304372;
  const calls: number[] = [];
  const repository = new MoscowBuildingProfileRepository({ get: async dataset => {
    calls.push(dataset); return dataset === 60562 ? geometry : technical;
  } }, { search: async () => [], reverse: async () => { throw new Error('Photon must not be called'); } },
  { get: () => undefined, set: () => {} }, async () => ({ companies: [{ row: 0, name: 'Компания', unoms: [4304372] }] }),
  { lookup: async () => ({ works: [], sourceUrl: 'https://data.mos.ru/opendata/62963', sourceName: 'Источник', fetchedAt: new Date().toISOString() }) });
  const result = await repository.lookup(point);
  assert.equal(result?.address, 'Большая Садовая улица, дом 6, строение 2');
  assert.deepEqual(calls, [60562, 2681]);
});

test('Moscow repairs use pinned official pages, verify both row ID and UNOM and persist only public facts', async () => {
  let calls = 0;
  const repairIndex = async () => ({ version: 2, release: 877, houses: { '24733': [[0, 1136596954]] } });
  const repository = new MoscowMaintenanceRepository({ get: async (dataset, resource, query) => {
    calls++;
    assert.equal(dataset, 62963);
    assert.equal(resource, 'rows');
    assert.equal(query.versionNumber, '2');
    assert.equal(query.releaseNumber, '877');
    assert.equal(query.$skip, '0');
    return fixture('moscow-repairs.json');
  } }, repairIndex);
  const result = await repository.lookup(24733);
  assert.equal(result.works.length, 1);
  assert.equal(result.works[0].status, 'completed');
  assert.equal(result.works[0].actualEnd, '2014-12-03');
  const facts = summarizeBuildingMaintenance(result);
  assert.equal(facts.find(fact => fact.label === 'Вода и канализация')?.value, 'Ремонт завершён в 2014 году');
  assert.ok(!JSON.stringify(result).includes('ContractNumber'));
  assert.ok(!JSON.stringify(result).includes('24747'));
  const offline = new MoscowMaintenanceRepository({ get: async () => { throw new Error('Network forbidden'); } }, repairIndex);
  assert.deepEqual(await offline.lookup(24733), result);
  assert.equal(calls, 1);
});

test('Moscow repair mismatches and temporary failures do not poison a subsequent lookup', async () => {
  let broken = true;
  const repository = new MoscowMaintenanceRepository({ get: async () => broken ? [] : fixture('moscow-repairs.json') },
    async () => ({ version: 2, release: 877, houses: { '24733': [[0, 1136596954]] } }));
  await assert.rejects(repository.lookup(24733), /принадлежность/);
  broken = false;
  assert.equal((await repository.lookup(24733)).works.length, 1);
});

test('Moscow planned repairs remain plans after their date and never imply low wear or completed replacement', () => {
  const facts = summarizeBuildingMaintenance({ sourceUrl: 'https://data.mos.ru/opendata/62963', sourceName: 'Источник', fetchedAt: new Date().toISOString(),
    works: [{ name: 'Ремонт кровли', status: 'planned', plannedEnd: '2020-12-31' },
      { name: 'Ремонт отопления', status: 'cancelled', year: 2023 }] });
  assert.equal(facts.find(fact => fact.label === 'Крыша')?.value, 'Плановый срок прошёл; выполнение не подтверждено');
  assert.equal(facts.some(fact => fact.label === 'Отопление'), false);
  assert.ok(!JSON.stringify(facts).includes('Малый износ'));
});

test('Moscow basic house information survives repair-source failure and retry fills the missing section', async () => {
  let fail = true;
  const maintenance = { lookup: async () => {
    if (fail) throw new Error('source unavailable');
    return { sourceName: 'Капремонт', sourceUrl: 'https://data.mos.ru/opendata/62963', fetchedAt: new Date().toISOString(), works: [] };
  } };
  const repository = new MoscowBuildingProfileRepository({ get: async () => fixture('moscow-building-profile.json') },
    undefined, undefined, index, maintenance);
  const partial = await repository.lookup(house);
  assert.equal(partial?.floors, 16);
  assert.equal(partial?.maintenanceUnavailable, true);
  fail = false;
  const complete = await repository.lookup(house);
  assert.equal(complete?.maintenanceUnavailable, undefined);
  assert.equal(complete?.maintenance?.sourceName, 'Капремонт');
});

test('Moscow house card matches exact address and UNOM, adapts real fields and restores successes without API calls', async () => {
  let calls = 0;
  const client = new MoscowDataClient('test-key', async url => {
    calls++;
    const request = new URL(url);
    assert.equal(request.hostname, 'apidata.mos.ru');
    assert.equal(request.searchParams.get('api_key'), 'test-key');
    assert.equal(request.pathname, '/v1/datasets/2681/rows');
    return JSON.stringify(fixture('moscow-building-profile.json'));
  });
  const repository = new MoscowBuildingProfileRepository(client, undefined, undefined, index);
  const result = await repository.lookup(house);
  assert.equal(result?.yearBuilt, 2015);
  assert.equal(result?.floors, 16);
  assert.equal(result?.sourceName, 'Открытые данные Москвы');
  assert.ok(result && !result.sourceUrl.includes('api_key'));
  const facts = summarizeBuildingProfile(result!);
  assert.ok(facts.some(fact => fact.label === 'Лифты' && fact.value === '4'));
  assert.equal(facts.some(fact => /Жители|Износ|Капремонт/.test(fact.label)), false);
  const offline = new MoscowBuildingProfileRepository({ get: async () => { throw new Error('Network forbidden'); } }, undefined, undefined, index);
  assert.equal((await offline.lookup({ ...house, id: 'another-card' }))?.floors, 16);
  assert.equal(calls, 1);
});

test('Moscow failures are not cached and a deleted or neighbouring UNOM never becomes the selected house', async () => {
  let failing = true, calls = 0;
  const client = { get: async () => {
    calls++;
    if (failing) throw new Error('temporary failure');
    return fixture('moscow-building-profile.json');
  } };
  const repository = new MoscowBuildingProfileRepository(client, undefined, undefined, index);
  await assert.rejects(repository.lookup(house));
  failing = false;
  assert.equal((await repository.lookup(house))?.floors, 16);
  assert.equal(calls, 2);
  const wrong = new MoscowBuildingProfileRepository({ get: async () => [{ Cells: { MKD: [{ UNOM: 999, BuildYear: 2015 }] } }] },
    undefined, { get: () => undefined, set: () => {} }, index);
  await assert.rejects(wrong.lookup(house), /подтвердить выбранный дом/);
});

test('Moscow contour matching ignores land and ambiguous neighbouring buildings', () => {
  const payload = fixture('moscow-address.json');
  const addresses = parseMoscowAddresses(payload);
  const ring = addresses[0].polygons[0][0];
  const point = { lng: ring.reduce((sum, value) => sum + value[0], 0) / ring.length,
    lat: ring.reduce((sum, value) => sum + value[1], 0) / ring.length };
  assert.equal(matchMoscowAddress(point, addresses)?.unom, addresses[0].unom);
  assert.equal(matchMoscowAddress(point, [...addresses, { ...addresses[0], unom: 999 }]), null);
  payload.features[0].properties.attributes.OBJ_TYPE_PUBLIC = 'земельный участок';
  assert.deepEqual(parseMoscowAddresses(payload), []);
  assert.equal(moscowAddressKey('Москва, ул. Борисовская, д. 4'), moscowAddressKey('Борисовская улица, дом 4'));
  assert.notEqual(moscowAddressKey('Борисовская улица, дом 4'), moscowAddressKey('Борисовская улица, дом 4, корпус 2'));
});

test('all discovery categories and both anchors use only codoc.site, with bounded concurrency', async () => {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  let inFlight = 0, peak = 0;
  globalThis.fetch = async request => {
    const url = new URL(String(request)); calls.push(url);
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(done => setTimeout(done, 2)); inFlight--;
    const lng = Number(url.searchParams.get('lon') ?? url.searchParams.get('longitude'));
    const lat = Number(url.searchParams.get('lat') ?? url.searchParams.get('latitude'));
    const body = url.pathname.includes('buildings/nearby') ? [{ id: 731, latitude: lat, longitude: lng, name: 'Дом', address: 'Адрес' }]
      : { available: true, source: 'codoc', places: [{ id: 'shared-place', label: 'Место', latitude: lat, longitude: lng, url: 'https://www.codoc.site/', meta: { themes: url.searchParams.get('themes') ?? '' } }] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const repository = new CodocAreaPoiRepository(new HttpHistoricalHouseRepository('https://www.codoc.site'), new HttpPlaceRecommendationsRepository('https://www.codoc.site'));
    const points = await repository.search({ anchors: [{ lat: 55.801, lng: 37.731 }, { lat: 55.802, lng: 37.732 }], radiusMeters: 300,
      categoryIds: ['historical-house', 'cultural', 'religious', 'bars', 'mystical', 'attractions'] });
    assert.equal(calls.length, 4);
    assert.ok(calls.every(url => url.hostname === 'www.codoc.site'));
    assert.equal(peak, 1);
    assert.equal(calls.filter(url => url.pathname.endsWith('/themed')).length, 2);
    assert.ok(calls.every(url => !url.searchParams.has('maxStops')));
    assert.equal(points.find(point => point.id === 'place:shared-place')?.categoryIds.length, 5);
  } finally { globalThis.fetch = original; }
});

test('bars and religion share one unlimited area request and retain their real categories', async () => {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async request => {
    const url = new URL(String(request)); calls.push(url);
    return new Response(JSON.stringify({ available: true, places: Array.from({ length: 18 }, (_, index) => ({
      id: `batch-${index}`, label: `Place ${index}`, latitude: 59.931, longitude: 30.341,
      meta: { themes: index < 10 ? 'bars' : 'religious' },
    })) }), { status: 200 });
  };
  try {
    const repository = new CodocAreaPoiRepository(new HttpHistoricalHouseRepository('https://www.codoc.site'), new HttpPlaceRecommendationsRepository('https://www.codoc.site'));
    const points = await repository.search({ anchors: [{ lat: 59.931, lng: 30.341 }], radiusMeters: 500, categoryIds: ['bars', 'religious'] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get('themes'), 'bars,religious');
    assert.equal(calls[0].searchParams.has('maxStops'), false);
    assert.equal(points.length, 18);
    assert.equal(points.filter(point => point.categoryIds.includes('bars')).length, 10);
    assert.equal(points.filter(point => point.categoryIds.includes('religious')).length, 8);
  } finally { globalThis.fetch = original; }
});
