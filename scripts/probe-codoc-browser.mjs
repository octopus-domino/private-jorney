import { chromium } from '@playwright/test';

// Manual real-network check: local secure app origin, mobile UA and the exact request from APK 1.0.2.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36' });
  await page.route('https://localhost/codoc-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local APK-origin probe</title>' }));
  await page.goto('https://localhost/codoc-probe');
  console.log(await page.evaluate(async () => {
    const started = performance.now(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch('https://www.codoc.site/api/journeys/buildings/nearby?lon=30.27&lat=59.94&limit=200&radiusKm=1&beforeYear=0',
        { headers: { Accept: 'application/json' }, signal: controller.signal });
      const body = await response.json();
      return { origin: location.origin, status: response.status, count: Array.isArray(body) ? body.length : null,
        seconds: Math.round(performance.now() - started) / 1000 };
    } catch (error) { return { origin: location.origin, error: String(error), seconds: Math.round(performance.now() - started) / 1000 }; }
    finally { clearTimeout(timer); }
  }));
} finally { await browser.close(); }
