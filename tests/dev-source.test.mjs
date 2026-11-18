import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { HistorySourceGateway } from '../dev/historyProxy.mjs';

class Response extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writeHead(status) { this.status = status; return this; }
  end(body) { this.body = body; this.writableEnded = true; this.emit('close'); return this; }
  abandon() { this.destroyed = true; this.emit('close'); }
}

function harness() {
  const jobs = [];
  const gateway = new HistorySourceGateway((_command, argumentsList, _options, complete) => {
    const job = { complete, killed: false, argumentsList, body: '' };
    jobs.push(job);
    return { stdin: { end: body => { job.body = body; } }, kill: () => { job.killed = true; complete(new Error('Cancelled'), ''); } };
  });
  const read = (url) => {
    const response = new Response();
    gateway.handle({ method: 'GET', url: `/history-source?url=${encodeURIComponent(url)}` }, response, () => {});
    return response;
  };
  return { jobs, read, gateway };
}

test('cancelled local-browser requests release process slots and do not poison the next house', () => {
  const { read, jobs } = harness();
  const url = 'https://www.citywalls.ru/house1709.html';
  const first = read(url), second = read(url);
  first.abandon();
  assert.equal(jobs[0].killed, false);
  second.abandon();
  assert.equal(jobs[0].killed, true);
  const next = read(url);
  jobs[1].complete(null, 'history');
  assert.equal(next.status, 200);
});

test('real-estate providers are never served from the dev proxy cache', () => {
  for (const host of ['www.avito.ru', 'api.cian.ru']) {
    const { read, jobs } = harness();
    const url = `https://${host}/items`;
    read(url); jobs[0].complete(null, 'first');
    const second = read(url); jobs[1].complete(null, 'fresh');
    assert.equal(second.body, 'fresh');
    assert.equal(jobs.length, 2);
  }
});

test('CIAN POST body reaches the local helper, remains uncached and preserves source restrictions', async () => {
  const { jobs, gateway } = harness();
  const source = 'https://api.cian.ru/search-engine/v1/search-offers-mobile-site/';
  const body = JSON.stringify({ subdomain: 'www', path: '/v1/get-results-for-map?region=2' });
  const request = Object.assign(Readable.from([body]), { method: 'POST', url: `/history-source?url=${encodeURIComponent(source)}` });
  const response = new Response();
  gateway.handle(request, response, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs[0].argumentsList.at(-1), 'POST');
  assert.equal(jobs[0].body, body);
  jobs[0].complete(Object.assign(new Error('Restricted'), { code: 43 }), '');
  assert.equal(response.status, 403);
});
