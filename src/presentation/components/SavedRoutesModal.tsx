// src/presentation/components/SavedRoutesModal.tsx
import type { WalkDraft } from '../../domain/WalkDraft';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { useWalkCity } from '../hooks/useWalkCity';
import { walkEndpoints } from '../../application/use-cases/walkEndpoints';

interface SavedRoutesModalProps {
  drafts: WalkDraft[];
  currentId: string;
  onLoad(id: string): void;
  onDelete(id: string): void;
  onNew(): void;
  onClose(): void;
}

function pluralizePoints(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'точка';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'точки';
  return 'точек';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (diff < day) {
      const h = Math.floor(diff / (60 * 60 * 1000));
      if (h < 1) return 'только что';
      return `${h} ч назад`;
    }
    if (diff < 7 * day) {
      const days = Math.floor(diff / day);
      return `${days} дн назад`;
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function SavedRoutesModal({
  drafts,
  currentId,
  onLoad,
  onDelete,
  onNew,
  onClose,
}: SavedRoutesModalProps) {
  const sheetRef = useSwipeDismiss<HTMLDivElement>(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        className="modal modal--saved"
        role="dialog"
        aria-modal="true"
        aria-label="Мои маршруты"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2>Мои маршруты</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="saved-routes">
          <button type="button" className="saved-route saved-route--new" onClick={onNew}>
            <span className="saved-route__new-icon" aria-hidden>+</span>
            <span className="saved-route__body">
              <span className="saved-route__title">Новый маршрут</span>
              <span className="saved-route__meta">Начать с чистого листа</span>
            </span>
          </button>

          {drafts.length === 0 && (
            <p className="saved-routes__empty">
              Сохранённых маршрутов пока нет. Всё, что вы создаёте, автоматически
              сохраняется в этом списке.
            </p>
          )}

          {drafts.map((d) => {
            const isCurrent = d.id === currentId;
            const pointCount = d.selectedPoiIds.length;
            return (
              <div
                key={d.id}
                className={`saved-route${isCurrent ? ' is-current' : ''}`}
              >
                <button
                  type="button"
                  className="saved-route__body"
                  onClick={() => onLoad(d.id)}
                  aria-label={`Открыть ${d.title}`}
                >
                  <span className="saved-route__title">
                    {d.title || 'Без названия'}
                    {isCurrent && <span className="saved-route__badge">текущий</span>}
                  </span>
                  <SavedWalkLocation draft={d} />
                  <span className="saved-route__meta">
                    {formatDate(d.updatedAt)}
                    {pointCount > 0 ? ` · ${pointCount} ${pluralizePoints(pointCount)}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="saved-route__trash"
                  onClick={() => onDelete(d.id)}
                  aria-label="Удалить"
                  title="Удалить"
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SavedWalkLocation({ draft }: { draft: WalkDraft }) {
  const city = useWalkCity(draft);
  const { from, to } = walkEndpoints(draft);
  return <span className="saved-route__location">
    <span>{city ?? 'Город не определён'}</span>
    {from && <span>От: {from}</span>}
    {to && <span>До: {to}</span>}
  </span>;
}
