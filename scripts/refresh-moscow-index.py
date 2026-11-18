"""Build a compact public UNOM -> management-company lookup; the API key is never bundled in this data file."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from curl_cffi import requests

key = next(line.split('=', 1)[1].strip() for line in Path('.env.local').read_text().splitlines()
           if line.startswith('VITE_MOS_DATA_API_KEY='))
session = requests.Session(impersonate='chrome', headers={'Accept': 'application/json'})
base = 'https://apidata.mos.ru/v1/datasets/2681'
params = {'api_key': key, '$format': 'json'}
metadata_response = session.get(base, params=params, timeout=25)
if metadata_response.status_code != 200:
    raise SystemExit('Dataset metadata unavailable: ' + str(metadata_response.status_code))
metadata = metadata_response.json()
version, release = (int(value) for value in str(metadata['VersionNumber']).split('.', 1))
companies = []
addresses = {}
for skip in range(0, metadata['ItemsCount'], 500):
    response = session.post(base + '/rows', params={**params, '$skip': skip, '$top': 500,
        'versionNumber': version, 'releaseNumber': release},
        json=['MKD', 'UNOM', 'Address', 'is_deleted', 'ShortName'], timeout=30)
    if response.status_code != 200:
        raise SystemExit('Dataset page unavailable: ' + str(response.status_code))
    for offset, row in enumerate(response.json()):
        cells = row['Cells']
        unoms = sorted({house['UNOM'] for house in cells.get('MKD', [])
            if house.get('is_deleted') != 1 and isinstance(house.get('UNOM'), int) and house['UNOM'] > 0})
        if unoms:
            companies.append({'row': skip + offset, 'name': cells.get('ShortName', ''), 'unoms': unoms})
        for house in cells.get('MKD', []):
            if house.get('UNOM') not in unoms or not house.get('Address'): continue
            parts = [part.strip() for part in house['Address'].split(',')]
            start = next((i for i, part in enumerate(parts) if re.search(
                r'улиц|переул|просп|проезд|шоссе|бульвар|набереж|площад|алле|тупик|микрорайон|квартал', part, re.I)), max(0, len(parts) - 2))
            addresses[house['UNOM']] = ', '.join(parts[start:])
    print('Indexed company rows:', min(skip + 500, metadata['ItemsCount']))
payload = {'fetchedAt': datetime.now(timezone.utc).isoformat(), 'version': version,
    'release': release, 'companies': companies, 'addresses': sorted(addresses.items())}
target = Path('src/infrastructure/data/moscowHouseIndex.json')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('Public house references:', sum(len(company['unoms']) for company in companies), 'Bytes:', target.stat().st_size)
