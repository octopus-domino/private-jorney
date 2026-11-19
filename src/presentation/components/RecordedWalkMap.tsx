import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RecordedWalk } from '../../domain/RecordedWalk';
import { recordedWalkPath, hasRecordedMovement, walkPreview } from '../../domain/walkPreview';
import { haversineMeters } from '../../shared/geo';
import { MapTileCache } from '../../infrastructure/persistence/mapTileCache';

const tiles = new MapTileCache();

/** Displays saved GPS on a real map; opening a report starts no GPS watcher or place search. */
export function RecordedWalkMap({ walk }: { walk: RecordedWalk }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const path = recordedWalkPath(walk);
  const pathKey = JSON.stringify(path);
  useEffect(() => {
    setReady(false); setFailed(false);
    if (!container.current || !path.length) return;
    const map = L.map(container.current, { scrollWheelZoom: false, attributionControl: false });
    L.control.attribution({ prefix: false }).addTo(map);
    const controller = new AbortController();
    const layer = new ReportTiles(controller.signal, () => setReady(true), () => setFailed(true));
    layer.addTo(map);
    paintRecording(map, path);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); controller.abort(); map.remove(); };
  // Geometry, rather than optional description updates, owns map lifetime and network requests.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walk.id, pathKey]);
  return <div className="walk-report-map" role="region" aria-label="Карта записанной прогулки">
    <img className="walk-report__preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(walkPreview(path))}`}
      alt="Сохранённая схема записи" hidden={ready} />
    <div ref={container} className="walk-report-map__canvas" style={{ opacity: ready ? 1 : 0 }} />
    {!ready && <span className="walk-report-map__notice">{failed ? 'Карта района недоступна. Показана сохранённая схема.' : path.length ? 'Загружаем карту района…' : 'Местоположение не записано.'}</span>}
  </div>;
}

class ReportTiles extends L.TileLayer {
  constructor(private readonly signal: AbortSignal, private readonly loaded: () => void, private readonly failed: () => void) {
    super('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' });
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const image = document.createElement('img');
    image.alt = ''; image.setAttribute('role', 'presentation');
    void tiles.read(this.getTileUrl(coords), this.signal).then(blob => {
      if (this.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      image.onload = () => { URL.revokeObjectURL(url); if (!this.signal.aborted) { this.loaded(); done(undefined, image); } };
      image.onerror = () => { URL.revokeObjectURL(url); if (!this.signal.aborted) { this.failed(); done(new Error('Map image unavailable'), image); } };
      image.src = url;
    }).catch(error => { if (!this.signal.aborted) { this.failed(); done(error instanceof Error ? error : new Error('Map unavailable'), image); } });
    return image;
  }
}

function paintRecording(map: L.Map, path: { lat: number; lng: number }[]): void {
  const points = path.map(point => L.latLng(point.lat, point.lng));
  const movement = hasRecordedMovement(path);
  if (movement) {
    L.polyline(points, { color: '#317559', weight: 5 }).addTo(map);
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 18 });
  } else map.setView(points[0], 17);
  const closed = movement && haversineMeters(path[0], path.at(-1)!) <= 8;
  L.circleMarker(points[0], { radius: 8, color: '#fff', weight: 3, fillColor: '#317559', fillOpacity: 1 })
    .bindTooltip(closed ? 'Начало и конец' : movement ? 'Начало' : 'Местоположение записи').addTo(map);
  if (movement) L.circleMarker(points.at(-1)!, { radius: closed ? 4 : 7, color: closed ? '#ca8349' : '#fff',
    weight: closed ? 0 : 3, fillColor: '#ca8349', fillOpacity: 1 }).bindTooltip(closed ? 'Начало и конец' : 'Конец').addTo(map);
}
