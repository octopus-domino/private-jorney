import { readFileSync } from 'node:fs';
import { MoscowDataClient } from '../src/infrastructure/api/moscowDataClient';
import { MoscowBuildingProfileRepository } from '../src/infrastructure/api/moscowBuildingProfileRepository';

const key = readFileSync('.env.local', 'utf8').split(/\r?\n/).find(line => line.startsWith('VITE_MOS_DATA_API_KEY='))?.split('=')[1];
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 25000);
const client = new MoscowDataClient(key ?? '', async (url, signal) => {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Source status ${response.status}`);
  return response.text();
});
try {
  const profile = await new MoscowBuildingProfileRepository(client).lookup({ id: 'official-api-smoke', name: 'Дом',
    lat: 55.78533905, lng: 37.736673419, source: 'manual', categoryIds: [], facts: [],
    details: { address: 'Москва, Борисовская улица, 4' } }, controller.signal);
  if (!profile) throw new Error('House not matched');
  console.log(JSON.stringify({ address: profile.address, floors: profile.floors, yearBuilt: profile.yearBuilt, source: profile.sourceName }));
} catch (error) {
  console.error('Official Moscow API smoke check failed:', error instanceof Error ? error.name : 'unknown');
  process.exitCode = 1;
} finally { clearTimeout(timer); }
