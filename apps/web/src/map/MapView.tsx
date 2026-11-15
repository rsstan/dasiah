// MapLibre drops null feature properties, so popup values may be undefined.
// The map: basemap with OSM attribution, the result cells as one fill layer coloured by legend
// class, merged into larger hexagons when zoomed out, a popup per cell and a marker at the start.
// Clicking outside the cells (or "Start here" in a popup) picks a new start point.
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre finds its worker next to its own module, which is not where Vite serves the
// pre-bundled copy from; point it at the worker file explicitly (also emitted by the build).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoundingBox, CalculationResults, Coordinates, LegendClass } from '../api/types.ts';
import { aggregate, formatDuration, resolutionForZoom, toFeatureCollection, type MapCell } from './hexagons.ts';

maplibregl.setWorkerUrl(workerUrl);

export const MAP_STYLE_URL: string =
  (import.meta.env['VITE_MAP_STYLE_URL'] as string | undefined) || 'https://tiles.openfreemap.org/styles/positron';

const SOURCE = 'cells';
const FILL = 'cells-fill';
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

interface Props {
  bounds: BoundingBox;
  results: CalculationResults | undefined;
  legend: readonly LegendClass[];
  origin: Coordinates | undefined;
  onPick: (point: Coordinates) => void;
}

export function MapView({ bounds, results, legend, origin, onPick }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | undefined>(undefined);
  const markerRef = useRef<maplibregl.Marker | undefined>(undefined);
  const pickRef = useRef(onPick);
  const legendRef = useRef(legend);
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(11);
  const [mapError, setMapError] = useState<string | undefined>(undefined);
  useEffect(() => {
    pickRef.current = onPick;
    legendRef.current = legend;
  }, [onPick, legend]);

  // Create the map once.
  useEffect(() => {
    if (container.current === null) {
      return;
    }
    const map = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE_URL,
      bounds: [bounds.west, bounds.south, bounds.east, bounds.north],
      // The style's sources credit OpenFreeMap, OpenMapTiles and OpenStreetMap (ODbL).
      attributionControl: { compact: false },
      maxPitch: 0,
      dragRotate: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (e: { error?: unknown }) => {
      // Tile hiccups are frequent and harmless; only a failed style leaves the map blank.
      if (!map.isStyleLoaded()) {
        setMapError('The basemap could not be loaded. The results are still shown.');
      }
      console.warn('map error', e.error);
    });
    map.on('load', () => {
      map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
      // Below the first label layer, so street and place names stay readable over the cells.
      const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      map.addLayer(
        {
          id: FILL,
          type: 'fill',
          source: SOURCE,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.72, 15, 0.5],
            'fill-outline-color': 'rgba(255, 255, 255, 0.25)',
          },
        },
        firstLabel,
      );
      setZoom(map.getZoom());
      setLoaded(true);
    });
    map.on('zoomend', () => setZoom(map.getZoom()));
    map.on('mouseenter', FILL, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', FILL, () => (map.getCanvas().style.cursor = ''));
    map.on('click', (e: MapMouseEvent) => {
      const feature = map.getLayer(FILL) ? map.queryRenderedFeatures(e.point, { layers: [FILL] })[0] : undefined;
      const point = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      if (feature === undefined) {
        pickRef.current(point);
        return;
      }
      new maplibregl.Popup({ maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setDOMContent(
          popupContent(feature.properties as unknown as MapCell, legendRef.current, () => pickRef.current(point)),
        )
        .addTo(map);
    });
    return () => {
      map.remove();
      mapRef.current = undefined;
    };
    // The bounds of the first city only; later changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // City switch: fly to the new city.
  useEffect(() => {
    mapRef.current?.fitBounds([bounds.west, bounds.south, bounds.east, bounds.north], { padding: 20, duration: 600 });
  }, [bounds.west, bounds.south, bounds.east, bounds.north]);

  const resolution = results === undefined ? undefined : resolutionForZoom(zoom, results.resolution);
  const data = useMemo(
    () =>
      results === undefined || resolution === undefined
        ? EMPTY
        : toFeatureCollection(aggregate(results.cells, resolution, legend), legend),
    [results, resolution, legend],
  );

  useEffect(() => {
    if (loaded) {
      (mapRef.current?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data);
    }
  }, [loaded, data]);

  useEffect(() => {
    const map = mapRef.current;
    markerRef.current?.remove();
    markerRef.current = undefined;
    if (map !== undefined && origin !== undefined) {
      markerRef.current = new maplibregl.Marker({ color: '#1f2937' }).setLngLat([origin.lon, origin.lat]).addTo(map);
    }
  }, [origin, loaded]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" role="region" aria-label="Map" />
      {mapError !== undefined && <p className="map-error">{mapError}</p>}
    </div>
  );
}

function popupContent(cell: MapCell, legend: readonly LegendClass[], onStartHere: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cell-popup';
  const cls = legend.find((c) => c.code === cell.class);
  const title = document.createElement('strong');
  title.textContent = cls?.label ?? cell.class;
  root.append(title);
  const rows: [string, string][] = [
    ['Public transport', formatDuration(cell.transitS)],
    ['Car', formatDuration(cell.carS)],
    ['Ratio', typeof cell.ratio === 'number' ? `× ${cell.ratio.toFixed(2)}` : '—'],
  ];
  const table = document.createElement('dl');
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    table.append(dt, dd);
  }
  root.append(table);
  if (cell.count > 1) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = `Median of ${cell.count} cells. Zoom in for detail.`;
    root.append(note);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Start here';
  button.addEventListener('click', onStartHere);
  root.append(button);
  return root;
}
