# MTA Subway Tracker Rebuild Plan

This is a substantial rebuild. I'll keep the existing GTFS-Realtime feed wiring (it already works) and layer the requested features on top. Nothing unrelated will change.

## 1. Static GTFS data expansion (`src/lib/mta-stops.json` + new files)

Currently `mta-stops.json` only stores parent stop IDs and names. To show real destinations and per-station line info, I'll regenerate from the official MTA `google_transit.zip`:

- `mta-stops.json` — `{ id, name, lat, lon, lines: ["1","2","3"] }` for every parent stop
- `mta-trips.json` — `tripId → { routeId, headsign, lastStopId }` so each realtime trip can be mapped to its terminal stop name and headsign
- Stops file stays small (<100KB); trips file is larger but loaded only on the server

Generation runs once via a Node script (not shipped to client).

## 2. Server function (`src/lib/eta.functions.ts`)

Two server functions:

- `getEta({ stopId, train? })` — fetches the right feed for each line serving the stop, returns up to 6 arrivals per direction with: `{ destination, headsign, direction: "N"|"S", minutes, arrivalEpoch, routeId }`. Destination = `mta-trips.json[tripId].lastStopId → stop name`, with fallback to headsign, then to the line's TERMINALS map.
- `getAlerts({ routeId })` — fetches `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts` (GTFS-RT alerts protobuf), returns active alerts for the given line as `{ header, description, severity }[]`.

Add SIR (`SI`) to the FEEDS map.

## 3. Client search (`src/lib/stations.ts` — new, client-safe)

Re-exports the small stops JSON for the browser:

- `searchStations(query)` — fuzzy search by normalized name; returns top 8 with their lines
- `nearbyStations(lat, lon, n=3)` — haversine sort

## 4. UI rebuild (`src/routes/index.tsx`)

Mobile-first dark MTA countdown board:

- **Top**: station autocomplete input. As user types, dropdown shows matching stations with colored line bullets next to each name.
- **Below**: train-line filter chips (colored bullets) — only lines that actually serve the selected station are enabled; clicking filters the board.
- **Service alert banner**: dismissible, shown when alerts exist for displayed lines.
- **Arrivals board**: dark `#0a0a0a` background. For each arrival row:
  - Left: colored train bullet (existing `trainColors`)
  - Middle: bold white destination ("Far Rockaway"), gray subtitle ("Downtown · to Far Rockaway")
  - Right: big countdown — green >5 min, yellow 2–5 min, red <2 min — with `8 min` on top and `· 7:48 AM` clock time underneath
  - Up to 6 per direction
- **"Both directions" toggle**: when off, show only one direction (default uses geolocation if available to pick the user's likely direction, else shows both).
- **Auto-refresh**: every 30s, with a "Last updated: 12s ago" line and a pulsing green dot. A small ring countdown shows seconds-to-next-refresh.
- **Nearby stations**: collapsible section at the bottom; shows 2–3 nearest stations (requires geolocation permission) and the next train at each.

## 5. Files touched

```text
src/lib/mta-stops.json          regenerated (lat/lon/lines added)
src/lib/mta-trips.json          new
src/lib/eta.functions.ts        rewrite handler; add getAlerts
src/lib/stations.ts             new (client-safe search + nearby)
src/routes/index.tsx            UI rebuild
package.json                    no new deps (gtfs-realtime-bindings already in)
scripts/build-mta-data.mjs      new (one-shot generator, not bundled)
```

No styling tokens, root layout, server entry, or unrelated files change. Train colors keep the official hex values already in `trainColors()`.

## Technical notes

- Static GTFS will be fetched once at script-time (not at runtime). The result lives in JSON files committed to the repo. This avoids cold-start cost in the Worker.
- All realtime fetches happen in `createServerFn` handlers. The Worker stays well under CPU limits because we parse only one feed per call (the line group needed) and we cache the parsed `Long → number` arithmetic.
- Geolocation uses the browser API; no server involvement.
- The ignore-rule for "to Franklin Ave arrives from Brooklyn" wording stays — destinations are the trip's actual last stop, never the user's station.

Confirm and I'll implement.
