"""Read public building pages with a browser-compatible HTTP client."""
import sys
from urllib.parse import urlparse, parse_qs
from curl_cffi import requests


def allowed(url, method='GET'):
    import re
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.port not in (None, 443) or parsed.username or parsed.password:
        return False
    if method == 'POST':
        return parsed.hostname == 'api.cian.ru' and parsed.path == '/search-engine/v1/search-offers-mobile-site/'
    if method != 'GET':
        return False
    if parsed.hostname == 'api.openstreetmap.org':
        import math
        try:
            bounds = [float(value) for value in parse_qs(parsed.query).get('bbox', [''])[0].split(',')]
            if len(bounds) != 4 or not all(math.isfinite(value) for value in bounds):
                return False
            west, south, east, north = bounds
            return (parsed.path == '/api/0.6/map' and -180 <= west < east <= 180 and -90 <= south < north <= 90
                    and (east - west) * (north - south) <= 0.00005)
        except ValueError:
            return False
    if parsed.hostname == 'www.citywalls.ru':
        if parsed.path == '/map_around.html' or re.fullmatch(r'/house\d+\.html', parsed.path):
            return True
        query = parse_qs(parsed.query)
        return (parsed.path == '/include/map_handler.php'
                and query.get('action') == ['load_geodata_cache']
                and query.get('list') == ['al'] and query.get('zoom') == ['15']
                and len(query.get('square', [])) == 1
                and query['square'][0].isdigit() and 0 <= int(query['square'][0]) < 100)
    if parsed.hostname == 'gorod.gov.spb.ru':
        return parsed.path in ('/public_api/maps/get_nearest/', '/facilities/search/ajax/') or bool(re.fullmatch(r'/facilities/\d+/(?:summary/|info/|programs/)?', parsed.path))
    if parsed.hostname == 'www.avito.ru':
        return parsed.path == '/js/1/map/items' and parse_qs(parsed.query).get('categoryId') == ['24']
    if parsed.hostname == 'api.cian.ru':
        return parsed.path == '/mobile-search-frontend/v1/get-results-for-map-microfrontend/'
    if parsed.hostname == 'overpass-api.de':
        return parsed.path == '/api/interpreter' and len(parsed.query) <= 12000
    if parsed.hostname == 'um.mos.ru':
        return bool(re.fullmatch(r'/houses/[a-zA-Z0-9_-]+/', parsed.path)) or (parsed.path == '/api/v2/points' and parse_qs(parsed.query).get('filter[type]') == ['house'])
    return False


if __name__ == '__main__':
    url = sys.argv[1]
    method = sys.argv[2] if len(sys.argv) > 2 else 'GET'
    payload = None
    if method == 'POST':
        import json
        raw = sys.stdin.buffer.read(32769)
        if len(raw) > 32768:
            raise ValueError('Source request too large')
        payload = json.loads(raw)
    for _ in range(4):
        if not allowed(url, method):
            raise ValueError('Unsupported building source URL')
        response = requests.request(method, url, json=payload, impersonate='chrome', timeout=25, allow_redirects=False)
        if response.status_code in (301, 302, 307, 308):
            from urllib.parse import urljoin
            url = urljoin(url, response.headers['Location'])
            continue
        if response.status_code in (403, 429, 439):
            print('Public source restricted access', file=sys.stderr)
            sys.exit(43)
        if response.status_code == 404:
            print('Public source endpoint not found', file=sys.stderr)
            sys.exit(44)
        if response.status_code >= 500:
            print('Public source temporarily unavailable', file=sys.stderr)
            sys.exit(45)
        response.raise_for_status()
        if len(response.content) > 10 * 1024 * 1024:
            raise ValueError('Source response too large')
        sys.stdout.buffer.write(response.text.encode('utf-8'))
        break
    else:
        raise ValueError('Too many redirects')
