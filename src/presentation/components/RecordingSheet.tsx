import { useState } from 'react';
import { useRecordingStore } from '../state/recordingStore';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { recordedWalks } from '../../infrastructure';
import type { RecordedPlace, RecordedWalk, RecordedWalkSection } from '../../domain/RecordedWalk';
import { GPS_MODES, type GpsMode } from '../../domain/GpsMode';
import { RecordedWalkMap } from './RecordedWalkMap';
import { hasRecordedMovement, recordedWalkPath, walkPreview } from '../../domain/walkPreview';
import { shortPlaceDescription, walkParagraphs } from '../../domain/walkStory';
import { placesInSection, walkDistance, walkSections } from '../../domain/walkSections';
import './walkTimeline.css';

/** Recording controls and local reports share a dismissible sheet on phones and a dialog on desktop. */
export function RecordingSheet({ onClose }: { onClose(): void }) {
  const ref = useSwipeDismiss<HTMLDivElement>(onClose);
  const state = useRecordingStore();
  const [selected, select] = useState<string | null>(null);
  const walk = state.records.find(record => record.id === selected);
  return <div className="modal-backdrop" onClick={onClose}>
    <div ref={ref} className="modal recording-sheet" role="dialog" aria-modal="true" aria-label="Запись прогулки" onClick={event => event.stopPropagation()}>
      <div className="sheet-grip" aria-hidden="true" />
      <div className="modal__head"><h2>{walk ? 'История прогулки' : 'Запись прогулки'}</h2><button className="app__icon-btn" aria-label="Закрыть запись прогулки" onClick={onClose}>×</button></div>
      <div className="recording-sheet__body">
        {state.error && <p role="alert" className="banner banner--warn">{state.error}</p>}
        {walk ? <WalkReport walk={walk} processing={state.processing.includes(walk.id)} onBack={() => select(null)} /> : <>
          <div className={`recording-status${state.active ? ' is-recording' : ''}`}>
            <span className="recording-status__dot" aria-hidden="true" />
            <strong>{state.active ? 'Записываем вашу прогулку' : 'Сохраните путь и его истории'}</strong>
            <label className="gps-mode">Режим GPS
              <select value={state.session?.gpsMode ?? state.gpsMode} disabled={state.active || state.busy}
                onChange={event => state.setGpsMode(event.target.value as GpsMode)}>
                {Object.entries(GPS_MODES).map(([id, mode]) => <option key={id} value={id}>{mode.title}</option>)}
              </select>
              <small>{GPS_MODES[state.session?.gpsMode ?? state.gpsMode].description}</small>
            </label>
            <p>{state.active ? state.session?.pointCount ? 'Координаты сохраняются в телефоне.' : 'Ждём точное местоположение. Лучше выйти на открытое место.'
              : 'Нажмите «Начать», гуляйте, а в конце нажмите «Завершить». Путь и рассказ о местах останутся у вас.'}</p>
            {state.active && !state.session?.pointCount && state.session?.lastAccuracy !== undefined
              && <p role="status">Сигнал получен, точность около {Math.round(state.session.lastAccuracy)} м.
                Для этого режима нужна точность до {GPS_MODES[state.session.gpsMode ?? state.gpsMode].maxAccuracy} м.</p>}
            {state.active && state.session && <p className="recording-stats">{state.session.distanceMeters > 0 && `${Math.round(state.session.distanceMeters)} м · `}{new Date(state.session.startedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — начало</p>}
            <button className={`journey-button${state.active ? ' journey-button--stop' : ''}`} disabled={state.busy}
              onClick={() => void (state.active ? state.stop() : state.start())}>{state.busy ? 'Сохраняем…' : state.active ? 'Завершить прогулку' : 'Начать запись'}</button>
            <p className="journey-muted">{recordedWalks.recorder.backgroundCapable ? 'Экран можно выключить. Остановить запись можно и из уведомления.'
              : 'В браузере держите эту вкладку открытой. Запись с выключенным экраном доступна в Android-приложении.'}</p>
          </div>
          <h3>Ваши записи</h3>
          {!state.records.length && <p className="journey-muted">Здесь появятся пройденные маршруты, картинки пути и истории домов.</p>}
          <div className="recording-list">{state.records.map(record => <article key={record.id}>
            <button className="recording-list__open" onClick={() => select(record.id)}>
              <img src={svgUrl(walkPreview(recordedWalkPath(record), record.sections))} alt="Схема пройденного пути" />
              <span><strong>{record.title}</strong><small>{state.processing.includes(record.id) ? 'Дополняем историями…' : record.places.length ? 'Места по дороге и сохранённый рассказ' : 'Путь сохранён'}</small></span>
            </button>
            <button className="app__icon-btn" aria-label={`Удалить запись ${record.title}`} disabled={state.processing.includes(record.id)} onClick={() => void state.remove(record.id)}>×</button>
          </article>)}</div>
        </>}
      </div>
    </div>
  </div>;
}

function WalkReport({ walk, processing, onBack }: { walk: RecordedWalk; processing: boolean; onBack(): void }) {
  const enrich = useRecordingStore(state => state.enrich);
  const moving = hasRecordedMovement(walk.points);
  const sections = moving ? walk.sections ?? walkSections(recordedWalkPath(walk)) : [];
  const paragraphs = walkParagraphs(walk);
  return <article className="walk-report">
    <button className="journey-link" onClick={onBack}>← Все записи</button>
    <h3>{walk.title}</h3>
    <RecordedWalkMap walk={walk} />
    <p className="journey-muted">{moving ? 'Карта записи · зелёная отметка — начало, охристая — конец. При возвращении они объединяются.'
      : 'Сохранённое местоположение · перемещение не зафиксировано.'} Просмотренные участки карты кешируются. Без подложки остаётся сохранённая схема.</p>
    <p>{paragraphs[0]}</p>
    {sections.length ? <ol className="walk-timeline" aria-label="Участки прогулки">
      {sections.map((section, index) => <WalkSection key={section.startMeters} section={section}
        places={placesInSection(walk.places, section, index === sections.length - 1)} />)}
    </ol> : <>
      {paragraphs.slice(1).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      {walk.places.map(place => <div className="walk-report__source" key={place.poi.id}><PlaceCard place={place} /></div>)}
    </>}
    {sections.length > 0 && walk.interrupted && <p>Запись прервалась. Сохранена та часть пути, которую успел записать телефон.</p>}
    {processing ? <p role="status" className="journey-muted">Уточняем путь и добавляем сведения по мере загрузки.</p>
      : walk.status !== 'ready' && <p className="journey-muted">Часть сведений пока недоступна. Путь и текст сохранены на устройстве. Фотографии из источников могут требовать интернет.</p>}
    <button className="journey-button journey-button--secondary" disabled={processing || !walk.points.length}
      onClick={() => void enrich(walk.id)}>{processing ? 'Дополняем рассказ…' : 'Обновить путь и рассказ'}</button>
  </article>;
}

function WalkSection({ section, places }: { section: RecordedWalkSection; places: RecordedPlace[] }) {
  const distance = section.endMeters - section.startMeters;
  const axis = places.length ? Math.max(90, Math.min(560, distance)) : 34;
  const nextTop = { left: 0, right: 0 };
  const cards = places.map(place => {
    const dot = Math.min(1, Math.max(0, (place.progressMeters - section.startMeters) / distance)) * axis;
    const side = place.side === 'nearby' ? (nextTop.left <= nextTop.right ? 'left' : 'right') : place.side;
    const top = Math.max(dot, nextTop[side]);
    // The marker stays at its metre position. Only cards are staggered to keep neighbours readable.
    nextTop[side] = top + (photo(place) ? 188 : 120);
    return { place, side, dot, top };
  });
  return <li className="walk-timeline__section">
    <div className="walk-timeline__header">
      <h4>{section.from} → {section.to}</h4>
      <p>{section.gpsGap ? 'Расстояние по прямой между точками записи' : section.street || 'По точкам записи'} · {walkDistance(distance)}</p>
    </div>
    <div className="walk-timeline__body" style={{ height: Math.max(axis, nextTop.left, nextTop.right) + 8 }}>
      <div className="walk-timeline__rail" style={{ height: axis }} aria-hidden="true" />
      <ol className="walk-timeline__places">
        {cards.map(({ place, side, dot, top }) => <li key={place.poi.id} className={`walk-timeline__place walk-timeline__place--${side}`}>
          <span className="walk-timeline__dot" style={{ top: dot }} aria-hidden="true" />
          <span className="walk-timeline__lead" style={{ top: dot, height: top - dot + 8 }} aria-hidden="true" />
          <div className="walk-timeline__card" style={{ top }}><PlaceCard place={place} /></div>
        </li>)}
      </ol>
    </div>
  </li>;
}

function photo(place: RecordedPlace): string | undefined {
  const candidates = [place.photoDataUrl, place.history?.imageUrl, ...(place.poi.details?.photos ?? [])];
  return candidates.find(url => typeof url === 'string' && /^(https:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(url));
}

function PlaceCard({ place }: { place: RecordedPlace }) {
  const image = photo(place);
  const title = place.history?.title || place.poi.name;
  const source = place.history?.sourceUrl || place.poi.details?.sourceUrl;
  const description = shortPlaceDescription(place);
  const side = { left: 'Слева', right: 'Справа', nearby: 'У маршрута' }[place.side];
  return <>
    <small>{side}</small>
    <strong>{title}</strong>
    {image && <img loading="lazy" src={image} alt={title} referrerPolicy="no-referrer" />}
    {description && <p>{description}</p>}
    {source && /^https?:\/\//i.test(source) &&
      <a href={source} target="_blank" rel="noreferrer">{place.history?.sourceName || 'Источник'}</a>}
  </>;
}

function svgUrl(svg: string) { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
