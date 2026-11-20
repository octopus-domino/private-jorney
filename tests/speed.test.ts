import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { TrackPoint } from '../src/domain/RecordedWalk';
import { walkSpeedSpans } from '../src/domain/walkSpeed';

function fix(metres: number, seconds: number, accuracy = 5): TrackPoint {
  return { lat: 59 + metres / 111195, lng: 30, timestamp: seconds * 1000, accuracy };
}

test('speed map groups adjacent equal speeds using the saved observation time', () => {
  const points = [fix(0, 0), fix(15, 15), fix(30, 30), fix(57, 45)];
  const spans = walkSpeedSpans(points);
  assert.deepEqual(spans.map(span => span.band), ['easy', 'fast']);
  assert.deepEqual(spans[0].points, points.slice(0, 3));
  assert.deepEqual(spans[1].points, points.slice(2));
});

test('speed map leaves long gaps, implausible jumps and low-quality fixes unclassified', () => {
  const points = [fix(0, 0), fix(15, 15), fix(30, 90), fix(300, 100),
    fix(308, 110, 60), fix(328, 130)];
  const spans = walkSpeedSpans(points);
  assert.deepEqual(spans.map(span => span.band), ['easy', 'unknown']);
  assert.deepEqual(spans[1].points, points.slice(1));
  assert.equal(walkSpeedSpans([fix(0, 0), fix(2, 5)])[0].band, 'unknown');
  assert.deepEqual(walkSpeedSpans(points.slice(0, 1)), []);
});
