import { test, expect } from '@playwright/test';

test('Petersburg route does not restart discovery; failed larger-area refresh retains matching points and can retry', async ({ page }) => {
  const requests: string[] = [];
  let fail = false;
  await page.route('**/api/journeys/routes/places/themed?**', async route => {
    requests.push(route.request().url());
    if (fail) return route.fulfill({ status: 503, json: { error: 'journey.route.places-unavailable' } });
    await route.fulfill({ json: { available: true, source: 'CoDoc', places: [
      { id: 'node-91', label: 'Петербургский бар', latitude: 59.93155, longitude: 30.3053, source: 'osm', meta: { themes: 'bars' } },
      { id: 'node-92', label: 'Второй бар', latitude: 59.932, longitude: 30.3058, source: 'osm', meta: { themes: 'bars' } },
    ] } });
  });
  await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('/?view=map');
  await expect(page.getByRole('textbox', { name: 'Название прогулки' })).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/presentation/state/walkStore.ts';
    const { useWalkStore } = await import(path);
    useWalkStore.setState(state => ({ draft: { ...state.draft, selectedCategoryIds: ['bars'],
      area: { anchors: [{ id: 'start', lat: 59.93155, lng: 30.3053 }], radiusMeters: 800 } } }));
  });
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/presentation/state/walkStore.ts';
    return (await import(path)).useWalkStore.getState().poisStatus;
  })).toBe('ready');
  await page.evaluate(async () => {
    const path = '/src/presentation/state/walkStore.ts';
    const { useWalkStore } = await import(path);
    useWalkStore.getState().setRoute({ geometry: [[59.93155, 30.3053], [59.932, 30.3058]], legs: [], totalDistanceMeters: 100, totalDurationSeconds: 80 }, 'ready');
  });
  await page.waitForTimeout(600);
  expect(requests).toHaveLength(1);
  fail = true;
  await page.evaluate(async () => {
    const path = '/src/presentation/state/walkStore.ts';
    (await import(path)).useWalkStore.getState().setRadius(3100);
  });
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/presentation/state/walkStore.ts';
    return (await import(path)).useWalkStore.getState().pois.length;
  })).toBe(2);
  fail = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(3);
  expect(new URL(requests[1]).searchParams.get('radiusKm')).toBe('3.1');
});
