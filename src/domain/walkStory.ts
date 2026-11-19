import type { RawWalkSession, RecordedPlace, RecordedWalk } from './RecordedWalk';
import { escapeHtml } from '../shared/html';
import { haversineMeters } from '../shared/geo';
import { thinTrack } from './pathGeometry';
import { walkPreview, hasRecordedMovement } from './walkPreview';
export { walkPreview } from './walkPreview';

/** Produces a readable factual account without inventing atmosphere, residents or historical events. */
export function walkParagraphs(walk: Pick<RecordedWalk, 'city' | 'distanceMeters' | 'startedAt' | 'endedAt' | 'places' | 'interrupted'> & Partial<Pick<RecordedWalk, 'points'>>): string[] {
  const date = new Date(walk.startedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const distance = walk.distanceMeters >= 1000 ? `${(walk.distanceMeters / 1000).toFixed(1).replace('.', ',')} км`
    : walk.distanceMeters > 0 ? `${Math.round(walk.distanceMeters)} м` : '';
  const duration = Math.round((walk.endedAt - walk.startedAt) / 60000);
  const stationary = walk.points?.length && !hasRecordedMovement(walk.points);
  const introduction = `${date}${walk.city ? `, ${walk.city}` : ''}. ${stationary ? 'Запись местоположения' : 'Ваша прогулка'}${!stationary && distance ? ` — ${distance}` : ''}${duration > 0 ? ` за ${duration} мин` : ''}.`;
  return [introduction, ...walk.places.map(placeParagraph),
    ...(walk.interrupted ? ['Запись прервалась. Сохранена та часть пути, которую успел записать телефон.'] : []),
    ...(stationary ? ['Сохранено местоположение. Перемещение не зафиксировано; отдельный путь не построен.']
      : !walk.places.length ? ['Путь сохранён. Сведения о местах можно дополнить, когда будет доступно соединение.'] : [])];
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
