-- Reference data for transit. Idempotent; run as app_admin after migrations.
INSERT INTO transit.route_types (route_type_id, code, name) VALUES
  (0, 'tram', 'Tram, light rail'), (1, 'metro', 'Metro'), (2, 'rail', 'Rail'), (3, 'bus', 'Bus'),
  (4, 'ferry', 'Ferry'), (5, 'cable_tram', 'Cable tram'), (6, 'aerial_lift', 'Aerial lift'),
  (7, 'funicular', 'Funicular'), (11, 'trolleybus', 'Trolleybus'), (12, 'monorail', 'Monorail')
ON CONFLICT (route_type_id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name;

-- Extended route types (Google Transit extension, used e.g. by the Vilnius feed: 800 trolleybus).
INSERT INTO transit.route_types (route_type_id, code, name) VALUES
  (100, 'railway_service', 'Railway service'), (101, 'high_speed_rail', 'High speed rail'),
  (102, 'long_distance_train', 'Long distance train'), (103, 'inter_regional_rail', 'Inter-regional rail'),
  (106, 'regional_rail', 'Regional rail'), (109, 'suburban_railway', 'Suburban railway'),
  (200, 'coach_service', 'Coach service'), (400, 'urban_railway', 'Urban railway'),
  (401, 'metro_service', 'Metro service'), (402, 'underground_service', 'Underground service'),
  (700, 'bus_service', 'Bus service'), (701, 'regional_bus', 'Regional bus'),
  (702, 'express_bus', 'Express bus'), (704, 'local_bus', 'Local bus'),
  (712, 'school_bus', 'School bus'), (715, 'demand_responsive_bus', 'Demand and response bus'),
  (800, 'trolleybus_service', 'Trolleybus service'), (900, 'tram_service', 'Tram service'),
  (1000, 'water_transport', 'Water transport'), (1300, 'aerial_lift_service', 'Aerial lift service'),
  (1400, 'funicular_service', 'Funicular service'), (1700, 'miscellaneous', 'Miscellaneous service')
ON CONFLICT (route_type_id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name;

-- Bounds are rough rectangles around the city limits; replace with the
-- administrative boundary polygon from OSM when the grid is generated.
INSERT INTO transit.cities (city_id, code, name, country_code, timezone, h3_resolution, bounds) VALUES
  (1, 'waw', 'Warsaw',  'PL', 'Europe/Warsaw',  9, ST_MakeEnvelope(20.85, 52.10, 21.28, 52.37, 4326)),
  (2, 'vno', 'Vilnius', 'LT', 'Europe/Vilnius', 9, ST_MakeEnvelope(25.02, 54.57, 25.48, 54.83, 4326))
ON CONFLICT (city_id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name,
  country_code = EXCLUDED.country_code, timezone = EXCLUDED.timezone;

-- Checked 2026-11-15 against the Mobility Database catalog (https://mobilitydatabase.org).
--   waw: mdb-2092, unofficial build by mkuran.pl from the ZTM Warszawa timetable, CC0 1.0;
--        includes suburban lines of ZTM. Mirror: https://files.mobilitydatabase.org/mdb-2092/latest.zip
--   vno: mdb-1044, official feed of Vilnius public transport (stops.lt); the catalog and the
--        publisher's page state no licence. Mirror: https://files.mobilitydatabase.org/mdb-1044/latest.zip
INSERT INTO transit.feed_sources (feed_source_id, city_id, code, name, url, license) VALUES
  (1, 1, 'waw_ztm', 'ZTM Warszawa (mkuran.pl build)', 'https://mkuran.pl/gtfs/warsaw.zip',
   'CC0 1.0 (Mobility Database mdb-2092; built by mkuran.pl from ZTM Warszawa data)'),
  (2, 2, 'vno_vvt', 'Vilnius public transport (stops.lt)', 'https://www.stops.lt/vilnius/vilnius/gtfs.zip',
   'Not stated by the publisher; official open feed per Mobility Database mdb-1044')
ON CONFLICT (feed_source_id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, license = EXCLUDED.license;
