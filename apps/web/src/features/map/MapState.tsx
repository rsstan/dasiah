// State of the map of one city (/cities/:code). A map is computed when the user picks a start
// point (search, map click, saved place) or changes the departure. The first map comes from the
// address (/cities/vno?lat=..&lon=..&date=..&time=..) or from the page that navigated here: a
// saved place (state.origin) or a history entry (state.history, opened by its calculation id).
import { cellToLatLng } from 'h3-js';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { HistoryEntry } from '../history/index.ts';
import type { City, LegendClass } from '../../models/types.ts';
import { useCalculation, type CalculationState } from './api/useCalculation.ts';
import { readUrlState, type Origin } from './urlState.ts';

export interface Departure {
  date: string;
  time: string;
}

/** What another page may hand over when it opens a city (react-router location state). */
export interface CityNavigationState {
  origin?: Origin;
  history?: HistoryEntry;
}

export interface MapState {
  city: City;
  legend: readonly LegendClass[];
  origin: Origin | undefined;
  departure: Departure;
  calculation: CalculationState;
  /** New start point in this city; computes the map. */
  pick(point: Origin): void;
  changeDeparture(departure: Departure): void;
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
  city: City;
  legend: readonly LegendClass[];
  children: ReactNode;
}

export function MapStateProvider({ city, legend, children }: Props) {
  const location = useLocation();
  // Read once: the provider is created per city (keyed by its code).
  const [initial] = useState<{ origin?: Origin; date?: string; time?: string; open?: string }>(() => {
    const handed = (location.state ?? {}) as CityNavigationState;
    if (handed.history !== undefined) {
      const [lat, lon] = cellToLatLng(handed.history.originH3);
      return { origin: { lat, lon, label: 'Start point from history' }, open: handed.history.calculationId };
    }
    const fromUrl = readUrlState(location.search);
    return { origin: handed.origin ?? fromUrl.origin, date: fromUrl.date, time: fromUrl.time };
  });
  const [origin, setOrigin] = useState<Origin | undefined>(initial.origin);
  const [departure, setDeparture] = useState<Departure>({ date: initial.date ?? '', time: initial.time ?? '08:00' });
  const { state: calculation, run } = useCalculation();

  const compute = useCallback(
    (point: Origin | undefined, dep: Departure, open?: string) => {
      if (point === undefined || city.activeFeed === null) {
        return;
      }
      void run(
        {
          cityCode: city.code,
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
    [city, run],
  );

  // The first map, on mount. (In development StrictMode mounts twice; the first request is
  // cancelled by the unmount and the second one replaces it.)
  useEffect(() => {
    compute(initial.origin, departure, initial.open);
    // Only on the first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = useCallback(
    (point: Origin) => {
      setOrigin(point);
      compute(point, departure);
    },
    [compute, departure],
  );

  const changeDeparture = useCallback(
    (dep: Departure) => {
      setDeparture(dep);
      compute(origin, dep);
    },
    [compute, origin],
  );

  const retry = useCallback(() => compute(origin, departure), [compute, origin, departure]);

  const value = useMemo<MapState>(
    () => ({ city, legend, origin, departure, calculation, pick, changeDeparture, retry }),
    [city, legend, origin, departure, calculation, pick, changeDeparture, retry],
  );
  return <MapStateContext value={value}>{children}</MapStateContext>;
}
