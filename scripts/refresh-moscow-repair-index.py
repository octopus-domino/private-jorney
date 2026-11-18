"""Build public UNOM -> repair-row references without bundling contracts or API credentials."""
import json
from pathlib import Path
from curl_cffi import requests

key = next(line.split('=', 1)[1].strip() for line in Path('.env.local').read_text().splitlines()
           if line.startswith('VITE_MOS_DATA_API_KEY='))
session = requests.Session(impersonate='chrome', headers={'Accept': 'application/json'})
base = 'https://apidata.mos.ru/v1/datasets/62963'
params = {'api_key': key, '$format': 'json'}
metadata_response = session.get(base, params=params, timeout=25)
metadata_response.raise_for_status()
metadata = metadata_response.json()
version, release = (int(value) for value in metadata['VersionNumber'].split('.', 1))
houses = {}
for skip in range(0, metadata['ItemsCount'], 500):
    response = session.post(base + '/rows', params={**params, '$skip': skip, '$top': 500,
        'versionNumber': version, 'releaseNumber': release}, json=['ObjectAddress', 'UNOM', 'is_deleted'], timeout=30)
    response.raise_for_status()
    for offset, row in enumerate(response.json()):
        for address in row['Cells'].get('ObjectAddress', []):
            unom = str(address.get('UNOM', ''))
            if unom.isdigit() and int(unom) > 0 and address.get('is_deleted') != 1:
                houses.setdefault(unom, []).append([skip + offset, row['global_id']])
    print('Indexed repair rows:', min(skip + 500, metadata['ItemsCount']), flush=True)
payload = {'version': version, 'release': release, 'updatedAt': metadata.get('LastUpdateDate'), 'houses': houses}
Path('src/infrastructure/data/moscowRepairIndex.json').write_text(
    json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('Houses:', len(houses), 'Max rows per house:', max(map(len, houses.values())))
