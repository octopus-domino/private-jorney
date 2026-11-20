import type { Poi } from '../../domain/Poi';
import type { PoiRepository, PoiSearchParams } from '../ports/PoiRepository';
import { haversineMeters } from '../../shared/geo';

export interface AreaSearchUpdate { points: Poi[]; status: 'loading' | 'ready' | 'error'; error?: string }
// Cold codoc queries can legitimately exceed twenty seconds; only an actual stalled session is stopped.
export const INCOMPLETE_AREA_MESSAGE = 'Часть области не проверена.';
export const SEARCH_TIMEOUT_MS = 90000;

/** One filter revision owns one cancellable session; late responses cannot restore an obsolete selection. */
export class AreaSearchSession {
  private readonly controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private finished = false;
  private points: Poi[] = [];
  private incomplete = false;

  constructor(private readonly repository: PoiRepository, private readonly params: PoiSearchParams,
    private readonly notify: (update: AreaSearchUpdate) => void, private readonly timeout = SEARCH_TIMEOUT_MS,
    initialPoints: Poi[] = []) { this.points = this.filter(initialPoints); }

  /** Clears the previous discovery immediately and publishes each successfully completed source. */
  start(): () => void {
    this.notify({ points: this.points, status: 'loading' });
    this.timer = setTimeout(() => this.expire(), this.timeout);
    void this.repository.search({ ...this.params, signal: this.controller.signal,
      onPartial: points => this.partial(points), onIncomplete: () => { this.incomplete = true; } })
      .then(points => this.finish({
        points: this.incomplete ? this.merge(points) : this.filter(points), status: 'ready',
        error: this.incomplete ? INCOMPLETE_AREA_MESSAGE : undefined,
      }))
      .catch(error => this.finish({ points: this.points, status: this.points.length ? 'ready' : 'error',
        error: error instanceof Error ? error.message : 'Не удалось загрузить места.' }));
    return () => { this.finished = true; clearTimeout(this.timer); this.controller.abort(); };
  }

  private partial(points: Poi[]) {
    if (this.finished) return;
    this.points = this.merge(points);
    this.notify({ points: this.points, status: 'loading' });
  }

  private merge(points: Poi[]): Poi[] {
    return this.filter([...new Map([...this.points, ...points].map(point => [point.id, point])).values()]);
  }

  private filter(points: Poi[]): Poi[] {
    return points.filter(point => point.categoryIds.some(category => this.params.categoryIds.includes(category))
      && this.params.anchors.some(anchor => haversineMeters(anchor, point) <= this.params.radiusMeters + 10));
  }

  private expire() {
    this.finish({ points: this.points, status: this.points.length ? 'ready' : 'error',
      error: this.points.length ? 'Часть источников не успела ответить.' : 'Поиск занял слишком много времени. Измените область или повторите поиск.' });
    this.controller.abort();
  }

  private finish(update: AreaSearchUpdate) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.notify(update);
  }
}
