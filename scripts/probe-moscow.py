"""Developer-only source inspection; never print the key or authenticated URLs."""
import json
from pathlib import Path
from curl_cffi import requests

key = next(line.split('=', 1)[1].strip() for line in Path('.env.local').read_text().splitlines()
           if line.startswith('VITE_MOS_DATA_API_KEY='))
try:
    rows = []
    for skip in range(0, 4000, 500):
        response = requests.get('https://apidata.mos.ru/v1/datasets',
            params={'api_key': key, '$top': 500, '$skip': skip, '$format': 'json'},
            headers={'Accept': 'application/json'}, impersonate='chrome', timeout=25)
        print('Page:', skip, 'Status:', response.status_code)
        if response.status_code != 200: break
        page = response.json()['Items']
        rows.extend(page)
        if len(page) < 500: break
    Path('moscow-catalog.local.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
    for row in rows:
        title = row.get('Caption', '')
        if any(word in title.lower() for word in ['жил', 'дом', 'адрес', 'ремонт', 'здан']):
            print(row.get('Id'), title)
except Exception as error:
    print('Source request failed:', type(error).__name__)
