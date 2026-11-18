"""Build the offline index from the supplied export; session headers never enter application assets."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'scripts/citywalls_objects.json'
rows = json.loads(source.read_text(encoding='utf-8-sig'))
points = {}
for row in rows:
    identity, latitude, longitude = int(row['id']), float(row['lat']), float(row['lon'])
    if identity > 0 and -90 <= latitude <= 90 and -180 <= longitude <= 180:
        points[identity] = [identity, round(latitude, 6), round(longitude, 6)]
output = ROOT / 'src/infrastructure/data/citywallsIndex.json'
output.write_text(json.dumps(sorted(points.values(), key=lambda p: p[1]), separators=(',', ':')), encoding='utf-8')
print(f'Offline Citywalls index: {len(points)} objects, {output.stat().st_size} bytes')
