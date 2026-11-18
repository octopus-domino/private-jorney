import type { BuildingMaintenance } from './BuildingMaintenance';

export interface BuildingProfile {
  passportStatus?: 'updating' | 'not-published';
  maintenance?: BuildingMaintenance;
  maintenanceUnavailable?: boolean;
  address: string;
  sourceUrl: string;
  sourceName?: string;
  fetchedAt: string;
  location?: { lat: number; lng: number };
  yearBuilt: number | null;
  floors: number | null;
  residents: number | null;
  communalFlats: number | null;
  separateFlats: number | null;
  ages: { children: number | null; working: number | null; older: number | null };
  repairs: { year: number; work: string }[];
  wear: Record<string, number>;
  features: { label: string; value: string; detail?: string }[];
  plans: { work: string; startYear: number; endYear: number }[];
  plansAvailable: boolean;
}
