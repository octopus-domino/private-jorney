export type GpsMode = 'economy' | 'balanced' | 'precise';

/** Strategy presets trade sampling detail for battery life; acquisition always starts with a bounded precise fix. */
export const GPS_MODES = {
  economy: { title: 'Экономный', description: 'Реже получает точки, бережёт батарею. Повороты могут сглаживаться.', intervalMs: 30000, distanceMeters: 20, maxAccuracy: 150, highAccuracy: false },
  balanced: { title: 'Сбалансированный', description: 'Для обычной прогулки: точность без постоянного опроса GPS.', intervalMs: 10000, distanceMeters: 8, maxAccuracy: 75, highAccuracy: true },
  precise: { title: 'Точный', description: 'Частые точки и активный GPS. Расход батареи выше.', intervalMs: 3000, distanceMeters: 2, maxAccuracy: 35, highAccuracy: true },
} as const;

/** Unknown preferences from older builds fall back to the ordinary walking mode. */
export function gpsMode(value: unknown): GpsMode {
  return value === 'economy' || value === 'precise' ? value : 'balanced';
}
