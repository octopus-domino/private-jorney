// src/infrastructure/api/httpRoutePlanner.ts
import type { RoutePlanner } from '../../application/ports/RoutePlanner';
import type { WalkingRoute } from '../../domain/WalkingRoute';
import { config } from '../config';
import { codocFetch, type CodocFetch } from './codocHttp';

interface RoadResponse {
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
}

function joinUrl(base: string, path: string): string {
  return base ? `${base.replace(/\/+$/, '')}${path}` : path;
}

export class HttpRoutePlanner implements RoutePlanner {
  constructor(private readonly baseUrl: string = config.codocApiUrl, private readonly http: CodocFetch = codocFetch) {}

  async buildWalkingRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    signal?: AbortSignal,
  ): Promise<WalkingRoute> {
    const url = joinUrl(this.baseUrl, '/api/journeys/routes/road');
    const body = {
      start: { longitude: from.lng, latitude: from.lat },
      end: { longitude: to.lng, latitude: to.lat },
      mode: 'foot',
    };

    const response = await this.http(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.codocAuthToken ? { Authorization: `Bearer ${config.codocAuthToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let parsed: { error?: unknown } | null = null;
      try { parsed = JSON.parse(text) as { error?: unknown }; } catch { /* не JSON */ }
      const code =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String(parsed.error)
          : text || `route: ${response.status}`;

      console.error('[route/road] failed', {
        url,
        status: response.status,
        requestBody: body,
        responseBody: text,
      });
      throw new Error(`${response.status} ${code}`);
    }

    const data = (await response.json()) as RoadResponse;
    const geometry: Array<[number, number]> = data.coordinates.map(([lon, lat]) => [lat, lon]);

    return {
      legs: [
        {
          fromIndex: 0,
          toIndex: 1,
          distanceMeters: data.distanceMeters,
          durationSeconds: data.durationSeconds,
          geometry,
        },
      ],
      totalDistanceMeters: data.distanceMeters,
      totalDurationSeconds: data.durationSeconds,
      geometry,
    };
  }
}
