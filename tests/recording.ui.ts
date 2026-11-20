import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const start = { lat: 59.94, lng: 30.27 };
const house = { lat: 59.9401, lng: 30.2703 };
const rightHouse = { lat: 59.93988, lng: 30.27015 };
const codocHouse = (point: { lat: number; lng: number }, id = 1709, name = 'Дом на прогулке') => ({
  id, name, latitude: point.lat, longitude: point.lng, address: null, osmId: null, constructionYear: null,
  constructionPeriod: null, architect: null, style: null, heritageStatus: null, source: 'codoc', sourceUrl: `https://www.citywalls.ru/house${id}.html`,
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/journeys/buildings/nearby?**', request => request.fulfill({ json: [codocHouse(house)] }));
  await page.route('**/api/journeys/routes/places**', request => request.fulfill({ json: { available: true, places: [], source: 'codoc' } }));
  await page.route('https://apidata.mos.ru/**', request => request.fulfill({ json: { features: [] } }));
  await page.route(/https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, request => request.abort());
  await page.route('**/reverse?**', request => request.fulfill({ json: { features: [{ geometry: { coordinates: [start.lng, start.lat] },
    properties: { city: 'Saint Petersburg', country: 'Russia', countrycode: 'RU', street: 'Средний проспект', housenumber: '48' } }] } }));
  await page.route('**/history-source?**', request => {
    const source = new URL(new URL(request.request().url()).searchParams.get('url')!);
    if (source.hostname === 'overpass-api.de') return request.fulfill({ json: { elements: source.searchParams.get('data')!.includes('way[highway]')
      ? [{ id: 1, nodes: [1, 2, 3], geometry: [0, 0.0005, 0.001].map(offset => ({ lat: start.lat, lon: start.lng + offset })),
        tags: { highway: 'residential', name: 'Первая улица' } },
      { id: 2, nodes: [2, 4], geometry: [{ lat: start.lat, lon: start.lng + 0.0005 },
        { lat: start.lat + 0.001, lon: start.lng + 0.0005 }], tags: { highway: 'residential', name: 'Вторая улица' } }] : [] } });
    if (source.pathname === '/map_around.html') return request.fulfill({ body: 'SID:"s=testsession"' });
    if (source.pathname === '/include/map_handler.php') return request.fulfill({ json: { result: 'ok', geodata: { features: [{ geometry: { geometries: [{ type: 'Point', id: 1709, title: 'Дом на прогулке', coordinates: [house.lng, house.lat] }] } }] } } });
    if (source.hostname === 'www.citywalls.ru') return request.fulfill({ body: readFileSync('tests/fixtures/citywalls-house.html', 'utf8')
      + '<div class="cssPhotoList"><div class="photo"><img src="https://p1.citywalls.ru/photo_test.jpg"></div></div>' });
    return request.fulfill({ status: 403, body: 'Unavailable' });
  });
  await page.goto('/');
});

test('welcome and house guide fit mobile and desktop and allow exploration without location permission', async ({ page }, info) => {
  await expect(page.getByRole('heading', { name: 'У каждой прогулки есть своя история' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записать прогулку' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/welcome-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Как это работает' }).click();
  await expect(page.getByRole('heading', { name: 'Коснитесь любого дома' })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть карту' }).click();
  await expect(page.getByRole('textbox', { name: 'Название прогулки' })).toBeVisible();
  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Записать прогулку' })).toBeVisible();
});

test('record start-stop persists full GPS, factual report and preview across an offline reload', async ({ page }, info) => {
  await page.route('https://p1.citywalls.ru/photo_test.jpg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#dfeae2"/></svg>',
  }));
  await page.route('**/api/journeys/buildings/nearby?**', request => request.fulfill({ json: [
    codocHouse(house), codocHouse(rightHouse, 1710, 'Дом справа'),
  ] }));
  await page.addInitScript(() => {
    let callback: PositionCallback | undefined;
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(success: PositionCallback) { callback = success; return 7; },
      clearWatch() { callback = undefined; },
    }, configurable: true });
    (window as unknown as { sendFix(lat: number, lng: number, age: number): void }).sendFix = (lat, lng, age) => callback?.({
      coords: { latitude: lat, longitude: lng, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now() - age,
    } as GeolocationPosition);
  });
  await page.reload();
  await page.getByRole('button', { name: 'Записать прогулку' }).click();
  const sheet = page.getByRole('dialog', { name: 'Запись прогулки', exact: true });
  await sheet.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await expect(sheet.getByText('Записываем вашу прогулку', { exact: true })).toBeVisible();
  await page.evaluate(({ lat, lng }) => {
    const gps = window as unknown as { sendFix(lat: number, lng: number, age: number): void };
    gps.sendFix(lat, lng, 30000); gps.sendFix(lat, lng + 0.0003, 15000); gps.sendFix(lat, lng + 0.0006, 0);
  }, start);
  await sheet.getByRole('button', { name: 'Завершить прогулку' }).click();
  await expect(sheet.locator('.recording-list__open')).toHaveCount(1);
  await expect(sheet.locator('.recording-list__open small')).toHaveText('Места по дороге и сохранённый рассказ', { timeout: 15000 });
  await sheet.locator('.recording-list__open').click();
  await expect(sheet.locator('.walk-report__preview')).toHaveJSProperty('complete', true);
  await expect(sheet.locator('.walk-report > p').nth(1)).toContainText('Санкт-Петербург');
  const speed = sheet.getByRole('button', { name: 'Карта скорости' });
  await speed.click();
  await expect(sheet.getByRole('list', { name: 'Скорость на маршруте' })).toBeVisible();
  await expect(sheet.locator('.walk-speed-line').first()).toBeAttached();
  await expect(sheet.locator('.walk-report-map__canvas')).toHaveCSS('opacity', '1');
  await speed.click();
  const section = sheet.locator('.walk-timeline__section').first();
  await expect(section.getByRole('heading')).toHaveText('Место выхода → Первая улица × Вторая улица');
  const left = section.locator('.walk-timeline__place--left');
  const right = section.locator('.walk-timeline__place--right');
  await expect(left.getByText('Слева', { exact: true })).toBeVisible();
  await expect(right.getByText('Справа', { exact: true })).toBeVisible();
  await expect(left.locator('img')).toHaveAttribute('src', 'https://p1.citywalls.ru/photo_test.jpg');
  const positions = await section.evaluate(node => {
    const point = (side: string, item: string) => node.querySelector(`.walk-timeline__place--${side} .walk-timeline__${item}`)!.getBoundingClientRect();
    return { left: point('left', 'card').left, right: point('right', 'card').left,
      leftDot: point('left', 'dot').top, rightDot: point('right', 'dot').top };
  });
  expect(positions.left).toBeLessThan(positions.right);
  expect(positions.rightDot).toBeLessThan(positions.leftDot);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await section.screenshot({ path: `test-results/timeline-${info.project.name}.png` });
  await page.screenshot({ path: `test-results/recording-${info.project.name}.png` });
  // Native assets are bundled. In Vite keep only the local app server reachable while all sources are offline.
  await page.route('**/history-source?**', request => request.abort('internetdisconnected'));
  await page.route('**/reverse?**', request => request.abort('internetdisconnected'));
  await page.reload();
  await page.getByRole('button', { name: 'Записать прогулку' }).click();
  await page.locator('.recording-list__open').click();
  await expect(page.locator('.walk-report__preview')).toHaveJSProperty('complete', true);
  await expect(page.locator('.walk-report h3')).toContainText('Санкт-Петербург');
  await expect(page.locator('.walk-timeline__card')).toHaveCount(2);
});

test('GPS profile fits the recording sheet and survives reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Записать прогулку', exact: true }).click();
  const mode = page.getByLabel('Режим GPS');
  await mode.selectOption('economy');
  await expect(mode).toHaveValue('economy');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Записать прогулку', exact: true }).click();
  await expect(mode).toHaveValue('economy');
  await mode.selectOption('precise');
  await expect(page.getByText('Частые точки и активный GPS. Расход батареи выше.', { exact: true })).toBeVisible();
});

for (const stationary of [true, false]) test(`${stationary ? 'a one-location' : 'a moving return'} recording shows a real map and reopens from the tile cache offline`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let requests = 0;
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext('2d')!; context.fillStyle = '#e1e8dd'; context.fillRect(0, 0, 256, 256);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route(/https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => {
    requests++;
    return route.fulfill({ body: Buffer.from(png, 'base64'), contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.evaluate(({ lat, lng, stationary }) => {
    const first = { lat, lng, accuracy: 8, timestamp: Date.now() - 60000 };
    const points = stationary ? [first] : [first, { ...first, lng: lng + .002, timestamp: Date.now() - 30000 }, { ...first, timestamp: Date.now() }];
    localStorage.setItem('private-walks/browser-recording/v1', JSON.stringify({
      id: 'report', startedAt: first.timestamp, endedAt: Date.now(), state: 'stopped', pointCount: points.length,
      distanceMeters: 0, points,
    }));
  }, { ...start, stationary });
  await page.reload();
  await page.getByRole('button', { name: 'Записать прогулку', exact: true }).click();
  await page.locator('.recording-list__open').click();
  const map = page.getByRole('region', { name: 'Карта записанной прогулки', exact: true });
  await expect(map.locator('.leaflet-container')).toHaveCSS('opacity', '1');
  await expect.poll(() => map.locator('.leaflet-tile').evaluateAll(images => images.length > 0
    && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  if (stationary) {
    const marker = (await map.locator('.leaflet-overlay-pane path').boundingBox())!;
    const bounds = (await map.boundingBox())!;
    expect(Math.abs(marker.x + marker.width / 2 - bounds.x - bounds.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(marker.y + marker.height / 2 - bounds.y - bounds.height / 2)).toBeLessThanOrEqual(1);
    await expect(page.getByText('Сохранено местоположение. Перемещение не зафиксировано; отдельный путь не построен.', { exact: true })).toBeVisible();
  } else await expect(map.locator('.leaflet-overlay-pane path')).toHaveCount(3);
  const before = requests;
  await page.route(/https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => { requests++; return route.abort('internetdisconnected'); });
  await page.reload();
  await page.getByRole('button', { name: 'Записать прогулку', exact: true }).click();
  await page.locator('.recording-list__open').click();
  await expect(map.locator('.leaflet-container')).toHaveCSS('opacity', '1');
  expect(requests).toBe(before);
  expect(errors).toEqual([]);
});

test('an interrupted browser journal is recovered into the archive and can be deleted', async ({ page }) => {
  await page.evaluate(({ lat, lng }) => localStorage.setItem('private-walks/browser-recording/v1', JSON.stringify({
    id: 'walk_recovery', startedAt: Date.now() - 60000, state: 'recording', pointCount: 2, distanceMeters: 20,
    points: [{ lat, lng, accuracy: 8, timestamp: Date.now() - 60000 }, { lat, lng: lng + 0.0003, accuracy: 8, timestamp: Date.now() - 40000 }],
  })), start);
  await page.reload();
  await page.getByRole('button', { name: 'Записать прогулку' }).click();
  await expect(page.locator('.recording-list__open')).toHaveCount(1);
  await page.locator('.recording-list__open').click();
  await expect(page.getByText('Запись прервалась. Сохранена та часть пути, которую успел записать телефон.')).toBeVisible();
  await page.getByRole('button', { name: 'Все записи', exact: false }).click();
  await page.getByRole('button', { name: 'Удалить запись', exact: false }).click();
  await expect(page.locator('.recording-list__open')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Записать прогулку' }).click();
  await expect(page.locator('.recording-list__open')).toHaveCount(0);
});

test('selected addresses center the map, close the drawer and discover houses around both anchors', async ({ page }) => {
  const next = { lat: 59.945, lng: 30.29 };
  await page.route('**/api/journeys/buildings/nearby?**', request => request.fulfill({ json: [codocHouse(start, 1709, 'Найденный дом 1'), codocHouse(next, 1710, 'Найденный дом 2')] }));
  await page.route('**/api/?**', request => {
    const second = new URL(request.request().url()).searchParams.get('q')!.includes('Второй');
    const point = second ? next : start;
    return request.fulfill({ json: { features: [{ geometry: { coordinates: [point.lng, point.lat] },
      properties: { name: second ? 'Второй адрес' : 'Первый адрес', city: 'Saint Petersburg', country: 'Russia', countrycode: 'RU' } }] } });
  });
  await page.route('**/history-source?**', request => {
    const source = new URL(new URL(request.request().url()).searchParams.get('url')!);
    if (source.pathname !== '/include/map_handler.php') return request.fallback();
    return request.fulfill({ json: { result: 'ok', geodata: { features: [{ geometry: { geometries: [start, next].map((point, i) => ({
      type: 'Point', id: 1709 + i, title: `Найденный дом ${i + 1}`, coordinates: [point.lng, point.lat],
    })) } }] } } });
  });
  await page.getByRole('button', { name: 'Исследовать карту' }).click();
  for (const name of ['Первый', 'Второй']) {
    const input = page.getByPlaceholder('Адрес или место');
    if (await page.locator('.app__mobile-bar').isVisible()) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
    await input.fill(`${name} адрес`);
    await page.locator('.entry__hit').filter({ hasText: `${name} адрес, Санкт-Петербург, Россия` }).click();
    await expect(page.locator('.app')).not.toHaveClass(/app--drawer-open/);
    await expect.poll(async () => {
      const marker = await page.locator('.anchor-marker').last().boundingBox();
      const map = await page.locator('.map-view').boundingBox();
      return marker && map ? Math.hypot(marker.x + marker.width / 2 - map.x - map.width / 2, marker.y + marker.height / 2 - map.y - map.height / 2) : Infinity;
    }).toBeLessThan(20);
  }
  await expect(page.locator('.app__header-meta')).toContainText('2 точек рядом');
  await page.getByRole('tab', { name: 'Список', exact: true }).click();
  await expect(page.locator('.poi-card__name')).toHaveText(['Найденный дом 1', 'Найденный дом 2']);
});

test('long route names wrap inside saved cards without horizontal overflow', async ({ page }) => {
  const title = 'Очень длинная прогулка по старым улицам Санкт-Петербурга от Васильевского острова до набережной с интересными домами';
  await page.getByRole('button', { name: 'Исследовать карту' }).click();
  await page.getByRole('textbox', { name: 'Название прогулки' }).fill(title);
  // Draft persistence is debounced; opening the list must observe the committed title.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('private-walks/drafts/v1') ?? '')).toContain(title);
  await page.locator('.app__header').getByRole('button', { name: 'Мои маршруты', exact: true }).click();
  const card = page.locator('.saved-route__title').filter({ hasText: title });
  await expect(card).toBeVisible();
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await card.evaluate(element => element.clientHeight > 25)).toBe(true);
});

test('changing a filter removes the old discovery and a stalled source cannot keep searching forever', async ({ page }) => {
  await page.goto(`/?points=${start.lat},${start.lng}&categories=historical-house`);
  await expect(page.locator('.app__header-meta')).toContainText('1 точек рядом');
  if (await page.locator('.app__mobile-bar').isVisible()) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
  await page.getByRole('button', { name: 'Исторические дома', exact: true }).click();
  await expect(page.locator('.poi-marker')).toHaveCount(0);
  await page.route('**/api/journeys/routes/places**', () => {}); // Deliberately unanswered codoc source.
  await page.clock.install();
  await page.getByRole('button', { name: 'Бары', exact: true }).click();
  await expect(page.locator('.app__header-meta')).toContainText('Ищем точки');
  await page.clock.runFor(500);
  await page.clock.fastForward(21000);
  await expect(page.locator('.app__header-meta')).toContainText('Ищем точки');
  await page.clock.fastForward(71000);
  await expect(page.locator('.app__header-meta')).toContainText('Не удалось обновить места');
  await expect(page.locator('.app__header-meta').getByRole('button', { name: 'Повторить' })).toBeVisible();
  await expect(page.locator('.poi-marker')).toHaveCount(0);
});

test('Moscow house card shows official technical data and restores it without another API request', async ({ page }) => {
  let apiCalls = 0;
  const point = { id: 'moscow-api-house', name: 'Дом на Борисовской', lat: 55.78533905, lng: 37.736673419,
    source: 'historical-house', categoryIds: ['historical-house'], facts: [], details: { address: 'Москва, Борисовская улица, 4' } };
  const draft = { id: 'moscow-api', title: 'Москва · Борисовская', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    area: { anchors: [], radiusMeters: 500 }, selectedCategoryIds: [], selectedPoiIds: [point.id], view: 'map', savedPois: [point] };
  await page.evaluate(value => localStorage.setItem('private-walks/drafts/v1', JSON.stringify([value])), draft);
  await page.route('https://apidata.mos.ru/**', request => {
    apiCalls++;
    return request.fulfill({ json: JSON.parse(readFileSync('tests/fixtures/moscow-building-profile.json', 'utf8')) });
  });
  await page.goto('/?draft=moscow-api');
  for (let pass = 0; pass < 2; pass++) {
    if (await page.locator('.app__mobile-bar').isVisible()) await page.getByRole('button', { name: '📍 Маршрут', exact: true }).click();
    await page.locator('.selection__name').click();
    const card = page.getByRole('dialog', { name: 'Информация о точке', exact: true });
    await card.getByRole('tab', { name: 'О доме' }).click();
    await expect(card.locator('.building-facts')).toContainText('16 этажей');
    await expect(card.locator('.building-facts')).toContainText('индивидуальный проект');
    await expect(card.getByRole('link', { name: 'Источник: Открытые данные Москвы ↗' })).toHaveAttribute('href', 'https://data.mos.ru/opendata/2681');
    expect(apiCalls).toBe(1);
    await page.reload();
  }
});

