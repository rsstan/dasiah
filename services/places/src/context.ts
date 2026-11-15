// Everything handlers, use cases and consumers need; created once in app.ts.
import type { Logger, Pool } from '@heatmap/common';
import type { Config } from './config.ts';
import type { CityDirectory } from './geocoding/cities.ts';
import type { Geocoder } from './geocoding/geocoder.ts';

export interface AppContext {
  readonly config: Config;
  readonly logger: Logger;
  readonly pool: Pool;
  readonly geocoder: Geocoder;
  readonly cities: CityDirectory;
}
