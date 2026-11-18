/** Verified published work, separate from a survey of the building's current condition. */
export interface BuildingMaintenanceWork {
  name: string;
  status: 'completed' | 'in-progress' | 'planned' | 'cancelled' | 'unknown';
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  year?: number;
}

/** Public source attribution travels with cached data and never contains an API key. */
export interface BuildingMaintenance {
  works: BuildingMaintenanceWork[];
  sourceUrl: string;
  sourceName: string;
  fetchedAt: string;
}
