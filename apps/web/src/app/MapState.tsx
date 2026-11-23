// State of the map shared by every route: the map stays on screen while the user moves between
// pages, and the places and history pages open a start point on it. A map is computed when the
// user picks a start point (search, map click, saved place) or changes the departure; history
// opens an earlier map by its id. Initial values come from a shared link (/?city=&lat=&lon=...).
import { cellToLatLng } from 'h3-js';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { City, LegendClass } from '../api/types.ts';
import { useCalculation, type CalculationState } from '../calculation/useCalculation.ts';
import type { HistoryEntry } from '../account/HistoryList.tsx';
import { readUrlState, type Origin } from '../urlState.ts';

export interface Departure {
  date: string;
  time: string;
}

export interface MapState {
  cities: readonly City[];
  legend: readonly LegendClass[];
  city: City;
  origin: Origin | undefined;
  departure: Departure;
  calculation: CalculationState;
  /** New start point (possibly in another city); computes the map. */
  pick(cityCode: string, point: Origin): void;
  switchCity(cityCode: string): void;
  changeDeparture(departure: Departure): void;
  /** Opens an earlier map; computes it again if it has expired. */
  openHistory(entry: HistoryEntry): void;
  retry(): void;
}

const MapStateContext = createContext<MapState | undefined>(undefined);

export function useMapState(): MapState {
  const state = use(MapStateContext);
  if (state === undefined) {
    throw new Error('useMapState outside MapStateProvider');
  }
  return state;
}

interface Props {
  cities: readonly City[];
  legend: readonly LegendClass[];
  children: ReactNode;
}

export function MapStateProvider({ cities, legend, children }: Props) {
  // A shared link only counts on the map route.
  const initial = useMemo(() => (window.location.pathname === '/' ? readUrlState(window.location.search) : {}), []);
  const [cityCode, setCityCode] = useState(
    cities.some((c) => c.code === initial.city) ? (initial.city as string) : (cities[0] as City).code,
  );
  const [origin, setOrigin] = useState<Origin | undefined>(initial.origin);
  const [departure, setDeparture] = useState<Departure>({ date: initial.date ?? '', time: initial.time ?? '08:00' });
  const { state: calculation, run, reset } = useCalculation();
  const city = cities.find((c) => c.code === cityCode) ?? (cities[0] as City);

  const compute = useCallback(
    (code: string, point: Origin | undefined, dep: Departure, open?: string) => {
      const target = cities.find((c) => c.code === code);
      if (point === undefined || target?.activeFeed == null) {
        return;
      }
      void run(
        {
          cityCode: code,
          origin: { lat: point.lat, lon: point.lon },
          windowMinutes: 0,
          ...(dep.date === '' ? {} : { date: dep.date }),
          ...(dep.time === '' ? {} : { time: dep.time }),
        },
        open,
      ).then((outcome) => {
        if (open !== undefined && outcome !== undefined) {
          setDeparture({ date: outcome.calculation.date, time: outcome.calculation.time });
        }
      });
    },
    [cities, run],
  );

  // A shared link: compute its map on mount. (In development StrictMode mounts twice; the first
  // request is cancelled by the unmount and the second one replaces it.)
  useEffect(() => {
    if (initial.origin !== undefined) {
      compute(cityCode, initial.origin, departure);
    }
    // Only on the first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = useCallback(
    (code: string, point: Origin) => {
      setCityCode(code);
      setOrigin(point);
      compute(code, point, departure);
    },
    [compute, departure],
  );

  const switchCity = useCallback(
    (code: string) => {
      if (code === cityCode) {
        return;
      }
      reset();
      setOrigin(undefined);
      setDeparture((d) => ({ ...d, date: '' }));
      setCityCode(code);
    },
    [cityCode, reset],
  );

  const changeDeparture = useCallback(
    (dep: Departure) => {
      setDeparture(dep);
      compute(cityCode, origin, dep);
    },
    [compute, cityCode, origin],
  );

  const openHistory = useCallback(
    (h: HistoryEntry) => {
      const [lat, lon] = cellToLatLng(h.originH3);
      const point = { lat, lon, label: 'Start point from history' };
      setCityCode(h.cityCode);
      setOrigin(point);
      compute(h.cityCode, point, { date: '', time: '08:00' }, h.calculationId);
    },
    [compute],
  );

  const retry = useCallback(() => compute(cityCode, origin, departure), [compute, cityCode, origin, departure]);

  const value = useMemo<MapState>(
    () => ({
      cities,
      legend,
      city,
      origin,
      departure,
      calculation,
      pick,
      switchCity,
      changeDeparture,
      openHistory,
      retry,
    }),
    [cities, legend, city, origin, departure, calculation, pick, switchCity, changeDeparture, openHistory, retry],
  );
  return <MapStateContext value={value}>{children}</MapStateContext>;
}
