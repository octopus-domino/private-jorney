import { useState } from 'react';
import { useRecordingStore } from '../state/recordingStore';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { recordedWalks } from '../../infrastructure';
import type { RecordedWalk } from '../../domain/RecordedWalk';

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
            <p>{state.active ? state.session?.pointCount ? 'Координаты сохраняются в телефоне.' : 'Ждём точное местоположение. Лучше выйти на открытое место.'
              : 'Нажмите «Начать», гуляйте, а в конце нажмите «Завершить». Путь и рассказ о местах останутся у вас.'}</p>
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
              <img src={svgUrl(record.previewSvg)} alt="Схема пройденного пути" />
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
  return <article className="walk-report">
    <button className="journey-link" onClick={onBack}>← Все записи</button>
    <h3>{walk.title}</h3>
    <img className="walk-report__preview" src={svgUrl(walk.previewSvg)} alt="Схема вашей прогулки: зелёная точка — начало, охристая — конец" />
    <p className="journey-muted">Схема пути · начало — зелёная точка, конец — охристая. Доступна без интернета.</p>
    {walk.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    {walk.places.map(place => <div className="walk-report__source" key={place.poi.id}>
      <strong>{place.history?.title || place.poi.name}</strong>
      {(place.photoDataUrl || place.history?.imageUrl) && <img loading="lazy" src={place.photoDataUrl || place.history?.imageUrl} alt={place.poi.name} referrerPolicy="no-referrer" />}
      {(place.history?.sourceUrl || place.poi.details?.sourceUrl) && <a href={place.history?.sourceUrl || place.poi.details?.sourceUrl} target="_blank" rel="noreferrer">{place.history?.sourceName || 'Открыть источник'}</a>}
    </div>)}
    {walk.status !== 'ready' && <p className="journey-muted">Часть сведений пока недоступна. Сохранённые путь и текст останутся на устройстве; фотографии из источников могут требовать интернет.</p>}
    <button className="journey-button journey-button--secondary" disabled={processing || !walk.points.length} onClick={() => void enrich(walk.id)}>{processing ? 'Дополняем рассказ…' : 'Дополнить рассказ'}</button>
  </article>;
}

function svgUrl(svg: string) { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
