import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Manual artifact validation, independent of Vite and of the application build.
const browser = await chromium.launch();
const errors = [], requests = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  const url = pathToFileURL(resolve('docs/application-description.html')).href;
  await page.goto(url);
  assert.equal(await page.locator('main section').count(), 28);
  assert.equal(await page.locator('#toc-list a').count(), 28);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')]
    .some(link => !document.getElementById(link.hash.slice(1)))), false);
  await page.locator('#toc-search').fill('Москва');
  assert.equal(await page.locator('#toc-list li:visible').count(), 1);
  await page.locator('#toc-search').fill('');
  await page.locator('#expand').click();
  assert.equal(await page.locator('details:not([open])').count(), 0);
  await page.screenshot({ path: '.cache/description-desktop.png' });
  await page.pdf({ path: '.cache/private_walks_1.0.10_description.pdf', format: 'A4', printBackground: true,
    margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' } });
  for (const width of [360, 740, 1440]) {
    await page.setViewportSize({ width, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width === 360) {
      await page.locator('#toc-toggle').click();
      assert.equal(await page.locator('#toc-list li:visible').count(), 28);
      await page.locator('#toc-toggle').click();
      await page.screenshot({ path: '.cache/description-mobile.png' });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log('Description: 28 sections; navigation, search, disclosure controls, responsive layout and standalone PDF verified.');
} finally {
  await browser.close();
}
