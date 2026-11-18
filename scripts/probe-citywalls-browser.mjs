import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36' });
  await page.route('https://www.citywalls.ru/app-source-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Native source transport check</title>',
  }));
  await page.goto('https://www.citywalls.ru/app-source-probe');
  console.log(await page.evaluate(async () => {
    try {
      const result = await fetch('/map_around.html', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(25000) });
      const body = await result.text();
      const session = body.match(/SID:\s*["']s=([a-z\d]+)["']/i)?.[1];
      let square;
      if (session) {
        const response = await fetch(`/include/map_handler.php?action=load_geodata_cache&list=al&square=55&zoom=15&s=${session}`,
          { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(25000) });
        const text = await response.text();
        try { const data = JSON.parse(text); square = { status: response.status, bytes: text.length,
          result: data.result, features: data.geodata?.features?.length }; }
        catch { square = { status: response.status, bytes: text.length, json: false }; }
      }
      return { status: result.status, redirected: result.redirected, url: result.url,
        mapSession: /SID:\s*["']s=[a-z\d]+["']/i.test(body),
        title: body.match(/<title[^>]*>([^<]*)/i)?.[1], square };
    } catch (error) { return { error: String(error) }; }
  }));
} finally { await browser.close(); }
