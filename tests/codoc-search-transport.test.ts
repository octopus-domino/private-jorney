import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodocSearchTransport, waitForSearchSlot } from '../src/infrastructure/api/codocSearchTransport';

const SEARCH_URL = 'https://www.codoc.site/api/journeys/routes/places/themed?themes=bars,religious';

test('Android filter replacement waits for the previous server search and preserves the combined query', async () => {
  const delays: number[] = [];
  const controller = new AbortController();
  let requests = 0;
  const http = createCodocSearchTransport(async (url, options) => {
    assert.equal(url, SEARCH_URL);
    assert.equal(options?.signal, controller.signal);
    assert.deepEqual(options?.headers, { Accept: 'application/json' });
    return ++requests < 3 ? new Response('busy', { status: 429 }) : Response.json({ available: true, places: [] });
  }, async delay => { delays.push(delay); });

  const result = await http(SEARCH_URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
  assert.equal(result.status, 200);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test('changing the filter cancels a queued retry before another request is sent', async () => {
  const controller = new AbortController();
  let requests = 0;
  const http = createCodocSearchTransport(async () => {
    requests++;
    return new Response('busy', { status: 429 });
  }, async (delay, signal) => {
    controller.abort();
    await waitForSearchSlot(delay, signal);
  });

  await assert.rejects(http(SEARCH_URL, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('busy searches respect Retry-After and stop retrying within a bounded budget', async () => {
  const delays: number[] = [];
  let requests = 0;
  const http = createCodocSearchTransport(async () => {
    requests++;
    return new Response('busy', { status: 429, headers: { 'Retry-After': '3' } });
  }, async delay => { delays.push(delay); });

  assert.equal((await http(SEARCH_URL)).status, 429);
  assert.equal(requests, 9);
  assert.deepEqual(delays, Array(8).fill(3000));
});

test('external sources, writes and unavailable providers are never retried by the search decorator', async () => {
  for (const [url, method, status] of [
    ['https://www.citywalls.ru/map_around.html', 'GET', 429],
    ['https://api.cian.ru/search-engine/v1/search-offers-mobile-site/', 'POST', 429],
    ['https://www.avito.ru/js/1/map/items', 'GET', 403],
    [SEARCH_URL, 'POST', 429],
    [SEARCH_URL, 'GET', 503],
  ] as const) {
    let requests = 0;
    const http = createCodocSearchTransport(async () => {
      requests++;
      return new Response('unavailable', { status });
    }, async () => { assert.fail('Unrelated requests must not enter the retry queue'); });

    assert.equal((await http(url, { method })).status, status);
    assert.equal(requests, 1);
  }
});
