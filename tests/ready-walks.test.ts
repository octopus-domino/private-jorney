import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyWalks, createReadyWalk } from '../src/application/use-cases/openReadyWalk';
import { exportSharedWalk } from '../src/application/use-cases/exportSharedWalk';

test('all three CoDoc presets retain ordered points, stories and source links in editable private drafts', () => {
  assert.equal(readyWalks.length, 3);
  for (const preset of readyWalks) {
    const draft = createReadyWalk(preset.id)!;
    assert.equal(draft.city, 'Санкт-Петербург');
    assert.equal(draft.savedPois?.length, 4);
    assert.deepEqual(draft.selectedPoiIds, preset.places.map(point => point.id));
    assert.ok(draft.savedPois?.every(point => point.summary && point.details?.sourceUrl?.startsWith('https://ru.wikipedia.org/')));
    assert.notEqual(draft.id, createReadyWalk(preset.id)?.id);
  }
  assert.equal(createReadyWalk('unknown'), null);
});

test('private walk sharing preserves per-leg road geometry for CoDoc import', () => {
  const draft = createReadyWalk('imperial')!;
  const route = { geometry: [[59.9, 30.3], [59.91, 30.31]] as [number, number][], legs: [], totalDistanceMeters: 900, totalDurationSeconds: 600 };
  assert.deepEqual(exportSharedWalk(draft, draft.savedPois!, route).route?.legs, route.legs);
});
