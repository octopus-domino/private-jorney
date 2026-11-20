import { test, expect, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');
const address = 'Санкт-Петербург, 8-я Васильевского острова линия, дом 45/34';
const first = { id: 'first', name: 'Первый дом', lat: 59.942038, lng: 30.276872, source: 'manual', categoryIds: ['historical-house'], facts: [], details: { address, sourceUrl: 'https://www.citywalls.ru/house1709.html' } };
const second = { ...first, id: 'second', name: 'Второй дом', lng: 30.34 };
const other = { ...first, id: 'other', name: 'Лишняя точка', lng: 30.282 };
const geometry = [[first.lat, first.lng], [second.lat, second.lng]];
const route = { geometry, legs: [{ fromIndex: 0, toIndex: 1, geometry, distanceMeters: 1200, durationSeconds: 900 }], totalDistanceMeters: 1200, totalDurationSeconds: 900 };
const saved = { id: 'walk_test', title: 'Сохранённая прогулка', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', area: { anchors: [], radiusMeters: 800 }, selectedCategoryIds: [], selectedPoiIds: ['first', 'second'], view: 'map', savedPois: [first, second, other], savedRoute: route, savedFailedSegments: [] };

test('Avito cards stay visible when map bounds change behind the selected house', async ({ page }, info) => {
  let requests = 0;
  await page.route('**/history-source?**', async request => {
    const url = new URL(new URL(request.request().url()).searchParams.get('url')!);
    if (url.hostname !== 'www.avito.ru') return request.fallback();
    requests++;
    await request.fulfill({ json: { items: [{ id: 8493504075, categoryId: 24, title: 'Квартира в выбранном доме',
      urlPath: '/sankt-peterburg/kvartiry/kvartira_8493504075',
      priceDetailed: { value: 18100000, enabled: true, hasValue: true },
      geo: { formattedAddress: address }, coords: { lat: first.lat, lng: first.lng },
      realtyInfo: { transactionType: 'sell' } }] } });
  });
  if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  await page.locator('.selection__name').first().click();
  const card = page.getByRole('dialog', { name: 'Информация о точке' });
  await card.getByRole('tab', { name: 'О доме' }).click();
  const listing = card.getByRole('region', { name: 'Avito' }).locator('.apartment-card');
  await expect(listing).toHaveCount(1);
  const before = requests;
  await page.evaluate(async () => {
    const path = '/src/presentation/state/mapViewportStore.ts';
    const { useMapViewportStore } = await import(path);
    useMapViewportStore.getState().setArea({ west: 30.26, east: 30.29, south: 59.93, north: 59.95 });
  });
  await expect(listing).toHaveCount(1);
  await page.waitForTimeout(900);
  await expect(listing).toHaveCount(1);
  expect(requests).toBe(before);
});

async function swipeDown(target: Locator, cancel = false) {
  await target.evaluate((element, cancelled) => {
    const box = element.getBoundingClientRect();
    const touch = (y: number) => new Touch({ identifier: 1, target: element, clientX: box.left + box.width / 2, clientY: y });
    const start = touch(box.top + 10), end = touch(box.top + 130);
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start], cancelable: true }));
    element.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [end], cancelable: true }));
    element.dispatchEvent(new TouchEvent(cancelled ? 'touchcancel' : 'touchend', { bubbles: true, touches: [], changedTouches: [end] }));
  }, cancel);
}

test.beforeEach(async ({ page }) => {
  await page.route('https://apidata.mos.ru/**', request => request.fulfill({ json: { features: [] } }));
  await page.addInitScript((draft) => {
    if (!localStorage.getItem('private-walks/drafts/v1')) localStorage.setItem('private-walks/drafts/v1', JSON.stringify([draft]));
  }, saved);
  await page.route('**/history-source?**', async (request) => {
    const source = new URL(new URL(request.request().url()).searchParams.get('url')!);
    let body: string;
    if (source.hostname === 'www.citywalls.ru') body = fixture('citywalls-house.html');
    else if (source.hostname === 'api.cian.ru') body = fixture('cian-map.json');
    else if (source.hostname === 'www.avito.ru') { await request.fulfill({ status: 502, body: 'blocked' }); return; }
    else if (source.pathname.includes('/search/ajax/')) body = JSON.stringify([{ data: 36556, lat: first.lat, lon: first.lng, main_address: address }]);
    else if (source.pathname.includes('/programs/')) body = fixture('gorod-programs.html');
    else body = fixture('gorod-36556.html');
    await request.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body });
  });
  await page.route('**/*.tile.openstreetmap.org/**', (request) => request.abort());
  await page.route('https://images.cdn-cian.ru/**', (request) => request.abort());
  await page.goto('/?draft=walk_test');
  await expect(page.getByRole('textbox', { name: 'Название прогулки' })).toHaveValue(saved.title);
});

test('route survives reload and hides all unrelated markers until explicitly shown', async ({ page }) => {
  const pointCount = () => page.evaluate(() => document.querySelectorAll('.poi-marker').length + Array.from(document.querySelectorAll('.poi-cluster')).reduce((sum, marker) => sum + Number(marker.textContent), 0));
  await expect.poll(pointCount).toBe(2);
  await page.getByRole('button', { name: 'Показать остальные точки' }).click();
  await expect.poll(pointCount).toBe(3);
  await page.getByRole('button', { name: 'Скрыть остальные точки' }).click();
  await expect.poll(pointCount).toBe(2);
  await page.reload();
  await expect.poll(pointCount).toBe(2);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('private-walks/drafts/v1')!).find((d: { id: string }) => d.id === 'walk_test'));
  expect(stored.savedRoute.geometry).toEqual(geometry);
  expect(stored.selectedPoiIds).toEqual(['first', 'second']);
});

test('ready-made walks open from the map with all ordered stops and survive reload', async ({ page }) => {
  await page.route('**/api/journeys/**', request => request.fulfill({ json: { available: true, places: [] } }));
  await page.getByRole('button', { name: 'Готовые прогулки', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Готовые прогулки', exact: true });
  await expect(catalog.getByRole('heading', { name: 'Императорский детектив' })).toBeVisible();
  await catalog.getByRole('button', { name: 'Открыть прогулку' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Название прогулки' })).toHaveValue('Императорский детектив');
  await expect.poll(() => page.evaluate(() => {
    const drafts = JSON.parse(localStorage.getItem('private-walks/drafts/v1') || '[]');
    return drafts.find((draft: { title: string }) => draft.title === 'Императорский детектив')?.selectedPoiIds.length;
  })).toBe(4);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Название прогулки' })).toHaveValue('Императорский детектив');
});

test('coincident dense cluster opens every point at maximum zoom', async ({ page }) => {
  const dense = { ...saved, id: 'dense_test', selectedPoiIds: [], savedRoute: null,
    savedPois: Array.from({ length: 25 }, (_, index) => ({ ...first, lat: 59.9386, lng: 30.3141, id: `dense-${index}`, name: `Место ${index + 1}` })) };
  await page.addInitScript((draft) => localStorage.setItem('private-walks/drafts/v1', JSON.stringify([draft])), dense);
  await page.goto('/?draft=dense_test');
  const cluster = page.locator('.poi-cluster');
  await expect(cluster).toHaveText('25');
  await cluster.click();
  await expect(page.locator('.leaflet-control-zoom-in')).toHaveClass(/leaflet-disabled/);
  await expect(cluster).toHaveCount(1);
  const list = page.getByRole('dialog', { name: 'Точки в группе' });
  await expect(list.locator('.map-cluster-panel__list button')).toHaveCount(25);
  await swipeDown(list.locator('header'));
  await expect(list).toHaveCount(0);
  await cluster.click();
  await list.getByRole('button', { name: 'Место 25' }).click();
  await expect(page.getByRole('dialog', { name: 'Информация о точке' }).getByRole('heading', { name: 'Место 25', exact: true })).toBeVisible();
  await expect(list).toHaveCount(0);
});

test('a group of twelve opens its complete unique membership even when zoom splits it', async ({ page }) => {
  const points = Array.from({ length: 12 }, (_, index) => ({ ...first,
    id: `group-${index}`, name: `Дом группы ${index + 1}`, lat: 59.9386 + (index < 2 ? 0 : index * 0.00007), lng: 30.3141 + (index < 2 ? 0 : index * 0.00005) }));
  const draft = { ...saved, id: 'group-test', selectedPoiIds: [], savedRoute: null, savedPois: [...points, points[0]] };
  await page.addInitScript(value => localStorage.setItem('private-walks/drafts/v1', JSON.stringify([value])), draft);
  await page.goto('/?draft=group-test');
  const cluster = page.locator('.poi-cluster').filter({ hasText: /^12$/ });
  await expect(cluster).toHaveCount(1);
  await cluster.click();
  const list = page.getByRole('dialog', { name: 'Точки в группе' });
  await expect(list.locator('.map-cluster-panel__list button')).toHaveCount(12);
  await list.getByRole('button', { name: 'Дом группы 12', exact: false }).click();
  await expect(page.getByRole('dialog', { name: 'Информация о точке' }).getByRole('heading', { name: 'Дом группы 12', exact: true })).toBeVisible();
});

test('ordinary map tap opens the same house profile, Citywalls paragraphs and photo', async ({ page }) => {
  const addressPoint = { lat: 59.94207, lng: 30.30845 };
  await page.route('**/citywallsIndex.json', request =>
    request.fulfill({ json: [[1709, addressPoint.lat, addressPoint.lng]] }));
  await page.route('**/reverse?**', async (request) => {
    await request.fulfill({ json: { features: [{ geometry: { coordinates: [addressPoint.lng, addressPoint.lat] }, properties: { street: '8-я Васильевского острова линия', housenumber: '45/34', city: 'Санкт-Петербург' } }] } });
  });
  await page.route('**/w/api.php?**', (request) => request.fulfill({ json: { query: { pages: [] } } }));
  await page.route('**/history-source?**', async (request) => {
    const url = new URL(new URL(request.request().url()).searchParams.get('url')!);
    if (url.pathname === '/facilities/search/ajax/') {
      await request.fulfill({ json: [{ data: 36556, lat: addressPoint.lat, lon: addressPoint.lng, main_address: address }] });
    } else if (url.hostname === 'api.openstreetmap.org') {
      await request.fulfill({ contentType: 'text/xml', body: '<osm version="0.6"></osm>' });
    } else if (/\/house\d+\.html/.test(url.pathname)) {
      await request.fulfill({ body: '<img src="https://p2.citywalls.ru/thumb0_9-9530.jpg">' + fixture('citywalls-house.html') });
    } else await request.fallback();
  });
  await page.route('https://p2.citywalls.ru/**', (request) => request.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64') }));
  await expect.poll(() => page.locator('.poi-marker').count()).toBeGreaterThan(0);
  const box = await page.locator('.map-view').boundingBox();
  await page.locator('.map-view').click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  const card = page.getByRole('dialog', { name: 'Информация о месте', exact: true });
  await expect(card.getByRole('tab', { name: 'О доме' })).toBeVisible();
  await expect(card.locator('.place-history__photo')).toHaveAttribute('src', 'https://p2.citywalls.ru/photo_9-9530.jpg');
  await expect(card.getByRole('link', { name: 'Читать на Citywalls →' })).toBeVisible();
  await card.getByRole('tab', { name: 'О доме' }).click();
  await expect(card.getByText('Кто живёт в доме', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Паспорт этого дома на «Наш Санкт-Петербург» ↗' })).toHaveAttribute('href', 'https://gorod.gov.spb.ru/facilities/36556/info/');
  await expect(card.getByRole('button', { name: '📍 В маршрут' })).toBeInViewport();
  await swipeDown(card.locator('.spot-card__header'));
  await expect(card).toHaveCount(0);
});

test('ordinary Petersburg house card loads its passport when Photon connection is reset', async ({ page }) => {
  await page.route('**/reverse?**', route => route.abort('connectionreset'));
  await page.route('**/w/api.php?**', route => route.fulfill({ json: { query: { pages: [] } } }));
  await page.route('**/history-source?**', async route => {
    const url = new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (url.pathname !== '/public_api/maps/get_nearest/') { await route.fallback(); return; }
    await route.fulfill({ json: { buildings: [{ id: 198090, full_address: '14-я линия В.О., дом 35, литера А',
      latitude: Number(url.searchParams.get('latitude')), longitude: Number(url.searchParams.get('longitude')) }] } });
  });
  await expect.poll(() => page.locator('.poi-marker').count()).toBeGreaterThan(0);
  const box = await page.locator('.map-view').boundingBox();
  await page.locator('.map-view').click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  const card = page.getByRole('dialog', { name: 'Информация о месте', exact: true });
  await card.getByRole('tab', { name: 'О доме' }).click();
  await expect(card.getByRole('link', { name: 'Паспорт этого дома на «Наш Санкт-Петербург» ↗' })).toHaveAttribute('href', 'https://gorod.gov.spb.ru/facilities/198090/info/');
  await expect(card.getByText('14-я линия В.О., дом 35, литера А', { exact: true })).toBeVisible();
});

test('unpublished non-residential passport shows source state rather than an error and can be retried', async ({ page }, info) => {
  let updating = true;
  await page.route('**/history-source?**', async route => {
    const url = new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (url.pathname === '/public_api/maps/get_nearest/') {
      await route.fulfill({ json: { buildings: [{ id: 139493, full_address: 'набережная реки Мойки, дом 74, литера А', latitude: first.lat, longitude: first.lng }] } });
    } else if (url.pathname === '/facilities/139493/info/') {
      await route.fulfill({ body: fixture(updating ? 'gorod-passport-updating.html' : 'gorod-36556.html') });
    } else await route.fallback();
  });
  if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  await page.locator('.selection__name').first().click();
  const card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
  await card.getByRole('tab', { name: 'О доме' }).click();
  await expect(card.getByText('Нежилое здание', { exact: true })).toBeVisible();
  await expect(card.getByText(/Городской портал сообщает: технический паспорт находится на актуализации/)).toBeVisible();
  await expect(card.getByText('Не удалось получить сведения о доме.', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Страница здания на «Наш Санкт-Петербург» ↗' })).toHaveAttribute('href', 'https://gorod.gov.spb.ru/facilities/139493/info/');
  updating = false;
  await card.getByRole('button', { name: 'Проверить сведения ещё раз', exact: true }).click();
  await expect(card.getByText('Кто живёт в доме', { exact: true })).toBeVisible();
  await expect(card.getByText(/Городской портал сообщает: технический паспорт находится на актуализации/)).toHaveCount(0);
});

test('different wings of Slavy 30k1 share one passport while a detached annex retains its own identity', async ({ page }, info) => {
  const locations = [{ lat: 59.858, lng: 30.3859 }, { lat: 59.85865, lng: 30.3888 }, { lat: 59.85865, lng: 30.38668 }];
  const points = locations.map((point, index) => ({ ...first, ...point, id: `long-${index}`, name: `Часть дома ${index + 1}`, details: undefined }));
  await page.addInitScript(draft => localStorage.setItem('private-walks/drafts/v1', JSON.stringify([draft])),
    { ...saved, savedRoute: null, savedPois: points, selectedPoiIds: points.map(point => point.id) });
  let outlineReads = 0, passportReads = 0;
  await page.route('**/history-source?**', async route => {
    const url = new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (url.hostname === 'api.openstreetmap.org') { outlineReads++; await route.fulfill({ body: fixture('osm-slavy-30.xml') }); }
    else if (url.pathname === '/facilities/search/ajax/') await route.fulfill({ body: fixture('gorod-slavy-addresses.json') });
    else if (url.pathname === '/facilities/44858/info/') { passportReads++; await route.fulfill({ body: fixture('gorod-36556.html') }); }
    else if (url.pathname === '/facilities/28583/info/') await route.fulfill({ body: fixture('gorod-passport-updating.html')
      .replace(/набережная реки Мойки, дом 74/g, 'проспект Славы, дом 30, корпус 1').replace(/литера А/g, 'литера Б') });
    else await route.fallback();
  });
  await page.goto('/?draft=walk_test');
  for (let index = 0; index < 3; index++) {
    if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
    await page.locator('.selection__name').nth(index).click();
    const card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
    await card.getByRole('tab', { name: 'О доме' }).click();
    if (index < 2) await expect(card.getByRole('link', { name: 'Паспорт этого дома на «Наш Санкт-Петербург» ↗' })).toHaveAttribute('href', 'https://gorod.gov.spb.ru/facilities/44858/info/');
    else {
      await expect(card.getByText('Нежилое здание', { exact: true })).toBeVisible();
      await expect(card.getByRole('link', { name: 'Страница здания на «Наш Санкт-Петербург» ↗' })).toHaveAttribute('href', 'https://gorod.gov.spb.ru/facilities/28583/info/');
    }
    await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  expect(outlineReads).toBe(1);
  expect(passportReads).toBe(1);
});

test('all sheets dismiss downward while scrolling and cancelled gestures preserve the card', async ({ page }, info) => {
  const mobile = info.project.name.includes('android');
  if (mobile) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  await page.getByRole('button', { name: 'Включить в общий маршрут', exact: true }).click();
  const share = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'Включить в общий маршрут' }) });
  await swipeDown(share.locator('h2'));
  await expect(share).toHaveCount(0);
  if (mobile) {
    await swipeDown(page.locator('[data-drawer-handle]'));
    await expect(page.locator('.app__sidebar')).not.toHaveClass(/is-open/);
    await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  }
  await page.locator('.selection__name').first().click();
  const card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
  await card.getByRole('tab', { name: 'О доме' }).click();
  await expect(card.getByText('Кто живёт в доме', { exact: true })).toBeVisible();
  const body = card.locator('.poi-detail__body');
  await body.evaluate((el) => { el.scrollTop = 100; });
  await swipeDown(body);
  await expect(card).toBeVisible();
  await swipeDown(card.locator('.poi-detail__header'), true);
  await expect(card).toBeVisible();
  await swipeDown(card.locator('.poi-detail__header'));
  await expect(card).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Мои маршруты', exact: true }).click();
  const savedDialog = page.getByRole('dialog', { name: 'Мои маршруты', exact: true });
  await swipeDown(savedDialog.locator('.modal__head'));
  await expect(savedDialog).toHaveCount(0);
});

test('location button recenters the map again after panning without adding duplicate GPS anchors', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 59.95, longitude: 30.31 });
  const locate = page.locator('.map-geolocate-btn');
  await locate.click();
  const marker = page.locator('.anchor-marker[title="Моё местоположение"]');
  await expect(marker).toHaveCount(1);
  const centered = () => marker.evaluate((el) => {
    const pin = el.getBoundingClientRect(), map = document.querySelector('.map-view')!.getBoundingClientRect();
    return Math.hypot(pin.left + pin.width / 2 - map.left - map.width / 2, pin.top + pin.height / 2 - map.top - map.height / 2);
  });
  await expect.poll(centered).toBeLessThan(3);
  await page.locator('.map-view').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(centered).toBeGreaterThan(30);
  await locate.click();
  await expect.poll(centered).toBeLessThan(3);
  await expect(marker).toHaveCount(1);
});

test('favorites star persists, opens a saved place and removes it independently of the route', async ({ page }, info) => {
  if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  await page.locator('.selection__name').first().click();
  let card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
  await card.getByRole('button', { name: 'Добавить в избранное', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Удалить из избранного', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Избранные места', exact: true }).click();
  const favorites = page.getByRole('dialog', { name: 'Избранные места', exact: true });
  await expect(favorites.getByRole('combobox', { name: 'Город избранного' })).toHaveValue('Санкт-Петербург');
  await favorites.getByRole('button', { name: /Первый дом/ }).first().click();
  card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
  await card.getByRole('button', { name: 'Удалить из избранного', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Добавить в избранное', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('private-walks/drafts/v1')!).find((draft: {id:string}) => draft.id === 'walk_test').selectedPoiIds)).toEqual(['first', 'second']);
});

test('favorites filter by city, delete one entry and dismiss with a downward swipe', async ({ page }) => {
  await page.evaluate(({ first, second }) => localStorage.setItem('private-walks/favorites/v1', JSON.stringify([
    { id: first.id, city: 'Санкт-Петербург', poi: first, savedAt: new Date().toISOString() },
    { id: second.id, city: 'Москва', poi: { ...second, name: 'Московское место' }, savedAt: new Date().toISOString() },
  ])), { first, second });
  await page.reload();
  await page.getByRole('button', { name: 'Избранные места', exact: true }).click();
  const favorites = page.getByRole('dialog', { name: 'Избранные места', exact: true });
  await favorites.getByRole('combobox', { name: 'Город избранного' }).selectOption('Москва');
  await expect(favorites.getByText('Московское место', { exact: true })).toBeVisible();
  await expect(favorites.getByText('Первый дом', { exact: true })).toHaveCount(0);
  await favorites.getByRole('button', { name: 'Удалить Московское место из избранного', exact: true }).click();
  await expect(favorites.getByText('Первый дом', { exact: true })).toBeVisible();
  await swipeDown(favorites.locator('.modal__head'));
  await expect(favorites).toHaveCount(0);
});

test('saved walks display city and ordered start/end point labels', async ({ page }) => {
  await page.getByRole('banner').getByRole('button', { name: 'Мои маршруты', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Мои маршруты', exact: true });
  await expect(list.getByText('Санкт-Петербург', { exact: true })).toBeVisible();
  await expect(list.getByText('От: Первый дом', { exact: true })).toBeVisible();
  await expect(list.getByText('До: Второй дом', { exact: true })).toBeVisible();
});

test('Moscow resolves the selected house through its public map and restores history after restart', async ({ page }, info) => {
  const moscow = { ...first, id: 'moscow-house', name: 'Московский дом', lat: 55.75943295911467, lng: 37.56834975865027,
    details: { address: 'Москва, Большой Предтеченский переулок, 13, строение 1' } };
  const draft = { ...saved, savedRoute: null, selectedPoiIds: [moscow.id], savedPois: [moscow] };
  await page.addInitScript(value => localStorage.setItem('private-walks/drafts/v1', JSON.stringify([value])), draft);
  let calls = 0;
  await page.route('**/history-source?**', async route => {
    const source = new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (source.hostname !== 'um.mos.ru') { await route.fallback(); return; }
    calls++;
    await route.fulfill({ body: fixture(source.pathname === '/api/v2/points' ? 'moscow-points.json' : 'moscow-house.html') });
  });
  await page.goto('/?draft=walk_test');
  const open = async () => {
    if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
    await page.locator('.selection__name').first().click();
    const card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
    await expect(card.getByRole('link', { name: 'Читать на Узнай Москву →' })).toHaveAttribute('href', 'https://um.mos.ru/houses/gidrometcentr-rossii/');
  };
  await open();
  const firstPass = calls;
  await page.reload();
  await open();
  expect(calls).toBe(firstPass);
});

test('Moscow repairs appear in the shared house card and remain available after restart without source requests', async ({ page }, info) => {
  const point = { ...first, id: 'moscow-repair-house', name: 'Дом на Стартовой', lat: 55.875, lng: 37.69,
    details: { address: 'Москва, Стартовая улица, дом 11' } };
  await page.addInitScript(draft => localStorage.setItem('private-walks/drafts/v1', JSON.stringify([draft])),
    { ...saved, savedRoute: null, savedPois: [point], selectedPoiIds: [point.id] });
  let calls = 0;
  await page.route('https://apidata.mos.ru/**', async route => {
    calls++;
    const url = new URL(route.request().url());
    if (url.pathname.includes('/62963/')) {
      expect(url.searchParams.get('versionNumber')).toBe('2');
      await route.fulfill({ json: JSON.parse(fixture('moscow-repairs.json')) });
      return;
    }
    const technical = JSON.parse(fixture('moscow-building-profile.json'));
    technical[0].Cells.MKD[0].UNOM = 24733;
    await route.fulfill({ json: technical });
  });
  const open = async () => {
    if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
    await page.locator('.selection__name').first().click();
    const card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
    await card.getByRole('tab', { name: 'О доме' }).click();
    await expect(card.locator('.building-fact').filter({ hasText: 'Вода и канализация' })).toContainText('Ремонт завершён в 2014 году');
    await card.getByText('Источник сведений о ремонте', { exact: true }).click();
    await expect(card.getByRole('link', { name: 'Работы по капремонту · Открытые данные Москвы ↗' })).toHaveAttribute('href', 'https://data.mos.ru/opendata/62963');
    return card;
  };
  await page.goto('/?draft=walk_test');
  const card = await open();
  await expect(card.locator('dt').filter({ hasText: /^Жители$/ })).toHaveCount(0);
  expect(calls).toBe(2);
  await page.reload();
  await open();
  expect(calls).toBe(2);
});

test('CIAN POST fallback renders the supplied offer format while a restriction remains separate from passport data', async ({ page }, info) => {
  const point = { ...first, lat: 59.940902, lng: 30.271743,
    details: { address: 'Санкт-Петербург, Средний Васильевского острова проспект, 48/27', sourceUrl: 'https://www.citywalls.ru/house1709.html' } };
  await page.addInitScript(draft => localStorage.setItem('private-walks/drafts/v1', JSON.stringify([draft])),
    { ...saved, savedRoute: null, savedPois: [point], selectedPoiIds: [point.id] });
  let posted = false;
  await page.route('**/history-source?**', async route => {
    const source = new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (source.hostname === 'api.cian.ru') {
      if (route.request().method() !== 'POST') { await route.fulfill({ status: 403 }); return; }
      const payload = route.request().postDataJSON();
      expect(payload.path).toContain('/v1/get-results-for-map?');
      posted = true;
      await route.fulfill({ json: JSON.parse(fixture('cian-search.json')) });
    } else if (source.pathname.includes('/search/ajax/')) {
      await route.fulfill({ json: [{ data: 36556, lat: point.lat, lon: point.lng, main_address: point.details.address }] });
    } else if (source.hostname === 'www.avito.ru') await route.fulfill({ status: 403 });
    else await route.fallback();
  });
  await page.goto('/?draft=walk_test');
  if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  await page.locator('.selection__name').first().click();
  const card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
  await card.getByRole('tab', { name: 'О доме' }).click();
  await expect(card.getByText('Кто живёт в доме', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Объявление на Циан ↗' })).toHaveAttribute('href', 'https://spb.cian.ru/sale/flat/335039742/');
  await expect(card.getByRole('region', { name: 'Циан' })).toContainText('47');
  await expect(card.getByRole('region', { name: 'Avito' })).toContainText('ограничил доступ');
  expect(posted).toBe(true);
  await page.reload();
  posted = false;
  if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  await page.locator('.selection__name').first().click();
  await card.getByRole('tab', { name: 'О доме' }).click();
  await expect(card.getByRole('link', { name: 'Объявление на Циан ↗' })).toHaveAttribute('href', 'https://spb.cian.ru/sale/flat/335039742/');
  expect(posted).toBe(false);
});

test('a second house loads after a selected route and reopened houses use persistent cache only', async ({ page }, info) => {
  test.setTimeout(60000);
  const houses = [first, { ...second, details: { address: 'Санкт-Петербург, Другая улица, дом 20', sourceUrl: 'https://www.citywalls.ru/house1710.html' } }];
  const counters = { citywalls: 0, passports: 0 };
  let firstPass: typeof counters | undefined;
  await page.addInitScript(draft => localStorage.setItem('private-walks/drafts/v1', JSON.stringify([draft])), { ...saved, savedPois: houses });
  await page.route('**/history-source?**', async route => {
    const url = new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (/\/house\d+\.html/.test(url.pathname)) counters.citywalls++;
    if (/\/facilities\/\d+\/info\//.test(url.pathname)) counters.passports++;
    if (url.pathname.includes('/search/ajax/')) {
      const index = url.searchParams.get('query')!.includes('Другая') ? 1 : 0;
      await route.fulfill({ json: [{ data: 36556 + index, lat: houses[index].lat, lon: houses[index].lng, main_address: houses[index].details.address }] });
    } else await route.fallback();
  });
  await page.goto('/?draft=walk_test');
  for (let pass = 0; pass < 2; pass++) {
    for (let index = 0; index < houses.length; index++) {
      if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
      await page.locator('.selection__name').nth(index).click();
      const card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
      await expect(card.getByText('Читать на Citywalls →')).toBeVisible();
      await card.getByRole('tab', { name: 'О доме' }).click();
      await expect(card.getByText('Кто живёт в доме', { exact: true })).toBeVisible();
      await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
    }
    if (pass === 0) { firstPass = { ...counters }; await page.reload(); await expect(page.locator('.app__title')).toHaveValue(saved.title); }
  }
  expect(counters).toEqual(firstPass);
  expect(counters.citywalls).toBeGreaterThanOrEqual(2);
  expect(counters.passports).toBeGreaterThanOrEqual(2);
});

test('building summary fits desktop and phone, with fixed actions and independent listing sources', async ({ page }, info) => {
  if (info.project.name.includes('android')) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  await page.locator('.selection__name').first().click();
  const card = page.getByRole('dialog', { name: 'Информация о точке' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Читать на Citywalls →')).toBeVisible();
  await card.getByRole('tab', { name: 'О доме' }).click();
  await expect(card.getByText('Кто живёт в доме', { exact: true })).toBeVisible();
  await expect(card.getByText('Много жителей старше трудоспособного возраста', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('region', { name: 'Циан' }).locator('.apartment-card')).toHaveCount(1);
  await expect(card.getByRole('region', { name: 'Avito' })).toContainText('не предоставил объявления');
  await expect(card.getByRole('link', { name: 'Объявление на Циан ↗' })).toHaveAttribute('href', 'https://spb.cian.ru/sale/flat/334867477/');
  const layout = await card.evaluate((el) => {
    const card = el.getBoundingClientRect();
    const action = el.querySelector('.poi-detail__actions')!.getBoundingClientRect();
    const body = el.querySelector('.poi-detail__body')!;
    return { left: card.left, right: card.right, bottom: card.bottom, top: card.top, actionBottom: action.bottom, actionTop: action.top, scrollable: body.scrollHeight > body.clientHeight, width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.width);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.height);
  expect(layout.actionBottom).toBeLessThanOrEqual(layout.bottom);
  expect(layout.actionTop).toBeGreaterThan(layout.top);
  expect(layout.scrollable).toBe(true);
  expect(layout.horizontalOverflow).toBe(false);
  await page.locator('.poi-detail__body').evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: `test-results/summary-${info.project.name}.png` });
  await page.locator('.poi-detail__body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(card.getByRole('button', { name: 'Убрать из маршрута' })).toBeInViewport();
  await page.screenshot({ path: `test-results/building-${info.project.name}.png` });
});
