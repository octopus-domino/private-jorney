import type { RawWalkSession, RecordedPlace, RecordedWalk } from './RecordedWalk';
import { escapeHtml } from '../shared/html';
import { haversineMeters } from '../shared/geo';
import { walkPreview, hasRecordedMovement, recordedWalkPath } from './walkPreview';
import { placesInSection, walkDistance, walkSections } from './walkSections';
export { walkPreview } from './walkPreview';

/** Produces a readable factual account without inventing atmosphere, residents or historical events. */
export function walkParagraphs(walk: Pick<RecordedWalk, 'city' | 'distanceMeters' | 'startedAt' | 'endedAt' | 'places' | 'interrupted'> & Partial<Pick<RecordedWalk, 'points'>>): string[] {
  const date = new Date(walk.startedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const distance = walk.distanceMeters > 0 ? walkDistance(walk.distanceMeters) : '';
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

/** Retains the first factual sentence (or a short extract of a long unpunctuated fact). */
export function shortPlaceDescription(place: RecordedPlace): string {
  const facts = place.history?.excerpt || place.poi.summary || place.poi.facts.join('. ');
  const sentence = facts.trim().split(/(?<=[.!?])\s+(?=[А-ЯA-ZЁ])/u)[0];
  return sentence.length <= 150 ? sentence : `${sentence.slice(0, 150).replace(/\s+\S*$/, '')}…`;
}

/** Saves the unmodified GPS journal first; enrichment can fail or be retried without losing the walk. */
export function initialWalk(session: RawWalkSession): RecordedWalk {
  const points = session.points ?? [];
  const distance = points.reduce((sum, point, index) => sum + (index ? haversineMeters(points[index - 1], point) : 0), 0);
  const walk: RecordedWalk = { id: session.id, title: `Прогулка ${new Date(session.startedAt).toLocaleDateString('ru-RU')}`,
    startedAt: session.startedAt, endedAt: session.endedAt ?? points.at(-1)?.timestamp ?? session.startedAt,
    points, distanceMeters: distance, places: [], paragraphs: [], previewSvg: '',
    status: 'saved', interrupted: session.state !== 'stopped' };
  const path = recordedWalkPath(walk);
  return { ...walk, previewSvg: walkPreview(path), paragraphs: walkParagraphs(walk),
    sections: hasRecordedMovement(points) ? walkSections(path) : [] };
}

/** Text export is generated from local facts and can be shared without disclosing the full GPS journal. */
export function storyHtml(walk: RecordedWalk): string {
  const sections = walk.sections ?? [];
  const heading = `<h1>${escapeHtml(walk.title)}</h1>`;
  const paragraphs = (text: string[]) => text.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
  if (!sections.length) return heading + paragraphs(walk.paragraphs);
  return heading + paragraphs(walk.paragraphs.slice(0, 1)) + sections.map((section, index) =>
    `<section><h2>${escapeHtml(section.from)} → ${escapeHtml(section.to)}</h2>`
    + paragraphs([section.street, walkDistance(section.endMeters - section.startMeters)].filter((value): value is string => !!value))
    + paragraphs(placesInSection(walk.places, section, index === sections.length - 1).map(placeParagraph)) + '</section>').join('')
    + (walk.interrupted ? paragraphs(walk.paragraphs.slice(1 + walk.places.length)) : '');
}
