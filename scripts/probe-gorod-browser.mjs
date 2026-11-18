import { chromium } from '@playwright/test';

// Real network smoke check of the anonymous same-origin script used by the native portal channel.
const browser = await chromium.launch({ headless: true });
try {
  const userAgent = browser.version();
  const page = await browser.newPage({ userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${userAgent} Safari/537.36` });
  await page.route('https://gorod.gov.spb.ru/app-source-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Anonymous portal probe</title>',
  }));
  await page.goto('https://gorod.gov.spb.ru/app-source-probe');
  const result = await page.evaluate(async () => {
    const read = async path => {
      const response = await fetch(path, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
      return { status: response.status, url: response.url, body: await response.text() };
    };
    const queries = ['13-я линия Васильевского острова, 44', '13-я линия В.О., 44', '13-я линия, 44'];
    const searches = [];
    for (const query of queries) {
      const search = await read('/facilities/search/ajax/?query=' + encodeURIComponent(query));
      searches.push({ query, status: search.status, houses: JSON.parse(search.body) });
    }
    const matchedHouse = searches.flatMap(search => search.houses).find(house => Number(house.data) > 0);
    if (!matchedHouse) throw new Error('No concrete house found');
    const passport = await read(`/facilities/${matchedHouse.data}/info/`);
    return { searches: searches.map(search => ({ query: search.query, status: search.status, matches: search.houses.length })),
      house: matchedHouse.main_address, passportStatus: passport.status,
      passportPresent: passport.body.includes('facility-tep'), redirectedToMobile: passport.url.includes('/m/') };
  });
  console.log(result);
  if (!result.searches.some(search => search.matches) || !result.passportPresent || result.redirectedToMobile) process.exitCode = 1;
} finally {
  await browser.close();
}
