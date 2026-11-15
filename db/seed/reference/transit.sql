-- Reference data for transit. Idempotent; run as app_admin after migrations.
INSERT INTO transit.route_types (route_type_id, code, name) VALUES
  (0, 'tram', 'Tram, light rail'), (1, 'metro', 'Metro'), (2, 'rail', 'Rail'), (3, 'bus', 'Bus'),
  (4, 'ferry', 'Ferry'), (5, 'cable_tram', 'Cable tram'), (6, 'aerial_lift', 'Aerial lift'),
  (7, 'funicular', 'Funicular'), (11, 'trolleybus', 'Trolleybus'), (12, 'monorail', 'Monorail')
ON CONFLICT (route_type_id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name;

-- Bounds are rough rectangles around the city limits; replace with the
-- administrative boundary polygon from OSM when the grid is generated.
INSERT INTO transit.cities (city_id, code, name, country_code, timezone, h3_resolution, bounds) VALUES
  (1, 'waw', 'Warsaw',  'PL', 'Europe/Warsaw',  9, ST_MakeEnvelope(20.85, 52.10, 21.28, 52.37, 4326)),
  (2, 'vno', 'Vilnius', 'LT', 'Europe/Vilnius', 9, ST_MakeEnvelope(25.02, 54.57, 25.48, 54.83, 4326))
ON CONFLICT (city_id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name,
  country_code = EXCLUDED.country_code, timezone = EXCLUDED.timezone;

-- URLs and licences must be re-checked against the publisher's page before first import.
INSERT INTO transit.feed_sources (feed_source_id, city_id, code, name, url, license) VALUES
  (1, 1, 'waw_ztm', 'ZTM Warszawa (mkuran.pl build)', 'https://mkuran.pl/gtfs/warsaw.zip',   'see publisher page'),
  (2, 2, 'vno_vvt', 'Vilnius public transport',       'https://www.stops.lt/vilnius/gtfs.zip', 'see publisher page')
ON CONFLICT (feed_source_id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, license = EXCLUDED.license;
