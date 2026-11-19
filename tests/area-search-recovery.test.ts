import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AreaSearchSession, type AreaSearchUpdate } from '../src/application/use-cases/areaSearchSession';
import { SharedRequestPool } from '../src/shared/sharedRequestPool';
import type { Poi } from '../src/domain/Poi';

test('failed refresh retains only points matching the current Petersburg area and filters', async () => {
  const point: Poi = { id: 'bar', name: 'Bar', lat: 59.93155, lng: 30.3053, source: 'overpass', categoryIds: ['bars'], facts: [] };
  const updates: AreaSearchUpdate[] = [];
  const session = new AreaSearchSession({ search: async () => { throw new Error('503'); } },
    { anchors: [point], radiusMeters: 800, categoryIds: ['bars'] }, update => updates.push(update), 1000,
    [point, { ...point, id: 'museum', categoryIds: ['museum'] }, { ...point, id: 'far', lat: 59.99 }]);
  const stop = session.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  stop();
  assert.deepEqual(updates[0].points.map(item => item.id), ['bar']);
  assert.deepEqual(updates.at(-1)?.points.map(item => item.id), ['bar']);
  assert.equal(updates.at(-1)?.error, '503');
});

test('reopening an area joins its pending read instead of cancelling and resending it', async () => {
  const pool = new SharedRequestPool<number>(100);
  const first = new AbortController();
  let calls = 0;
  let finish!: (value: number) => void;
  const loader = async (signal: AbortSignal) => {
    calls++;
    const value = await new Promise<number>(resolve => { finish = resolve; });
    assert.equal(signal.aborted, false);
    return value;
  };
  const one = pool.run('spb-bars', loader, first.signal);
  const cancelled = assert.rejects(one, { name: 'AbortError' });
  await Promise.resolve();
  first.abort();
  const two = pool.run('spb-bars', loader);
  finish(41);
  await cancelled;
  assert.equal(await two, 41);
  assert.equal(calls, 1);
});
