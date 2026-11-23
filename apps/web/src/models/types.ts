// Shapes of the public API, generated from contracts/openapi (gateway.yaml). Type-only: nothing
// from @heatmap/contracts ends up in the bundle.
import type { GatewayApi } from '@heatmap/contracts';

type Schemas = GatewayApi.components['schemas'];

export type City = Schemas['City'];
export type BoundingBox = Schemas['BoundingBox'];
export type LegendClass = Schemas['LegendClass'];
export type LegendClassCode = Schemas['LegendClassCode'];
export type Calculation = Schemas['Calculation'];
export type CalculationRequest = Schemas['CalculationRequest'];
export type CalculationResults = Schemas['CalculationResults'];
export type CellResult = Schemas['CellResult'];
export type GeocodeCandidate = Schemas['GeocodeCandidate'];
export type Problem = Schemas['Problem'];
export type Coordinates = Schemas['Coordinates'];
