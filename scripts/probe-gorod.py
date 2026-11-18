"""Compare the public portal's desktop, mobile hints and WebView request headers; no authentication is used."""
from pathlib import Path
from time import monotonic
from curl_cffi import requests

desktop = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
mobile = 'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36'
variants = [
    ('desktop', {'User-Agent': desktop}),
    ('desktop-mobile-hints', {'User-Agent': desktop, 'Sec-CH-UA-Mobile': '?1', 'Sec-CH-UA-Platform': '"Android"'}),
    ('desktop-package-header', {'User-Agent': desktop, 'X-Requested-With': 'codoc.site.privateWalks'}),
    ('mobile', {'User-Agent': mobile}),
]
for name, headers in variants:
    started = monotonic()
    try:
        response = requests.get('https://gorod.gov.spb.ru/facilities/36556/info/', headers=headers,
            impersonate='chrome', timeout=25, allow_redirects=False)
        print(name, response.status_code, round(monotonic() - started, 2),
            'redirect=' + response.headers.get('Location', ''), 'passport=' + str('facility-tep' in response.text),
            'bytes=' + str(len(response.content)), flush=True)
        Path(f'.cache/gorod-{name}.html').write_text(response.text, encoding='utf-8')
    except Exception as error:
        print(name, type(error).__name__, round(monotonic() - started, 2), flush=True)
