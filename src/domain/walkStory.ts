import type { RawWalkSession, RecordedPlace, RecordedWalk } from './RecordedWalk';
import type { GeoPoint } from './walkGraph';
import { escapeHtml } from '../shared/html';
import { haversineMeters } from '../shared/geo';
import { thinTrack } from './pathGeometry';

/** Creates a self-contained schematic; saved previews never need map tiles or a network connection. */
export function walkPreview(path: GeoPoint[]): string {
  const width = 640, height = 360, padding = 35;
  if (!path.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="640" height="360" fill="#eef2eb"/><text x="320" y="180" text-anchor="middle" fill="#365849">Нет GPS-точек</text></svg>`;
  const longitudeScale = Math.cos(path[0].lat * Math.PI / 180);
  const xs = path.map(point => point.lng * longitudeScale), ys = path.map(point => -point.lat);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const scale = Math.min((width - padding * 2) / (Math.max(...xs) - minX || 0.001),
    (height - padding * 2) / (Math.max(...ys) - minY || 0.001));
  const coordinates = path.map((_, i) => `${(padding + (xs[i] - minX) * scale).toFixed(1)},${(padding + (ys[i] - minY) * scale).toFixed(1)}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="640" height="360" rx="24" fill="#eef2eb"/><path d="M${coordinates.join(' L')}" fill="none" stroke="#317559" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${coordinates[0].split(',')[0]}" cy="${coordinates[0].split(',')[1]}" r="8" fill="#317559" stroke="white" stroke-width="3"/><circle cx="${coordinates.at(-1)!.split(',')[0]}" cy="${coordinates.at(-1)!.split(',')[1]}" r="7" fill="#ca8349" stroke="white" stroke-width="3"/></svg>`;
}

/** Produces a readable factual account without inventing atmosphere, residents or historical events. */
export function walkParagraphs(walk: Pick<RecordedWalk, 'city' | 'distanceMeters' | 'startedAt' | 'endedAt' | 'places' | 'interrupted'>): string[] {
  const date = new Date(walk.startedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const distance = walk.distanceMeters >= 1000 ? `${(walk.distanceMeters / 1000).toFixed(1).replace('.', ',')} км`
    : walk.distanceMeters > 0 ? `${Math.round(walk.distanceMeters)} м` : '';
  const duration = Math.round((walk.endedAt - walk.startedAt) / 60000);
  const introduction = `${date}${walk.city ? `, ${walk.city}` : ''}. Ваша прогулка${distance ? ` — ${distance}` : ''}${duration > 0 ? ` за ${duration} мин` : ''}.`;
  return [introduction, ...walk.places.map(placeParagraph),
    ...(walk.interrupted ? ['Запись прервалась. Сохранена та часть пути, которую успел записать телефон.'] : []),
    ...(!walk.places.length ? ['Путь сохранён. Сведения о местах можно дополнить, когда будет доступно соединение.'] : [])];
}

function placeParagraph(place: RecordedPlace): string {
  const side = { left: 'Слева по ходу прогулки', right: 'Справа по ходу прогулки', nearby: 'Рядом с маршрутом' }[place.side];
  const facts = place.history?.excerpt || place.poi.summary || place.poi.facts.join('. ');
  return `${side} — ${place.history?.title || place.poi.name}.${facts ? ` ${facts}` : ''}`;
}

/** Saves the unmodified GPS journal first; enrichment can fail or be retried without losing the walk. */
export function initialWalk(session: RawWalkSession): RecordedWalk {
  const points = session.points ?? [];
  const distance = points.reduce((sum, point, index) => sum + (index ? haversineMeters(points[index - 1], point) : 0), 0);
  const walk: RecordedWalk = { id: session.id, title: `Прогулка ${new Date(session.startedAt).toLocaleDateString('ru-RU')}`,
    startedAt: session.startedAt, endedAt: session.endedAt ?? points.at(-1)?.timestamp ?? session.startedAt,
    points, distanceMeters: distance, places: [], paragraphs: [], previewSvg: walkPreview(thinTrack(points)),
    status: 'saved', interrupted: session.state !== 'stopped' };
  return { ...walk, paragraphs: walkParagraphs(walk) };
}

/** Text export is generated from local facts and can be shared without disclosing the full GPS journal. */
export function storyHtml(walk: RecordedWalk): string {
  return `<h1>${escapeHtml(walk.title)}</h1>${walk.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}`;
}
