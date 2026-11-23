// Public entry of the map feature. MapView pulls in the map engine (MapLibre GL, several hundred
// kB), so it is loaded on demand: importing anything else from here never loads the engine.
import { lazy } from 'react';

export const MapView = lazy(() => import('./MapView.tsx').then((m) => ({ default: m.MapView })));
export { MapStateProvider, useMapState, type CityNavigationState, type Departure } from './MapState.tsx';
export { AddressSearch } from './AddressSearch.tsx';
export { Legend } from './Legend.tsx';
export { Status } from './Status.tsx';
export { toSearch, type Origin } from './urlState.ts';
