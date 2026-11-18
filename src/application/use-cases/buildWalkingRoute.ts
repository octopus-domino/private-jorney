// src/application/use-cases/buildWalkingRoute.ts
import type { Poi } from '../../domain/Poi';
import type { WalkingRoute, WalkingRouteLeg } from '../../domain/WalkingRoute';
import type { RoutePlanner } from '../ports/RoutePlanner';

export interface BuildRouteResult {
  route: WalkingRoute;
  /** индексы сегментов (fromIndex), которые не удалось построить */
  failedSegments: number[];
  /** текст последней ошибки — для показа пользователю */
  lastError: string | null;
}

/**
 * Последовательно строит маршрут по парам точек.
 * Бэк /api/journeys/routes/road принимает только {start, end, mode},
 * поэтому N точек = N-1 запросов.
 *
 * Если сегмент не построился — НЕ подставляем прямую линию:
 * помечаем его в failedSegments и продолжаем. В UI это покажется
 * предупреждением, а линия между такими точками будет серой.
 */
export async function buildWalkingRoute(
  pois: Poi[],
  planner: RoutePlanner,
  onProgress?: (current: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BuildRouteResult> {
  if (pois.length < 2) throw new Error('Для маршрута нужно минимум две точки');

  const legs: WalkingRouteLeg[] = [];
  const failedSegments: number[] = [];
  const geometry: Array<[number, number]> = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let lastError: string | null = null;

  for (let i = 0; i < pois.length - 1; i += 1) {
    signal?.throwIfAborted();
    onProgress?.(i + 1, pois.length - 1);
    try {
      const leg = await planner.buildWalkingRoute(
        { lat: pois[i].lat, lng: pois[i].lng },
        { lat: pois[i + 1].lat, lng: pois[i + 1].lng },
        signal,
      );
      const segment: WalkingRouteLeg = {
        fromIndex: i,
        toIndex: i + 1,
        distanceMeters: leg.totalDistanceMeters,
        durationSeconds: leg.totalDurationSeconds,
        geometry: leg.geometry,
      };
      legs.push(segment);
      geometry.push(...leg.geometry);
      totalDistance += segment.distanceMeters;
      totalDuration += segment.durationSeconds;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      failedSegments.push(i);
      // Не рисуем прямую — оставляем пустой geometry, MapView отрисует
      // серую пунктирную «не найдено» между этими точками.
      legs.push({
        fromIndex: i,
        toIndex: i + 1,
        distanceMeters: 0,
        durationSeconds: 0,
        geometry: [],
      });
    }
  }

  return {
    route: {
      legs,
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      geometry,
    },
    failedSegments,
    lastError,
  };
}