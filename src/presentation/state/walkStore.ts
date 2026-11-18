// src/presentation/state/walkStore.ts
import { create } from 'zustand';
import type { AnchorPoint } from '../../domain/SearchArea';
import type { Poi } from '../../domain/Poi';
import type { PlaceInfo } from '../../domain/PlaceInfo';
import type { WalkDraft, PlanView } from '../../domain/WalkDraft';
import type { WalkingRoute } from '../../domain/WalkingRoute';
import { newId } from '../../shared/id';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PendingSpot {
  lat: number;
  lng: number;
}

interface WalkState {
  draft: WalkDraft;
  /** Все точки на карте: custom + pinned (выбранные) + fetched из API. */
  pois: Poi[];
  /** Пользовательские точки, добавленные через «В маршрут» в карточке «Узнать». */
  customPois: Poi[];
  /**
   * Копии выбранных точек. Хранятся отдельно, чтобы:
   *  - при сужении радиуса выбранные точки не исчезали с карты;
   *  - маршрут оставался валидным (все его точки есть в pois);
   *  - loading-фаза не «размывала» selection при перезагрузке выборки.
   * Очищается, когда пользователь снимает выбор с точки.
   */
  pinnedPois: Poi[];
  poisStatus: LoadStatus;
  poisError: string | null;
  osmLost: boolean;
  route: WalkingRoute | null;
  routeStatus: LoadStatus;
  routeError: string | null;
  routeFailedSegments: number[];
  routeProgress: { current: number; total: number } | null;
  entryError: string | null;

  pendingSpot: PendingSpot | null;
  spotInfo: PlaceInfo | null;
  spotStatus: 'idle' | 'loading' | 'ready' | 'error';
  poiDetailId: string | null;

  setTitle(title: string): void;
  setView(view: PlanView): void;

  addAnchor(anchor: AnchorPoint): void;
  updateAnchor(id: string, patch: Partial<Pick<AnchorPoint, 'lat' | 'lng' | 'label'>>): void;
  removeAnchor(id: string): void;
  setRadius(meters: number): void;

  toggleCategory(id: string): void;
  togglePoi(id: string): void;
  movePoi(id: string, direction: -1 | 1): void;
  addCustomPoi(poi: Poi): void;

  setPois(pois: Poi[], status: LoadStatus, error?: string | null): void;
  beginPoisFetch(): void;
  setOsmLost(lost: boolean): void;
  setRoute(route: WalkingRoute | null, status: LoadStatus, error?: string | null, failed?: number[]): void;
  setRouteProgress(progress: { current: number; total: number } | null): void;
  setEntryError(message: string | null): void;

  setSpotPending(point: PendingSpot): void;
  setSpotInfo(info: PlaceInfo | null, status: 'ready' | 'error'): void;
  clearSpot(): void;

  openPoiDetail(id: string): void;
  closePoiDetail(): void;

  hydrate(draft: WalkDraft): void;
  createNewDraft(): void;
}

export function createDraft(): WalkDraft {
  const now = new Date().toISOString();
  return {
    id: newId('walk'),
    title: 'Моя прогулка',
    area: { anchors: [], radiusMeters: 800 },
    selectedCategoryIds: ['historical-house'],
    selectedPoiIds: [],
    view: 'map',
    createdAt: now,
    updatedAt: now,
  };
}

function patchDraft(draft: WalkDraft, patch: Partial<WalkDraft>): WalkDraft {
  return { ...draft, ...patch, updatedAt: new Date().toISOString() };
}

function clearRouteState() {
  return {
    route: null,
    routeStatus: 'idle' as LoadStatus,
    routeError: null,
    routeFailedSegments: [] as number[],
    routeProgress: null,
  };
}

/** Мерж нескольких источников без дублей по id. Побеждает первый источник. */
function mergePois(...sources: Poi[][]): Poi[] {
  const byId = new Map<string, Poi>();
  for (const source of sources) {
    for (const p of source) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  return Array.from(byId.values());
}

export const useWalkStore = create<WalkState>((set, get) => ({
  draft: createDraft(),
  pois: [],
  customPois: [],
  pinnedPois: [],
  poisStatus: 'idle',
  poisError: null,
  osmLost: false,
  route: null,
  routeStatus: 'idle',
  routeError: null,
  routeFailedSegments: [],
  routeProgress: null,
  entryError: null,

  pendingSpot: null,
  spotInfo: null,
  spotStatus: 'idle',
  poiDetailId: null,

  setTitle(title) {
    set({ draft: patchDraft(get().draft, { title }) });
  },

  setView(view) {
    set({ draft: patchDraft(get().draft, { view }) });
  },

  addAnchor(anchor) {
    const anchors = [...get().draft.area.anchors, anchor];
    set({
      draft: patchDraft(get().draft, {
        area: { ...get().draft.area, anchors },
      }),
    });
  },

  updateAnchor(id, patch) {
    const anchors = get().draft.area.anchors.map((a) =>
      a.id === id ? { ...a, ...patch } : a,
    );
    set({
      draft: patchDraft(get().draft, {
        area: { ...get().draft.area, anchors },
      }),
    });
    // Движение якоря меняет область — маршрут становится неактуальным.
    set(clearRouteState());
  },

  removeAnchor(id) {
    const anchors = get().draft.area.anchors.filter((a) => a.id !== id);
    set({
      draft: patchDraft(get().draft, {
        area: { ...get().draft.area, anchors },
      }),
    });
  },

  /**
   * ВАЖНО: смена радиуса НЕ трогает ни selectedPoiIds, ни маршрут.
   * Точки за пределами нового радиуса остаются на карте (pinnedPois),
   * маршрут сохраняется как есть — перестроится только по явному клику.
   */
  setRadius(meters) {
    set({
      draft: patchDraft(get().draft, {
        area: { ...get().draft.area, radiusMeters: meters },
      }),
    });
  },

  toggleCategory(id) {
    const selected = get().draft.selectedCategoryIds;
    const next = selected.includes(id)
      ? selected.filter((c) => c !== id)
      : [...selected, id];
    set({ draft: patchDraft(get().draft, { selectedCategoryIds: next }) });
  },

  togglePoi(id) {
    const current = get().draft.selectedPoiIds;
    const isSelecting = !current.includes(id);
    const next = isSelecting
      ? [...current, id]
      : current.filter((p) => p !== id);

    // Pin/unpin: выбранная точка должна пережить сужение радиуса
    // и перезагрузку выборки, иначе маршрут «потеряет» её из вида.
    let pinnedPois = get().pinnedPois;
    if (isSelecting) {
      if (!pinnedPois.some((p) => p.id === id)) {
        const poi = get().pois.find((p) => p.id === id);
        if (poi) pinnedPois = [...pinnedPois, poi];
      }
    } else {
      pinnedPois = pinnedPois.filter((p) => p.id !== id);
    }

    set({
      pinnedPois,
      draft: patchDraft(get().draft, { selectedPoiIds: next }),
    });
    set(clearRouteState());
  },

  movePoi(id, direction) {
    const selected = [...get().draft.selectedPoiIds];
    const index = selected.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= selected.length) return;
    [selected[index], selected[target]] = [selected[target], selected[index]];
    set({ draft: patchDraft(get().draft, { selectedPoiIds: selected }) });
    set(clearRouteState());
  },

  addCustomPoi(poi) {
    const customPois = get().customPois.some((p) => p.id === poi.id)
      ? get().customPois
      : [...get().customPois, poi];
    const pinnedPois = get().pinnedPois.some((p) => p.id === poi.id)
      ? get().pinnedPois
      : [...get().pinnedPois, poi];
    const selectedPoiIds = get().draft.selectedPoiIds.includes(poi.id)
      ? get().draft.selectedPoiIds
      : [...get().draft.selectedPoiIds, poi.id];

    set({
      customPois,
      pinnedPois,
      pois: mergePois(pinnedPois, customPois, get().pois),
      draft: patchDraft(get().draft, { selectedPoiIds }),
    });
    set(clearRouteState());
  },

  setPois(pois, status, error = null) {
    // Порядок мержа: pinned → custom → fetched.
    // Pinned идут первыми, чтобы выбранные точки не терялись,
    // даже если API при сужении радиуса их не вернул.
    const merged = mergePois(get().pinnedPois, get().customPois, pois);

    // Из selectedPoiIds не удаляем ничего, если объект poi для точки
    // остался в merged. Благодаря pinnedPois — выбранные точки всегда там.
    const present = new Set(merged.map((p) => p.id));
    const filtered = get().draft.selectedPoiIds.filter((id) => present.has(id));

    set({
      pois: merged,
      poisStatus: status,
      poisError: error,
      draft: patchDraft(get().draft, { selectedPoiIds: filtered }),
    });

    // Маршрут сбрасываем только при явной ошибке загрузки.
    // Смена набора точек (радиус/категории/загрузка) — не повод терять маршрут.
    // Search errors must not discard an existing route.
  },

  /**
   * Начать перезагрузку выборки: сохраняет текущие `pois`,
   * только ставит статус 'loading'. Используется в usePoisQuery вместо
   * `setPois([], 'loading')`, чтобы не мигал список во время загрузки.
   */
  beginPoisFetch() {
    set({ poisStatus: 'loading', poisError: null });
  },

  setOsmLost(lost) {
    set({ osmLost: lost });
  },

  setRoute(route, status, error = null, failed = []) {
    set({
      route,
      routeStatus: status,
      routeError: error,
      routeFailedSegments: failed,
    });
  },

  setRouteProgress(progress) {
    set({ routeProgress: progress });
  },

  setEntryError(message) {
    set({ entryError: message });
  },

  setSpotPending(point) {
    set({ pendingSpot: point, spotInfo: null, spotStatus: 'loading' });
  },

  setSpotInfo(info, status) {
    set({ spotInfo: info, spotStatus: status });
  },

  clearSpot() {
    set({ pendingSpot: null, spotInfo: null, spotStatus: 'idle' });
  },

  openPoiDetail(id) {
    set({ poiDetailId: id });
  },

  closePoiDetail() {
    set({ poiDetailId: null });
  },

  hydrate(draft) {
    set({
      draft,
      pois: draft.savedPois ?? [],
      customPois: (draft.savedPois ?? []).filter((p) => p.source === 'manual'),
      pinnedPois: (draft.savedPois ?? []).filter((p) => draft.selectedPoiIds.includes(p.id)),
      poisStatus: 'idle',
      osmLost: false,
      pendingSpot: null,
      spotInfo: null,
      spotStatus: 'idle',
      poiDetailId: null,
      ...clearRouteState(),
      route: draft.savedRoute ?? null,
      routeStatus: draft.savedRoute ? ((draft.savedFailedSegments?.length ?? 0) > 0 ? 'error' : 'ready') : 'idle',
      routeFailedSegments: draft.savedFailedSegments ?? [],
    });
  },

  createNewDraft() {
    set({
      draft: createDraft(),
      pois: [],
      customPois: [],
      pinnedPois: [],
      poisStatus: 'idle',
      osmLost: false,
      pendingSpot: null,
      spotInfo: null,
      spotStatus: 'idle',
      poiDetailId: null,
      ...clearRouteState(),
    });
  },
}));
