// СП 547.1325800.2025, п. 6.1; округление п. 6.5, примечание 2.
// Gas and lifts are explicitly excluded by paragraph 1.2.
export const MAINTENANCE_STANDARD_URL = 'https://protect.gost.ru/sp/details/788ebe69-0a3e-4e3b-a965-f7dbf5b8dad2';
export function maintenanceCategory(wear: number): 1 | 2 | 3 | 4 | null {
  if (!Number.isFinite(wear) || wear <= 0 || wear > 100) return null;
  const rounded = Math.round(wear);
  if (rounded <= 30) return 1;
  if (rounded <= 50) return 2;
  if (rounded <= 65) return 3;
  return 4;
}
export const WEAR_LABELS = {
  1: 'Небольшой износ',
  2: 'Умеренный износ',
  3: 'Высокий износ',
  4: 'Очень высокий износ',
} as const;
export const MAINTENANCE_LABELS = {
  1: 'По показателю износа капремонт пока не требуется',
  2: 'По показателю износа требуется капремонт',
  3: 'По показателю износа нужен приоритетный капремонт',
  4: 'Нужно инструментальное обследование',
} as const;
