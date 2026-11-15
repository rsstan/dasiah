# 1. Product scope

## What the service does

1. The user picks a city (Warsaw or Vilnius) and types an address.
2. The service computes, from that address to every hexagon of the city, the travel time by
   public transport and by car.
3. The map shows each hexagon coloured by `ratio = t_transit / t_car`: green where transit is
   about as fast as a car, red where the car is much faster, grey where there is no stop nearby.
4. Clicking a hexagon shows both times and the ratio. Zooming out merges hexagons into larger ones.
5. A registered user can save addresses (home, work) and sees a history of maps.

## Users

- People choosing where to live or work without a car.
- Urban activists and urbanists who need evidence of where transit loses to the car.
- Administrator: watches feed imports, activates a timetable version.

## In scope

| Area | Included |
| --- | --- |
| Cities | Warsaw, Vilnius; adding a city is data plus configuration, no code |
| Transit | Scheduled timetable (GTFS static), walking to and from stops, walking transfers |
| Car | Free-flow driving time from OSRM on OpenStreetMap data |
| Time | A chosen date and departure time; default is the next working day at 08:00 |
| Accounts | Registration, sign-in, saved places, history, account deletion |
| Admin | Feed list, import, activation |

## Out of scope

Real-time delays, fares, turn-by-turn itineraries, bicycles and scooters, congestion and parking
search, native mobile apps, step-free routing.

## Non-functional targets

| Target | Value |
| --- | --- |
| Map for one address, not cached | p95 under 10 s for Warsaw (about 5 000 cells) |
| Same question again | under 500 ms (served from the calculation cache) |
| Cost | No paid APIs; self-hosted routing and open data |
| Privacy | Origin stored as an H3 resolution-10 cell, not as an address; personal data masked for read-only roles; account deletion erases personal data in every service |
| Licences | OSM attribution (ODbL) in the UI; GTFS licence recorded per feed source |

## Glossary

| Term | Meaning |
| --- | --- |
| GTFS | Open format for public transport timetables (zip of CSV files) |
| Feed version | One downloaded GTFS archive, identified by its SHA-256 |
| H3 cell | Hexagon of Uber's H3 grid; resolution 9 (edge about 200 m) for the map, 10 for the origin |
| RAPTOR | Round-based public transit routing algorithm; one run gives arrival times at all stops |
| OSRM | Open Source Routing Machine; its `table` service returns one-to-many driving times |
| Ratio | `t_transit / t_car` for a destination cell |
| Access stops | Stops within walking distance of a cell, with walking time |
