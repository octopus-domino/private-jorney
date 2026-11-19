import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { walkPreview, recordedWalkPath, hasRecordedMovement } from '../src/domain/walkPreview';
import { MapTileCache } from '../src/infrastructure/persistence/mapTileCache';

const point = { lat: 59.94, lng: 30.27, accuracy: 8, timestamp: 1000 };
const svg = (path: typeof point[]) => new DOMParser().parseFromString(walkPreview(path), 'image/svg+xml');

test('a single or repeated GPS fix is centred and never covered by a separate end marker', () => {
  for (const path of [[point], [point, point]]) {
    const image = svg(path);
    const markers = image.querySelectorAll('circle');
    assert.equal(markers.length, 1);
    assert.equal(markers[0].getAttribute('cx'), '320');
    assert.equal(markers[0].getAttribute('cy'), '180');
    assert.match(image.querySelector('text')?.textContent ?? '', /Перемещение не зафиксировано/);
  }
});

test('horizontal and vertical tracks use the centre of the unconstrained axis', () => {
  const horizontal = svg([point, { ...point, lng: point.lng + .01 }]);
  assert.ok([...horizontal.querySelectorAll('circle')].every(node => node.getAttribute('cy') === '180'));
  const vertical = svg([point, { ...point, lat: point.lat + .01 }]);
  assert.ok([...vertical.querySelectorAll('circle')].every(node => node.getAttribute('cx') === '320'));
});

test('returning to the start retains the complete route and combines its two markers', () => {
  const path = [point, { ...point, lng: point.lng + .002 }, point];
  assert.equal(hasRecordedMovement(path), true);
  const image = svg(path);
  assert.ok(image.querySelector('path'));
  const positions = new Set([...image.querySelectorAll('circle')].map(node => `${node.getAttribute('cx')}:${node.getAttribute('cy')}`));
  assert.equal(positions.size, 1);
});

test('empty map matching falls back to saved GPS, including old archives', () => {
  assert.deepEqual(recordedWalkPath({ points: [point], matchedPath: [] }), [point]);
  assert.deepEqual(recordedWalkPath({ points: [point], matchedPath: [{ lat: 1, lng: 1 }] }), [point]);
});

function cacheStorage() {
  const data = new Map<string, Response>();
  const cache = {
    match: async (key: string) => data.get(key)?.clone(),
    put: async (key: string, value: Response) => { data.set(key, value.clone()); },
    keys: async () => [...data.keys()].map(key => new Request(key)),
    delete: async (key: Request) => data.delete(key.url),
  };
  return { data, storage: { open: async () => cache } as unknown as CacheStorage };
}

test('viewed map tiles are reused across tile subdomains and cache size remains bounded', async () => {
  const { data, storage } = cacheStorage();
  let calls = 0;
  const source = new MapTileCache(async () => { calls++; return new Response('tile', { headers: { 'Content-Type': 'image/png' } }); }, storage);
  await source.read('https://a.tile.openstreetmap.org/17/1/2.png');
  await source.read('https://b.tile.openstreetmap.org/17/1/2.png');
  assert.equal(calls, 1);
  for (let x = 0; x < 100; x++) await source.read(`https://a.tile.openstreetmap.org/17/${x}/3.png`);
  assert.equal(data.size, 96);
});

test('an expired tile remains usable when the phone is offline', async () => {
  const { data, storage } = cacheStorage();
  data.set('https://tile.openstreetmap.org/17/1/2.png', new Response('saved tile', { headers: { 'x-saved-at': '1' } }));
  const source = new MapTileCache(async () => { throw new Error('offline'); }, storage);
  assert.equal(await (await source.read('https://a.tile.openstreetmap.org/17/1/2.png')).text(), 'saved tile');
});
