import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchBuildingFootprint, resolveBuildingFootprint, type BuildingFootprint } from '../src/domain/BuildingFootprint';
import { parseOsmBuildingFootprints } from '../src/infrastructure/api/parseOsmBuildingFootprints';
import { OsmBuildingFootprints } from '../src/infrastructure/api/osmBuildingFootprints';
import { GorodHouseLocator } from '../src/infrastructure/api/gorodHouseLocator';
import { GorodBuildingProfileRepository } from '../src/infrastructure/api/gorodBuildingProfileRepository';
import type { Poi } from '../src/domain/Poi';

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');
const west = { lat: 59.858, lng: 30.3859 }, middle = { lat: 59.85835, lng: 30.3874 }, east = { lat: 59.85865, lng: 30.3888 };
const annex = { lat: 59.85865, lng: 30.38668 };
const poi = (point: typeof west): Poi => ({ ...point, id: `${point.lat}:${point.lng}`, name: 'Дом', categoryIds: [], source: 'manual', facts: [] });
const portalRows = [
  { data: 28583, main_address: 'г.Санкт-Петербург, проспект Славы, дом 30, корпус 1, литера Б', lat: 59.8586027, lon: 30.3866717 },
  { data: 44858, main_address: 'г.Санкт-Петербург, проспект Славы, дом 30, корпус 1, литера А', lat: 59.8581297, lon: 30.3865258 },
];

test('real long Slavy 30k1 footprint identifies all wings and keeps service building B separate', () => {
  const footprints = parseOsmBuildingFootprints(fixture('osm-slavy-30.xml'));
  assert.equal(footprints.length, 2);
  for (const point of [west, middle, east]) assert.equal(matchBuildingFootprint(point, footprints)?.id, 'way:23201879');
  assert.equal(matchBuildingFootprint(annex, footprints)?.id, 'way:540182528');
});

test('concave houses, courtyards and overlapping outlines are not treated as filled bounding boxes', () => {
  const ring = (points: number[][]) => points.map(([lng, lat]) => ({ lat, lng }));
  const bent: BuildingFootprint = { id: 'L', address: 'Г-образный дом', polygons: [[ring([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]])]] };
  assert.equal(matchBuildingFootprint({ lat: 3, lng: 3 }, [bent]), null);
  assert.equal(matchBuildingFootprint({ lat: 3, lng: 0.5 }, [bent])?.id, 'L');
  const courtyard: BuildingFootprint = { id: 'yard', address: 'Двор', polygons: [[ring([[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]), ring([[1, 1], [4, 1], [4, 4], [1, 4], [1, 1]])]] };
  assert.deepEqual(resolveBuildingFootprint({ lat: 2, lng: 2 }, [courtyard]), { building: null, excluded: true });
  assert.equal(resolveBuildingFootprint({ lat: 0.5, lng: 0.5 }, [courtyard, { ...courtyard, id: 'overlap' }]).excluded, true);
});

test('multipolygon assembles reversed fragments, multiple outer shells and courtyard holes', () => {
  const xml = `<osm>
    <node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="5"/><node id="3" lat="5" lon="5"/><node id="4" lat="5" lon="0"/>
    <node id="5" lat="1" lon="1"/><node id="6" lat="1" lon="4"/><node id="7" lat="4" lon="4"/><node id="8" lat="4" lon="1"/>
    <node id="9" lat="7" lon="0"/><node id="10" lat="7" lon="2"/><node id="11" lat="9" lon="2"/><node id="12" lat="9" lon="0"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/></way>
    <way id="11"><nd ref="1"/><nd ref="4"/><nd ref="3"/></way>
    <way id="12"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/></way>
    <way id="13"><nd ref="9"/><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="9"/></way>
    <relation id="100"><member type="way" ref="10" role="outer"/><member type="way" ref="11" role="outer"/>
    <member type="way" ref="12" role="inner"/><member type="way" ref="13" role="outer"/>
    <tag k="type" v="multipolygon"/><tag k="building" v="apartments"/><tag k="addr:street" v="Улица"/><tag k="addr:housenumber" v="1"/></relation></osm>`;
  const buildings = parseOsmBuildingFootprints(xml);
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].polygons.length, 2);
  assert.equal(matchBuildingFootprint({ lat: 2, lng: 2 }, buildings), null);
  assert.equal(matchBuildingFootprint({ lat: 0.5, lng: 0.5 }, buildings)?.id, 'relation:100');
  assert.equal(matchBuildingFootprint({ lat: 8, lng: 1 }, buildings)?.id, 'relation:100');
  assert.deepEqual(parseOsmBuildingFootprints(xml.replace('ref="12" role="inner"', 'ref="999" role="inner"')), []);
});

test('long house ID is selected by confirmed outline and full address instead of a 60 metre centroid limit', async () => {
  const footprints = parseOsmBuildingFootprints(fixture('osm-slavy-30.xml'));
  let searches = 0;
  const locator = new GorodHouseLocator({ search: async () => [], reverse: async () => { throw new Error('Unexpected Photon'); } },
    async url => { searches++; assert.ok(url.includes('/search/ajax/')); return JSON.stringify(portalRows); },
    { lookup: async point => resolveBuildingFootprint(point, footprints) });
  for (const point of [west, middle, east]) assert.equal((await locator.find(poi(point)))?.id, 44858);
  assert.equal((await locator.find(poi(annex)))?.id, 28583);
  assert.equal(searches, 2);
});

test('outline cache serves distant parts of the same long building without further map downloads', async () => {
  let calls = 0;
  const repository = new OsmBuildingFootprints(async url => {
    calls++; assert.equal(new URL(url).pathname, '/api/0.6/map'); return fixture('osm-slavy-30.xml');
  });
  assert.equal((await repository.lookup(west)).building?.id, 'way:23201879');
  assert.equal((await repository.lookup(east)).building?.id, 'way:23201879');
  assert.equal(calls, 1);
  const offline = new OsmBuildingFootprints(async () => { throw new Error('Network forbidden'); });
  assert.equal((await offline.lookup(middle)).building?.id, 'way:23201879');
});

test('official reference point in a courtyard identifies the building but an actual click in the courtyard does not', async () => {
  const ring = (coordinates: number[][]) => coordinates.map(([lng, lat]) => ({ lat, lng }));
  const building: BuildingFootprint = { id: 'courtyard', address: 'Тестовая улица, 1', polygons: [[
    ring([[30.27, 59.94], [30.274, 59.94], [30.274, 59.944], [30.27, 59.944], [30.27, 59.94]]),
    ring([[30.271, 59.941], [30.273, 59.941], [30.273, 59.943], [30.271, 59.943], [30.271, 59.941]]),
  ]] };
  const locator = new GorodHouseLocator({ search: async () => [], reverse: async () => { throw new Error('Unexpected Photon'); } },
    async () => JSON.stringify([{ data: 123, main_address: 'Тестовая улица, дом 1, литера А', lat: 59.942, lon: 30.272 }]),
    { lookup: async point => resolveBuildingFootprint(point, [building]) });
  assert.equal((await locator.find(poi({ lat: 59.9405, lng: 30.2705 })))?.id, 123);
  assert.equal(await locator.find(poi({ lat: 59.942, lng: 30.272 })), null);
});

test('passport is shared by official facility ID across clicks at opposite ends of a long house', async () => {
  let reads = 0;
  const repository = new GorodBuildingProfileRepository({ search: async () => [], reverse: async () => { throw new Error('Unexpected Photon'); } }, async url => {
    if (new URL(url).hostname === 'api.openstreetmap.org') return fixture('osm-slavy-30.xml');
    if (url.includes('/search/ajax/')) return JSON.stringify(portalRows);
    if (url.includes('/programs/')) return fixture('gorod-programs.html');
    reads++; return fixture('gorod-36556.html');
  });
  const a = await repository.lookup(poi(west)), b = await repository.lookup(poi(east));
  assert.equal(a?.sourceUrl, 'https://gorod.gov.spb.ru/facilities/44858/info/');
  assert.deepEqual(b, a);
  assert.equal(reads, 1);
});
