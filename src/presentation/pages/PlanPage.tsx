import { INCOMPLETE_AREA_MESSAGE } from '../../application/use-cases/areaSearchSession';
// src/presentation/pages/PlanPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apartmentListingsRepository, draftStore, placeInfoRepository, routePlanner } from '../../infrastructure';
import { buildWalkingRoute } from '../../application/use-cases/buildWalkingRoute';
import { snapshotWalk } from '../../application/use-cases/snapshotWalk';
import { resolveEntryPoints } from '../../application/use-cases/resolveEntryPoints';
import { createReadyWalk } from '../../application/use-cases/openReadyWalk';
import { ReadyWalks } from '../components/ReadyWalks';
import { exportSharedWalk } from '../../application/use-cases/exportSharedWalk';
import type { Poi } from '../../domain/Poi';
import type { WalkDraft } from '../../domain/WalkDraft';
import type { AnchorPoint } from '../../domain/SearchArea';
import { formatDistance } from '../../shared/geo';
import { newId } from '../../shared/id';
import { useWalkStore } from '../state/walkStore';
import { usePoisQuery } from '../hooks/usePoisQuery';
import { useUrlSync } from '../hooks/useUrlSync';
import { MapView } from '../components/MapView';
import { PoiList } from '../components/PoiList';
import { CategoryPicker } from '../components/CategoryPicker';
import { RadiusSlider } from '../components/RadiusSlider';
import { ViewToggle } from '../components/ViewToggle';
import { EntryPanel } from '../components/EntryPanel';
import { RouteSummary } from '../components/RouteSummary';
import { LegendBar } from '../components/LegendBar';
import { ShareModal } from '../components/ShareModal';
import { SpotCard } from '../components/SpotCard';
import { PoiDetailCard } from '../components/PoiDetailCard';
import { SavedRoutesModal } from '../components/SavedRoutesModal';
import { GeolocateButton } from '../components/GeolocateButton';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { useWalkCity } from '../hooks/useWalkCity';
import { FavoritesModal } from '../components/FavoritesModal';
import { useFavoritesStore } from '../state/favoritesStore';
import { useMapViewportStore } from '../state/mapViewportStore';
import { useCianMapSearch } from '../hooks/useCianMapSearch';
import { useRecordingStore } from '../state/recordingStore';

function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}


export function PlanPage({ onHome, onRecord }: { onHome?(): void; onRecord?(): void }) {
  const recordingActive = useRecordingStore(state => state.active);
  const recordedPath = useRecordingStore(state => state.livePath);
  const draft = useWalkStore((s) => s.draft);
  const pois = useWalkStore((s) => s.pois);
  const poisStatus = useWalkStore((s) => s.poisStatus);
  const poisError = useWalkStore((s) => s.poisError);
  const osmLost = useWalkStore((s) => s.osmLost);
  const route = useWalkStore((s) => s.route);
  const routeStatus = useWalkStore((s) => s.routeStatus);
  const routeError = useWalkStore((s) => s.routeError);
  const routeFailedSegments = useWalkStore((s) => s.routeFailedSegments);
  const routeProgress = useWalkStore((s) => s.routeProgress);
  const entryError = useWalkStore((s) => s.entryError);
  const pendingSpot = useWalkStore((s) => s.pendingSpot);
  const spotInfo = useWalkStore((s) => s.spotInfo);
  const spotStatus = useWalkStore((s) => s.spotStatus);
  const poiDetailId = useWalkStore((s) => s.poiDetailId);

  const setTitle = useWalkStore((s) => s.setTitle);
  const setView = useWalkStore((s) => s.setView);
  const addAnchor = useWalkStore((s) => s.addAnchor);
  const updateAnchor = useWalkStore((s) => s.updateAnchor);
  const removeAnchor = useWalkStore((s) => s.removeAnchor);
  const setRadius = useWalkStore((s) => s.setRadius);
  const toggleCategory = useWalkStore((s) => s.toggleCategory);
  const togglePoi = useWalkStore((s) => s.togglePoi);
  const movePoi = useWalkStore((s) => s.movePoi);
  const addCustomPoi = useWalkStore((s) => s.addCustomPoi);
  const setRoute = useWalkStore((s) => s.setRoute);
  const setRouteProgress = useWalkStore((s) => s.setRouteProgress);
  const setEntryError = useWalkStore((s) => s.setEntryError);
  const hydrate = useWalkStore((s) => s.hydrate);
  const createNewDraft = useWalkStore((s) => s.createNewDraft);
  const setSpotPending = useWalkStore((s) => s.setSpotPending);
  const setSpotInfo = useWalkStore((s) => s.setSpotInfo);
  const clearSpot = useWalkStore((s) => s.clearSpot);
  const openPoiDetail = useWalkStore((s) => s.openPoiDetail);
  const closePoiDetail = useWalkStore((s) => s.closePoiDetail);

  const [hydrated, setHydrated] = useState(false);
  const [shareWalk, setShareWalk] = useState<ReturnType<typeof exportSharedWalk> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState<WalkDraft[]>([]);
  const [showOtherPois, setShowOtherPois] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [showReady, setShowReady] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [favoriteDetail, setFavoriteDetail] = useState<Poi | null>(null);
  const walkCity = useWalkCity(draft, pois);

  useEffect(() => { useFavoritesStore.getState().load(); }, []);
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number; id: string }>();
  const updateViewport = useMapViewportStore(state => state.setArea);
  useCianMapSearch(apartmentListingsRepository, draft.view === 'map' && !poiDetailId && !pendingSpot && !drawerOpen && !recordingActive);

  const sidebarRef = useSwipeDismiss<HTMLElement>(() => setDrawerOpen(false), drawerOpen);
  const readyRef = useSwipeDismiss<HTMLDivElement>(() => setShowReady(false), showReady);
  const routeAbortRef = useRef<AbortController | null>(null);
  const spotAbortRef = useRef<AbortController | null>(null);
  const pendingSpotKeyRef = useRef<string | null>(null);

  useEffect(() => {

    let cancelled = false;
    (async () => {
      // Let StrictMode cancel its first setup before mutating the store.
      await Promise.resolve();
      if (cancelled) return;
      const entry = resolveEntryPoints(window.location.search);
      if (entry.hadErrors) setEntryError('Часть параметров в ссылке проигнорирована');

      const presetId = new URLSearchParams(window.location.search).get('preset');
      const preset = presetId ? createReadyWalk(presetId) : null;
      if (preset) {
        hydrate(preset);
        const url = new URL(location.href);
        url.searchParams.delete('preset');
        history.replaceState(null, '', url);
      } else if (entry.draftId) {
        const saved = await draftStore.load(entry.draftId);
        if (!cancelled && saved) hydrate(saved);
      } else {
        for (const anchor of entry.anchors) {
          if (!cancelled) addAnchor(anchor);
        }
      }

      if (!cancelled && entry.radiusMeters !== undefined) setRadius(entry.radiusMeters);
      if (!cancelled && entry.categoryIds && entry.categoryIds.length > 0) {
        useWalkStore.setState((state) => ({
          draft: { ...state.draft, selectedCategoryIds: entry.categoryIds!.slice() },
        }));
      }
      if (!cancelled && entry.view) setView(entry.view);

      if (!cancelled) setHydrated(true);

      if (!cancelled) {
        const all = await draftStore.list();
        setSavedDrafts(all);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addAnchor, hydrate, setEntryError, setRadius, setView]);

  const retryPoiSearch = usePoisQuery();
  useUrlSync(hydrated);

  useEffect(() => {
    if (!hydrated) return;
    void draftStore.save(snapshotWalk({ ...draft, city: walkCity }, pois, route, routeFailedSegments)).then(async () => {
      setSaveError(null);
      setSavedDrafts(await draftStore.list());
    }).catch(() => setSaveError('Не удалось сохранить маршрут. Проверьте свободное место в хранилище.'));
  }, [hydrated, draft, pois, route, routeFailedSegments, walkCity]);

  useEffect(() => { setShowOtherPois(false); }, [route]);

  useEffect(() => () => { routeAbortRef.current?.abort(); }, [draft.id, draft.selectedPoiIds.join('|'), draft.area.anchors.map((a) => `${a.id}:${a.lat}:${a.lng}`).join('|')]);

  useEffect(() => {
    return () => {
      routeAbortRef.current?.abort();
      spotAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);



  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pendingSpot) {
        clearSpot();
        return;
      }
      if (poiDetailId) closePoiDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingSpot, clearSpot, poiDetailId, closePoiDetail]);

  const orderedPois: Poi[] = useMemo(() => {
    const byId = new Map(pois.map((p) => [p.id, p]));
    return draft.selectedPoiIds
      .map((id) => byId.get(id))
      .filter((p): p is Poi => Boolean(p));
  }, [pois, draft.selectedPoiIds]);

  const detailPoi = poiDetailId
    ? pois.find((p) => p.id === poiDetailId) ?? (favoriteDetail?.id === poiDetailId ? favoriteDetail : null)
    : null;

  const lookupSpot = useCallback(
    (lat: number, lng: number) => {
      // Ключ локации с точностью ~11 м.
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;

      // Если эта же точка уже грузится — не абортим и не перезапускаем.
      // Иначе быстрые повторные клики «убивают» друг друга, и запрос
      // до сервера не доходит.
      if (pendingSpotKeyRef.current === key) {
        return;
      }
      pendingSpotKeyRef.current = key;

      spotAbortRef.current?.abort();
      const controller = new AbortController();
      spotAbortRef.current = controller;
      setSpotPending({ lat, lng });

      placeInfoRepository
        .lookup(lat, lng, controller.signal)
        .then((info) => {
          if (controller.signal.aborted || spotAbortRef.current !== controller) return;
          setSpotInfo(info, info ? 'ready' : 'error');
        })
        .catch((err: unknown) => {
          if (isAbort(err) || spotAbortRef.current !== controller) return;
          setSpotInfo(null, 'error');
        })
        .finally(() => {
          // Снимаем блокировку только если этот ключ ещё актуален.
          // Другой клик мог перезаписать его своим ключом.
          if (spotAbortRef.current === controller) {
            pendingSpotKeyRef.current = null;
          }
        });
    },
    [setSpotPending, setSpotInfo],
  );

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      closePoiDetail();
      lookupSpot(lat, lng);
    },
    [lookupSpot, closePoiDetail],
  );

  const handleAnchorMove = useCallback(
    (id: string, lat: number, lng: number) => updateAnchor(id, { lat, lng }),
    [updateAnchor],
  );

  const handleAddressAdd = useCallback((anchor: AnchorPoint) => {
    addAnchor(anchor);
    setShowOtherPois(true);
    setMapFocus({ lat: anchor.lat, lng: anchor.lng, id: newId('focus') });
    setDrawerOpen(false);
  }, [addAnchor]);

  const handlePoiDetails = useCallback(
    (id: string) => {
      spotAbortRef.current?.abort();
      clearSpot();
      pendingSpotKeyRef.current = null;
      setDrawerOpen(false);
      openPoiDetail(id);
    },
    [clearSpot, openPoiDetail],
  );

  const handleSpotAddToRoute = useCallback(() => {
    if (!pendingSpot) return;
    const id = `custom:${pendingSpot.lat.toFixed(6)}:${pendingSpot.lng.toFixed(6)}`;
    const poi: Poi = {
      id,
      name:
        spotInfo?.title ??
        `${pendingSpot.lat.toFixed(4)}, ${pendingSpot.lng.toFixed(4)}`,
      lat: pendingSpot.lat,
      lng: pendingSpot.lng,
      categoryIds: ['custom'],
      summary: spotInfo?.subtitle,
      facts: spotInfo?.extract ? [spotInfo.extract] : [],
      source: 'manual',
      details: {
        address: spotInfo?.subtitle,
        sourceUrl: spotInfo?.wikipediaUrl,
        photos: spotInfo?.thumbnailUrl ? [spotInfo.thumbnailUrl] : undefined,
      },
    };
    addCustomPoi(poi);
    clearSpot();
    pendingSpotKeyRef.current = null;
  }, [addCustomPoi, clearSpot, pendingSpot, spotInfo]);

  const handleSpotMakeStart = useCallback(() => {
    if (!pendingSpot) return;
    handleAddressAdd({
      id: newId('anchor'),
      lat: pendingSpot.lat,
      lng: pendingSpot.lng,
      label: spotInfo?.title,
    });
    clearSpot();
    pendingSpotKeyRef.current = null;
  }, [handleAddressAdd, pendingSpot, spotInfo, clearSpot]);

  const handleGeolocate = useCallback(
    (lat: number, lng: number) => {
        const existing = draft.area.anchors.find((anchor) => anchor.label === 'Моё местоположение');
        if (existing && (existing.lat !== lat || existing.lng !== lng)) updateAnchor(existing.id, { lat, lng });
        else if (!existing) addAnchor({ id: newId('anchor'), lat, lng, label: 'Моё местоположение' });
        setMapFocus({ lat, lng, id: newId('focus') });
    },
      [addAnchor, updateAnchor, draft.area.anchors],
  );

  const handleBuildRoute = useCallback(async () => {
    if (orderedPois.length < 2) return;
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setRoute(null, 'loading');
    try {
      const result = await buildWalkingRoute(
        orderedPois,
        routePlanner,
        (current, total) => {
          if (!controller.signal.aborted && routeAbortRef.current === controller) setRouteProgress({ current, total });
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.failedSegments.length === 0) {
        setRoute(result.route, 'ready');
      } else {
        setRoute(
          result.route,
          'error',
          result.lastError ?? 'Не удалось построить часть маршрута',
          result.failedSegments,
        );
      }
    } catch (err) {
      if (isAbort(err)) return;
      setRoute(
        null,
        'error',
        err instanceof Error ? err.message : 'Не удалось построить маршрут',
      );
    } finally {
      if (routeAbortRef.current === controller) setRouteProgress(null);
    }
  }, [orderedPois, setRoute, setRouteProgress]);

  const handleExport = useCallback(() => {
    if (!route || routeFailedSegments.length > 0) return;
    setShareWalk(exportSharedWalk(draft, pois, route));
  }, [draft, pois, route, routeFailedSegments]);

  const handleLoadDraft = useCallback(
    async (id: string) => {
      const d = await draftStore.load(id);
      if (d) {
        hydrate(d);
        setShowSaved(false);
      }
    },
    [hydrate],
  );

  const handleDeleteDraft = useCallback(
    async (id: string) => {
      await draftStore.remove(id);
      const all = await draftStore.list();
      setSavedDrafts(all);
      if (id === draft.id) createNewDraft();
    },
    [draft.id, createNewDraft],
  );

  const handleNewDraft = useCallback(() => {
    createNewDraft();
    setShowSaved(false);
  }, [createNewDraft]);

  const handleCloseSpot = useCallback(() => {
    spotAbortRef.current?.abort();
    clearSpot();
    pendingSpotKeyRef.current = null;
  }, [clearSpot]);

  return (
    <div className={`app${drawerOpen ? ' app--drawer-open' : ''}`}>
      <header className="app__header">
        <button type="button" className="app__icon-btn" aria-label="Готовые прогулки" title="Готовые прогулки" onClick={() => setShowReady(true)}>▤</button>
        {onHome && <button className="app__icon-btn" aria-label="Главная" title="Главная" onClick={onHome}>⌂</button>}
        {onRecord && <button className={`app__icon-btn${recordingActive ? ' recording-indicator' : ''}`} aria-label="Запись прогулки" title="Запись прогулки" onClick={onRecord}>●</button>}
        <button type="button" className="app__icon-btn" aria-label="Избранные места" title="Избранные места" onClick={() => setShowFavorites(true)}>★</button>
        <div className="app__header-title">
          <input
            className="app__title"
            value={draft.title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Название прогулки"
          />
          <div className="app__header-meta">
            {poisStatus === 'loading' && <span>Ищем точки…</span>}
            {poisStatus === 'ready' && pois.length > 0 && <span>{pois.length} точек рядом</span>}
            {poisError && <span className="is-error">{poisError === INCOMPLETE_AREA_MESSAGE ? poisError : 'Не удалось обновить места.'} <button type="button" onClick={retryPoiSearch}>Повторить</button></span>}
          </div>
        </div>
        <button
          type="button"
          className="app__icon-btn"
          onClick={() => setShowSaved(true)}
          aria-label="Мои маршруты"
          title="Мои маршруты"
        >
          📁
        </button>
      </header>

      {showReady && <div className="modal-backdrop" onClick={() => setShowReady(false)}>
        <div ref={readyRef} className="modal modal--ready" role="dialog" aria-modal="true" aria-label="Готовые прогулки" onClick={event => event.stopPropagation()}>
          <button className="btn" onClick={() => setShowReady(false)}>Закрыть</button>
          <h2>Готовые прогулки по Петербургу</h2><ReadyWalks />
        </div>
      </div>}
      {saveError && <div className="banner banner--warn" role="alert">{saveError}</div>}

      {entryError && (
        <div className="banner banner--warn">
          {entryError}
          <button type="button" onClick={() => setEntryError(null)}>
            ×
          </button>
        </div>
      )}

      <div className="app__body">
        <div
          className={`app__sidebar-backdrop${drawerOpen ? ' is-open' : ''}`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />

        <aside
          ref={sidebarRef}
          className={`app__sidebar${drawerOpen ? ' is-open' : ''}`}
        >
          <div className="app__sidebar-handle" data-drawer-handle>
            <span className="app__sidebar-handle-bar" aria-hidden />
          </div>

          <button
            type="button"
            className="app__sidebar-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Закрыть маршрут"
          >
            ×
          </button>

          <div className="app__sidebar-scroll">
            <section className="panel panel--start">
              <header className="panel__header">
                <span className="panel__icon" aria-hidden>
                  📌
                </span>
                <h2>Точка старта</h2>
              </header>

              <EntryPanel onAddAnchor={handleAddressAdd} onLocate={handleGeolocate} />

              {draft.area.anchors.length > 0 && (
                <ul className="anchors">
                  {draft.area.anchors.map((anchor, i) => (
                    <li key={anchor.id}>
                      <span className="anchors__index">{i + 1}</span>
                      <span className="anchors__label" title={anchor.label}>
                        {anchor.label ??
                          `${anchor.lat.toFixed(4)}, ${anchor.lng.toFixed(4)}`}
                      </span>
                      <button
                        type="button"
                        className="anchors__remove"
                        onClick={() => removeAnchor(anchor.id)}
                        aria-label="Удалить стартовую точку"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <header className="panel__header">
                <span className="panel__icon" aria-hidden>
                  🗂
                </span>
                <h2>Что ищем</h2>
              </header>
              <CategoryPicker
                selectedIds={draft.selectedCategoryIds}
                onToggle={toggleCategory}
              />
            </section>

            <section className="panel">
              <header className="panel__header">
                <span className="panel__icon" aria-hidden>
                  📏
                </span>
                <h2>Радиус поиска</h2>
              </header>
              <RadiusSlider value={draft.area.radiusMeters} onChange={setRadius} />
            </section>

            <section className="panel">
              <header className="panel__header">
                <span className="panel__icon" aria-hidden>
                  📍
                </span>
                <h2>
                  Выбрано
                  {draft.selectedPoiIds.length > 0 && (
                    <span className="panel__badge">
                      {draft.selectedPoiIds.length}
                    </span>
                  )}
                </h2>
              </header>

              {draft.selectedPoiIds.length === 0 ? (
                <p className="panel__hint">
                  Кликните по маркеру на карте, чтобы открыть карточку и добавить
                  точку в маршрут.
                </p>
              ) : (
                <ol className="selection">
                  {orderedPois.map((poi, index) => (
                    <li key={poi.id}>
                      <button
                        type="button"
                        className="selection__name selection__name--link"
                        onClick={() => handlePoiDetails(poi.id)}
                      >
                        <span className="selection__index">{index + 1}</span>
                        <span className="selection__text">{poi.name}</span>
                      </button>
                      <span className="selection__actions">
                        <button
                          type="button"
                          onClick={() => movePoi(poi.id, -1)}
                          disabled={index === 0}
                          aria-label="Выше"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => movePoi(poi.id, 1)}
                          disabled={index === orderedPois.length - 1}
                          aria-label="Ниже"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => togglePoi(poi.id)}
                          aria-label="Убрать"
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <RouteSummary
              pois={pois}
              selectedPoiIds={draft.selectedPoiIds}
              route={route}
              status={routeStatus}
              error={routeError}
              failedSegments={routeFailedSegments}
              progress={routeProgress}
              onBuild={handleBuildRoute}
              onExport={handleExport}
            />
          </div>

          <footer className="app__sidebar-footer">
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={orderedPois.length < 2 || routeStatus === 'loading'}
              onClick={handleBuildRoute}
            >
              {routeStatus === 'loading'
                ? 'Строим…'
                : route
                  ? 'Перестроить маршрут'
                  : 'Построить маршрут'}
            </button>
            {route && routeFailedSegments.length === 0 && (
              <button
                type="button"
                className="btn btn--block"
                onClick={handleExport}
              >
                Включить в общий маршрут
              </button>
            )}
          </footer>
        </aside>

        <main className="app__main">
          <div className="app__toolbar">
            <ViewToggle value={draft.view} onChange={setView} />
            <LegendBar pois={pois} />
            {route && (
              <button type="button" className="btn" aria-pressed={showOtherPois}
                onClick={() => setShowOtherPois((value) => !value)}>
                {showOtherPois ? 'Скрыть остальные точки' : 'Показать остальные точки'}
              </button>
            )}
            {osmLost && (
              <span className="app__osm-warn" title="Overpass временно недоступен">
                ⚠ OSM
              </span>
            )}
          </div>

          {draft.view === 'map' ? (
            <MapView
              recordedPath={recordingActive ? recordedPath : undefined}
              onViewportChange={updateViewport}
              focusRequest={mapFocus}
              anchors={draft.area.anchors}
              radiusMeters={draft.area.radiusMeters}
              pois={pois}
              selectedPoiIds={draft.selectedPoiIds}
              route={route}
              failedSegments={routeFailedSegments}
              hideUnselected={route !== null && !showOtherPois}
              spotPoint={pendingSpot}
              poiDetailId={poiDetailId}
              onMapClick={handleMapClick}
              onAnchorMove={handleAnchorMove}
              onPoiDetails={handlePoiDetails}
            />
          ) : (
            <div className="app__list-wrap">
              <PoiList
                pois={favoriteDetail && poiDetailId === favoriteDetail.id && !pois.some(poi => poi.id === favoriteDetail.id) ? [...pois, favoriteDetail] : pois}
                selectedPoiIds={draft.selectedPoiIds}
                onToggle={togglePoi}
              />
            </div>
          )}

          {draft.view === 'map' && (
            <GeolocateButton onLocate={handleGeolocate} />
          )}

          {draft.view === 'map' && detailPoi && (
            <PoiDetailCard
              poi={detailPoi}
              isSelected={draft.selectedPoiIds.includes(detailPoi.id)}
                onToggle={() => {
                  if (!pois.some(poi => poi.id === detailPoi.id)) addCustomPoi(detailPoi);
                  else togglePoi(detailPoi.id);
                }}
              onClose={closePoiDetail}
            />
          )}

          {draft.view === 'map' && !detailPoi && (
            <SpotCard
              point={pendingSpot}
              status={spotStatus}
              info={spotInfo}
              onAddToRoute={handleSpotAddToRoute}
              onMakeStart={handleSpotMakeStart}
              onClose={handleCloseSpot}
            />
          )}
        </main>
      </div>

      <div className="app__mobile-bar">
        <div className="app__mobile-bar-info">
          {route && orderedPois.length >= 2 ? (
            <>
              <strong>{orderedPois.length}</strong> точек ·{' '}
              {formatDistance(route.totalDistanceMeters)}
            </>
          ) : orderedPois.length > 0 ? (
            <>
              <strong>{orderedPois.length}</strong> выбрано из {pois.length}
            </>
          ) : (
            <>{pois.length > 0 ? `${pois.length} найдено` : 'Выберите место для прогулки'}</>
          )}
        </div>
        <button
          type="button"
          className="app__mobile-bar-btn app__mobile-bar-btn--icon"
          onClick={() => setShowSaved(true)}
          aria-label="Мои маршруты"
        >
          📁
        </button>
        <button
          type="button"
          className="app__mobile-bar-btn"
          onClick={() => setDrawerOpen(true)}
        >
          📍 Маршрут
        </button>
      </div>

      {showFavorites && <FavoritesModal initialCity={walkCity} onClose={() => setShowFavorites(false)} onOpen={poi => {
        setShowFavorites(false);
        setDrawerOpen(false);
        clearSpot();
        setFavoriteDetail(poi);
        openPoiDetail(poi.id);
        setView('map');
        setMapFocus({ lat: poi.lat, lng: poi.lng, id: newId('focus') });
      }} />}

      {showSaved && (
        <SavedRoutesModal
          drafts={savedDrafts}
          currentId={draft.id}
          onLoad={handleLoadDraft}
          onDelete={handleDeleteDraft}
          onNew={handleNewDraft}
          onClose={() => setShowSaved(false)}
        />
      )}

      {shareWalk && (
        <ShareModal walk={shareWalk} onClose={() => setShareWalk(null)} />
      )}
    </div>
  );
}
