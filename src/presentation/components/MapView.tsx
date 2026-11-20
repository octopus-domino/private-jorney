// src/presentation/components/MapView.tsx
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster';
import type { Poi } from '../../domain/Poi';
import type { AnchorPoint } from '../../domain/SearchArea';
import type { WalkingRoute } from '../../domain/WalkingRoute';
import { categoryColor, categoryIcon, categoryLabel } from '../../domain/PoiCategory';
import { escapeHtml } from '../../shared/html';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import type { ListingSearchArea } from '../../application/ports/ApartmentListingsRepository';
import type { TrackPoint } from '../../domain/RecordedWalk';
import { walkSpeedSpans } from '../../domain/walkSpeed';
import { paintWalkSpeed } from './recordingSpeedLayer';
import { WalkSpeedLegend } from './WalkSpeedLegend';

export interface PendingSpot {
  lat: number;
  lng: number;
}

interface MapViewProps {
  recordedPath?: TrackPoint[];
  onViewportChange?(area: ListingSearchArea): void;
  focusRequest?: PendingSpot & { id: string };
  anchors: AnchorPoint[];
  radiusMeters: number;
  pois: Poi[];
  selectedPoiIds: string[];
  route: WalkingRoute | null;
  failedSegments?: number[];
  hideUnselected?: boolean;
  spotPoint?: PendingSpot | null;
  poiDetailId?: string | null;
  onMapClick(lat: number, lng: number): void;
  onAnchorMove(id: string, lat: number, lng: number): void;
  onPoiDetails(id: string): void;
}

const ANCHOR_ICON_HTML = '<div class="anchor-dot">★</div>';
const SPOT_ICON_HTML = '<div class="spot-pin"></div>';
const POI_SIZE = 26;
const MAX_MAP_ZOOM = 19;

function pluralizeFacts(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'факт';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'факта';
  return 'фактов';
}

function buildPoiBadgeHtml(poi: Poi, selected: boolean, active: boolean): string {
  const primary = poi.categoryIds[0];
  const color = categoryColor(primary);
  const icon = categoryIcon(primary);
  const factsCount = poi.facts.length;
  const facts = factsCount
    ? `<span class="poi-badge__facts">${factsCount} ${pluralizeFacts(factsCount)}</span>`
    : '';
  const classes = [
    'poi-badge',
    selected ? 'is-selected' : '',
    active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `
    <div class="${classes}">
      <span class="poi-badge__dot" style="background:${color}">${escapeHtml(icon)}</span>
      <span class="poi-badge__body">
        <span class="poi-badge__name">${escapeHtml(poi.name)}</span>
        <span class="poi-badge__meta">${escapeHtml(categoryLabel(primary))}${facts ? ' · ' + facts : ''}</span>
      </span>
    </div>
  `;
}

export function MapView({
  recordedPath = [],
  onViewportChange,
  focusRequest,
  anchors,
  radiusMeters,
  pois,
  selectedPoiIds,
  route,
  failedSegments = [],
  hideUnselected = false,
  spotPoint = null,
  poiDetailId = null,
  onMapClick,
  onAnchorMove,
  onPoiDetails,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const anchorLayerRef = useRef<L.LayerGroup | null>(null);
  const circleLayerRef = useRef<L.LayerGroup | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const spotLayerRef = useRef<L.LayerGroup | null>(null);
  const recordingLayerRef = useRef<L.LayerGroup | null>(null);
  const fittedRouteRef = useRef<WalkingRoute | null>(null);
  const previousAnchorCountRef = useRef(0);
  const markerPoiIdsRef = useRef(new WeakMap<L.Marker, string>());
  const [clusterPoiIds, setClusterPoiIds] = useState<string[]>([]);
  const clusterSheetRef = useSwipeDismiss<HTMLElement>(() => setClusterPoiIds([]), clusterPoiIds.length > 0);

  const onMapClickRef = useRef(onMapClick);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const onAnchorMoveRef = useRef(onAnchorMove);
  const onPoiDetailsRef = useRef(onPoiDetails);
  onMapClickRef.current = onMapClick;
  onAnchorMoveRef.current = onAnchorMove;
  onPoiDetailsRef.current = onPoiDetails;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      maxZoom: MAX_MAP_ZOOM,
    }).setView([59.9386, 30.3141], 13);

    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: MAX_MAP_ZOOM,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    anchorLayerRef.current = L.layerGroup().addTo(map);
    circleLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    spotLayerRef.current = L.layerGroup().addTo(map);
    recordingLayerRef.current = L.layerGroup().addTo(map);

    // Keep nearby labels grouped; open their complete list at maximum zoom.
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: false,
      spiderfyOnMaxZoom: false,
      animate: false,
      maxClusterRadius: (zoom) => zoom < 16 ? 180 : zoom < 18 ? 110 : 45,
      iconCreateFunction: (c) => {
        const count = c.getChildCount();
        // Размер кластера зависит от количества точек.
        let size = 36;
        if (count >= 100) size = 52;
        else if (count >= 50) size = 48;
        else if (count >= 20) size = 44;
        else if (count >= 10) size = 40;
        return L.divIcon({
          html: `<div class="poi-cluster" style="width:${size}px;height:${size}px;font-size:${size >= 44 ? 14 : 12}px">${count}</div>`,
          className: 'poi-cluster-wrap',
          iconSize: L.point(size, size),
          iconAnchor: L.point(size / 2, size / 2),
        });
      },
    });
    cluster.addTo(map);
    clusterRef.current = cluster;
    // Explicit handling avoids relying on the plugin's internal cluster depth.
    // A scrollable list also keeps dense/coincident points reachable on phones.
    const openCluster = (event: L.LeafletEvent) => {
      if (event.type === 'clusterkeypress' && (event as L.LeafletEvent & { originalEvent?: KeyboardEvent }).originalEvent?.key !== 'Enter') return;
      const group = (event as L.LeafletEvent & { layer: L.MarkerCluster }).layer;
      const ids = [...new Set<string>(group.getAllChildMarkers().map((marker: L.Marker) => markerPoiIdsRef.current.get(marker)!).filter(Boolean))];
      if (map.getZoom() < MAX_MAP_ZOOM) {
        const bounds = group.getBounds();
        map.setView(bounds.getCenter(), Math.min(MAX_MAP_ZOOM, Math.max(map.getZoom() + 1,
          map.getBoundsZoom(bounds, false, L.point(50, 50)))), { animate: false });
      }
      setClusterPoiIds(ids);
    };
    cluster.on('clusterclick clusterkeypress', openCluster);
    const closeCluster = () => setClusterPoiIds([]);
    map.on('zoomstart', closeCluster);

    const handleClick = (e: L.LeafletMouseEvent) => {
      closeCluster();
      onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handleClick);

    mapRef.current = map;
    const publishBounds = () => {
      const bounds = map.getBounds();
      onViewportChangeRef.current?.({ south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() });
    };
    map.on('moveend', publishBounds);
    publishBounds();
    return () => {
      map.off('click', handleClick);
      map.off('moveend', publishBounds);
      map.off('zoomstart', closeCluster);
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = recordingLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (recordedPath.length > 1) paintWalkSpeed(layer, walkSpeedSpans(recordedPath));
    const last = recordedPath.at(-1);
    if (last) L.circleMarker([last.lat, last.lng], { radius: 6, color: '#fff', fillColor: '#9b543b', fillOpacity: 1, interactive: false }).addTo(layer);
  }, [recordedPath]);

  useEffect(() => {
    const anchorLayer = anchorLayerRef.current;
    const circleLayer = circleLayerRef.current;
    if (!anchorLayer || !circleLayer) return;
    anchorLayer.clearLayers();
    circleLayer.clearLayers();

    for (const anchor of anchors) {
      const marker = L.marker([anchor.lat, anchor.lng], {
        title: anchor.label,
        draggable: true,
        icon: L.divIcon({
          className: 'anchor-marker',
          html: ANCHOR_ICON_HTML,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      });
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        onAnchorMoveRef.current(anchor.id, lat, lng);
      });
      marker.addTo(anchorLayer);

      L.circle([anchor.lat, anchor.lng], {
        radius: radiusMeters,
        color: '#2563eb',
        weight: 1,
        fillColor: '#2563eb',
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(circleLayer);
    }

    if (previousAnchorCountRef.current === 0 && anchors.length > 0 && mapRef.current) {
      mapRef.current.setView([anchors[0].lat, anchors[0].lng], 15, { animate: false });
    }
    previousAnchorCountRef.current = anchors.length;
  }, [anchors, radiusMeters]);

  useEffect(() => {
    if (!focusRequest || !mapRef.current) return;
    const map = mapRef.current;
    map.stop();
    map.setView([focusRequest.lat, focusRequest.lng], Math.max(map.getZoom(), 16), { animate: false });
  }, [focusRequest]);

  useEffect(() => {
    const layer = spotLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!spotPoint) return;
    L.marker([spotPoint.lat, spotPoint.lng], {
      icon: L.divIcon({
        className: 'spot-marker',
        html: SPOT_ICON_HTML,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      }),
      interactive: false,
      zIndexOffset: 2000,
    }).addTo(layer);
  }, [spotPoint]);

  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;

    cluster.clearLayers();

    const selected = new Set(selectedPoiIds);
    for (const poi of new Map(pois.map((point) => [point.id, point])).values()) {
      const isSelected = selected.has(poi.id);
      const isActive = poiDetailId === poi.id;
      if (hideUnselected && !isSelected && !isActive) continue;
      const classes = [
        'poi-marker',
        isSelected ? 'is-selected' : '',
        isActive ? 'is-active' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const marker = L.marker([poi.lat, poi.lng], {
        icon: L.divIcon({
          className: classes,
          html: buildPoiBadgeHtml(poi, isSelected, isActive),
          iconSize: [POI_SIZE, POI_SIZE],
          iconAnchor: [POI_SIZE / 2, POI_SIZE / 2],
        }),
        riseOnHover: true,
        zIndexOffset: isSelected || isActive ? 1000 : 0,
      });
      markerPoiIdsRef.current.set(marker, poi.id);

      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        onPoiDetailsRef.current(poi.id);
      });

      cluster.addLayer(marker);
    }
  }, [pois, selectedPoiIds, hideUnselected, poiDetailId]);

  useEffect(() => {
    const layer = routeLayerRef.current;
    if (!layer || !mapRef.current) return;
    layer.clearLayers();
    if (!route) return;

    const failed = new Set(failedSegments);

    for (const leg of route.legs) {
      const isFailed = failed.has(leg.fromIndex) || leg.geometry.length < 2;
      if (isFailed) continue;
      const points: Array<[number, number]> = leg.geometry;

      L.polyline(points, {
        color: '#2e7d32',
        weight: 9,
        opacity: 0.22,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(layer);

      L.polyline(points, {
        color: '#2e7d32',
        weight: 4,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(layer);

      L.polyline(points, {
        color: '#ffffff',
        weight: 1.2,
        opacity: 0.65,
        dashArray: '2 10',
        lineCap: 'round',
        interactive: false,
      }).addTo(layer);
    }

    if (fittedRouteRef.current !== route && route.geometry.length >= 2) {
      fittedRouteRef.current = route;
      mapRef.current.fitBounds(L.latLngBounds(route.geometry).pad(0.15), {
        animate: false,
      });
    }
  }, [route, failedSegments]);

  const clusterPois = [...new Map(pois.map(point => [point.id, point])).values()].filter((poi) => clusterPoiIds.includes(poi.id)
    && (!hideUnselected || selectedPoiIds.includes(poi.id) || poi.id === poiDetailId));
  return <>
    <div ref={containerRef} className="map-view" />
    {recordedPath.length > 1 && <WalkSpeedLegend />}
    {clusterPois.length > 0 && <section ref={clusterSheetRef} className="map-cluster-panel" role="dialog" aria-label="Точки в группе">
      <header><strong>Точки в этой области · {clusterPois.length}</strong><button type="button" className="btn" aria-label="Закрыть группу" onClick={() => setClusterPoiIds([])}>×</button></header>
      <div className="map-cluster-panel__list">{clusterPois.map((poi) => <button type="button" key={poi.id} onClick={() => { setClusterPoiIds([]); onPoiDetailsRef.current(poi.id); }}>
        <span>{categoryIcon(poi.categoryIds[0])}</span><span>{poi.name}</span><span aria-hidden="true">→</span>
      </button>)}</div>
    </section>}
  </>;
}
