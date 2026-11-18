// src/presentation/components/ShareModal.tsx
import { useEffect, useState } from 'react';
import { encodeSharedWalk, type SharedWalk } from '../../shared/integration';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';

interface ShareModalProps {
  walk: SharedWalk;
  onClose(): void;
}

export function ShareModal({ walk, onClose }: ShareModalProps) {
  const sheetRef = useSwipeDismiss<HTMLDivElement>(onClose);
  const [copied, setCopied] = useState(false);
  const encoded = encodeSharedWalk(walk);
  const importBase = import.meta.env.VITE_IMPORT_BASE_URL as string | undefined;
  const importUrl = new URL(importBase || 'https://www.codoc.site/start/tours');
  importUrl.searchParams.set('walk', encoded);
  const finalUrl = importUrl.href;
  const params = new URLSearchParams(location.search);
  const channel = params.get('channel');
  const embedded = params.get('embed') === 'codoc' && window.parent !== window && channel;
  const complete = walk.route?.legs?.length === walk.points.length - 1 && walk.points.length >= 2;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(finalUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard может быть недоступен */
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={sheetRef} className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Включить в общий маршрут</h2>
        <p className="modal__hint">
          Прогулка «{walk.title}» готова. Ссылка ниже откроет её в основном продукте —
          там можно объединить с другими прогулками и сгенерировать PDF.
        </p>
        <div className="modal__link">
          <input type="text" value={finalUrl} readOnly />
          <button type="button" className="btn btn--primary" onClick={copy}>
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
        <div className="modal__actions">
          {embedded && <button type="button" className="btn btn--primary" disabled={!complete} onClick={() => {
            window.parent.postMessage({ type: 'private-walk:complete', channel, walk }, window.location.origin);
          }}>Добавить в путешествие CoDoc</button>}
          {embedded && !complete && <p>Сначала постройте полный маршрут между выбранными точками.</p>}
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
