import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import stopsData from "./mta-stops.json";

const inputSchema = z.object({
  train: z.string().trim().min(1).max(5),
  station: z.string().trim().min(1).max(100),
});

type Arrival = { destination: string; minutes: number };
type StopRow = { id: string; name: string; n: string };

const STOPS = stopsData as StopRow[];

// Feed URLs by train line
const FEEDS: Record<string, string> = {
  "1": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  "2": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  "3": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  "4": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  "5": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  "6": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  "7": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  S: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  A: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  C: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  E: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  B: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  D: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  F: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  M: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  G: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
  J: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
  Z: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
  N: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  Q: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  R: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  W: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  L: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
};

// [North-end terminal, South-end terminal] — N stop_id suffix heads toward index 0
const TERMINALS: Record<string, [string, string]> = {
  "1": ["Van Cortlandt Park-242 St", "South Ferry"],
  "2": ["Wakefield-241 St", "Flatbush Av-Brooklyn College"],
  "3": ["Harlem-148 St", "New Lots Av"],
  "4": ["Woodlawn", "Crown Hts-Utica Av"],
  "5": ["Eastchester-Dyre Av", "Flatbush Av-Brooklyn College"],
  "6": ["Pelham Bay Park", "Brooklyn Bridge-City Hall"],
  "7": ["Flushing-Main St", "34 St-Hudson Yards"],
  A: ["Inwood-207 St", "Far Rockaway / Lefferts Blvd"],
  C: ["168 St", "Euclid Av"],
  E: ["Jamaica Center-Parsons/Archer", "World Trade Center"],
  B: ["Bedford Park Blvd", "Brighton Beach"],
  D: ["Norwood-205 St", "Coney Island-Stillwell Av"],
  F: ["Jamaica-179 St", "Coney Island-Stillwell Av"],
  M: ["Forest Hills-71 Av", "Middle Village-Metropolitan Av"],
  G: ["Court Sq", "Church Av"],
  J: ["Jamaica Center-Parsons/Archer", "Broad St"],
  Z: ["Jamaica Center-Parsons/Archer", "Broad St"],
  L: ["8 Av", "Canarsie / Rockaway Pkwy"],
  N: ["Astoria-Ditmars Blvd", "Coney Island-Stillwell Av"],
  Q: ["96 St-2 Av", "Coney Island-Stillwell Av"],
  R: ["Forest Hills-71 Av", "Bay Ridge-95 St"],
  W: ["Astoria-Ditmars Blvd", "Whitehall St"],
  S: ["Times Sq-42 St", "Grand Central-42 St"],
};

// Trains that should NOT use Uptown/Downtown labels
const NON_TRUNK = new Set(["A", "C", "F", "M", "7", "G", "E", "L"]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Find best matching parent stop IDs for a station name
function findStops(query: string): string[] {
  const q = normalize(query);
  if (!q) return [];
  const qTokens = q.split(" ").filter((w) => w.length >= 2);

  // Score each stop
  const scored = STOPS.map((s) => {
    let score = 0;
    if (s.n === q) score = 1000;
    else if (s.n.includes(q)) score = 500 + (q.length / s.n.length) * 100;
    else if (q.includes(s.n)) score = 400;
    else {
      const stopTokens = new Set(s.n.split(" "));
      let hits = 0;
      for (const t of qTokens) if (stopTokens.has(t)) hits++;
      if (hits > 0) score = hits * 50 - Math.abs(s.n.length - q.length);
    }
    return { id: s.id, name: s.n, score };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];
  const top = scored[0].score;
  // Return all stops tied at top (handles complex stations with multiple parent IDs)
  return scored.filter((x) => x.score >= top - 1).map((x) => x.id);
}

function labelFor(train: string, dir: "N" | "S"): string {
  if (!NON_TRUNK.has(train)) {
    return dir === "N" ? "Uptown" : "Downtown";
  }
  const t = TERMINALS[train];
  if (!t) return dir === "N" ? "Uptown" : "Downtown";
  return dir === "N" ? t[0] : t[1];
}

export const getEta = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const trainKey = data.train.trim().toUpperCase();
    const feedUrl = FEEDS[trainKey];
    if (!feedUrl) {
      return { arrivals: [] as Arrival[], error: `Unsupported train line: ${trainKey}` };
    }

    const stopIds = findStops(data.station);
    if (stopIds.length === 0) {
      return { arrivals: [] as Arrival[], error: `Station "${data.station}" not found` };
    }
    const stopIdSet = new Set(stopIds);

    try {
      const res = await fetch(feedUrl);
      if (!res.ok) {
        return { arrivals: [] as Arrival[], error: `MTA feed error (${res.status})` };
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);

      const now = Math.floor(Date.now() / 1000);
      // Group arrivals by direction
      const byDir: Record<"N" | "S", number[]> = { N: [], S: [] };

      for (const entity of feed.entity) {
        const tu = entity.tripUpdate;
        if (!tu || !tu.trip) continue;
        const routeId = tu.trip.routeId;
        if (routeId !== trainKey) continue;
        for (const stu of tu.stopTimeUpdate || []) {
          const sid = stu.stopId;
          if (!sid) continue;
          const dir = sid.slice(-1) as "N" | "S";
          if (dir !== "N" && dir !== "S") continue;
          const parent = sid.slice(0, -1);
          if (!stopIdSet.has(parent)) continue;
          const arrTime = stu.arrival?.time ?? stu.departure?.time;
          if (!arrTime) continue;
          const t =
            typeof arrTime === "number"
              ? arrTime
              : typeof (arrTime as any).toNumber === "function"
                ? (arrTime as any).toNumber()
                : Number(arrTime);
          const mins = Math.round((t - now) / 60);
          if (mins < 0 || mins > 90) continue;
          byDir[dir].push(mins);
        }
      }

      byDir.N.sort((a, b) => a - b);
      byDir.S.sort((a, b) => a - b);

      const arrivals: Arrival[] = [];
      for (const dir of ["N", "S"] as const) {
        const mins = byDir[dir].slice(0, 3);
        const dest = labelFor(trainKey, dir);
        for (const m of mins) {
          arrivals.push({ destination: dest, minutes: m });
        }
      }

      if (arrivals.length === 0) {
        return { arrivals, error: null };
      }
      return { arrivals, error: null };
    } catch (err: any) {
      console.error("MTA feed error", err);
      return { arrivals: [] as Arrival[], error: "Failed to reach MTA realtime feed" };
    }
  });
