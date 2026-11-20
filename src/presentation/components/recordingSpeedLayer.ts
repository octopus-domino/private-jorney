import L from 'leaflet';
import { walkSpeedLegend, type WalkSpeedSpan } from '../../domain/walkSpeed';

export function paintWalkSpeed(layer: L.Map | L.LayerGroup, spans: WalkSpeedSpan[]) {
  for (const span of spans) {
    const color = walkSpeedLegend.find((entry) => entry.id === span.band)?.color;
    L.polyline(span.points.map(({ lat, lng }) => [lat, lng]), {
      color, weight: span.band === 'unknown' ? 3 : 5,
      dashArray: span.band === 'unknown' ? '5 7' : undefined, interactive: false,
      className: `walk-speed-line walk-speed-line--${span.band}`,
    }).addTo(layer);
  }
}
