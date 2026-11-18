// src/presentation/components/RouteSummary.tsx
import type { Poi } from '../../domain/Poi';
import type { WalkingRoute } from '../../domain/WalkingRoute';
import { formatDistance, formatDuration } from '../../shared/geo';

interface RouteSummaryProps {
  pois: Poi[];
  selectedPoiIds: string[];
  route: WalkingRoute | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  failedSegments: number[];
  progress: { current: number; total: number } | null;
  onBuild(): void;
  onExport(): void;
}

export function RouteSummary({
  selectedPoiIds,
  route,
  status,
  error,
  failedSegments,
  progress,
}: RouteSummaryProps) {
  const hasPartialFailure = failedSegments.length > 0;

  if (!route && status === 'idle' && selectedPoiIds.length < 2) {
    return null;
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <span className="panel__icon" aria-hidden>🚶</span>
        <h2>Маршрут</h2>
      </header>

      {progress && (
        <p className="summary__progress">
          Сегмент {progress.current} из {progress.total}…
        </p>
      )}

      {hasPartialFailure && (
        <p className="summary__error">
          Часть маршрута не построена: {failedSegments.length} из{' '}
          {selectedPoiIds.length - 1}{' '}
          {failedSegments.length === 1 ? 'сегмента' : 'сегментов'}
          {error ? ` (${error})` : ''}
        </p>
      )}

      {error && !hasPartialFailure && <p className="summary__error">{error}</p>}

      {route && !hasPartialFailure && (
        <dl className="summary__stats">
          <div>
            <dt>Длина</dt>
            <dd>{formatDistance(route.totalDistanceMeters)}</dd>
          </div>
          <div>
            <dt>Время</dt>
            <dd>{formatDuration(route.totalDurationSeconds)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}