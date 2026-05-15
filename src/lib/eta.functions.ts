import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import stopsData from "./mta-stops.json";

type Stop = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  n: string;
  lines: string[];
};

const STOPS = stopsData as Stop[];
const STOP_BY_ID = new Map<string, Stop>(STOPS.map((s) => [s.id, s]));

// Map any realtime stop_id (e.g. "101N") → parent stop name.
function nameForRtStop(rtStopId: string): string | null {
  const parent = rtStopId.replace(/[NS]$/, "");
  return STOP_BY_ID.get(parent)?.name ?? null;
}

const FEED_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F";
const FEEDS: Record<string, string> = {
  "1": "gtfs", "2": "gtfs", "3": "gtfs", "4": "gtfs", "5": "gtfs",
  "6": "gtfs", "7": "gtfs", GS: "gtfs", S: "gtfs",
  A: "gtfs-ace", C: "gtfs-ace", E: "gtfs-ace", H: "gtfs-ace", FS: "gtfs-ace",
  B: "gtfs-bdfm", D: "gtfs-bdfm", F: "gtfs-bdfm", M: "gtfs-bdfm",
  G: "gtfs-g",
  J: "gtfs-jz", Z: "gtfs-jz",
  N: "gtfs-nqrw", Q: "gtfs-nqrw", R: "gtfs-nqrw", W: "gtfs-nqrw",
  L: "gtfs-l",
  SI: "gtfs-si", SIR: "gtfs-si",
};

const NORTH_LABEL: Record<string, string> = {
  "1": "Uptown", "2": "Uptown", "3": "Uptown", "4": "Uptown", "5": "Uptown",
  "6": "Uptown", B: "Uptown", D: "Uptown", N: "Uptown", Q: "Uptown",
  R: "Uptown", W: "Uptown", A: "Uptown", C: "Uptown",
  "7": "to Flushing", E: "to Jamaica", F: "to Queens", M: "to Forest Hills",
  G: "to Court Sq", J: "to Jamaica", Z: "to Jamaica", L: "to 8 Av",
  SI: "to St George", SIR: "to St George",
};
const SOUTH_LABEL: Record<string, string> = {
  "1": "Downtown", "2": "Downtown", "3": "Downtown", "4": "Downtown",
  "5": "Downtown", "6": "Downtown", B: "Downtown", D: "Downtown",
  N: "Downtown", Q: "Downtown", R: "Downtown", W: "Downtown",
  A: "Downtown", C: "Downtown",
  "7": "to Manhattan", E: "to Manhattan", F: "to Brooklyn", M: "to Brooklyn",
  G: "to Church Av", J: "to Manhattan", Z: "to Manhattan",
  L: "to Canarsie", SI: "to Tottenville", SIR: "to Tottenville",
};

function dirLabel(route: string, dir: "N" | "S"): string {
  if (dir === "N") return NORTH_LABEL[route] ?? "Uptown";
  return SOUTH_LABEL[route] ?? "Downtown";
}

const inputSchema = z.object({
  stopId: z.string().trim().min(2).max(10),
  trains: z.array(z.string().min(1).max(5)).optional(),
});

export type Arrival = {
  route: string;
  destination: string;
  direction: "N" | "S";
  directionLabel: string;
  minutes: number;
  arrivalEpoch: number;
  tripId: string;
};

async function fetchFeed(slug: string) {
  const res = await fetch(FEED_BASE + slug, {
    headers: { "User-Agent": "lovable-mta-tracker/1.0" },
  });
  if (!res.ok) throw new Error(`MTA feed ${slug} ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

export const getEta = createServerFn({ method: "POST" })
  .inputValidator((d) => inputSchema.parse(d))
  .handler(async ({ data }) => {
    const stop = STOP_BY_ID.get(data.stopId);
    if (!stop) {
      return { arrivals: [] as Arrival[], stop: null, error: "Station not found" };
    }
    const wanted = new Set(
      (data.trains && data.trains.length > 0 ? data.trains : stop.lines).map((t) =>
        t.toUpperCase(),
      ),
    );

    // Group requested lines by feed slug
    const slugs = new Set<string>();
    for (const line of wanted) {
      const slug = FEEDS[line];
      if (slug) slugs.add(slug);
    }
    if (slugs.size === 0) {
      return { arrivals: [], stop, error: "No supported lines for this station" };
    }

    const now = Math.floor(Date.now() / 1000);
    const out: Arrival[] = [];
    try {
      const feeds = await Promise.all([...slugs].map((s) => fetchFeed(s)));
      for (const feed of feeds) {
        for (const entity of feed.entity) {
          const tu = entity.tripUpdate;
          if (!tu || !tu.trip) continue;
          const route = tu.trip.routeId;
          if (!route || !wanted.has(route.toUpperCase())) continue;
          const stus = tu.stopTimeUpdate || [];
          // Find arrival at requested stop
          let myStu: (typeof stus)[number] | null = null;
          for (const s of stus) {
            if (!s.stopId) continue;
            if (s.stopId.replace(/[NS]$/, "") === stop.id) {
              myStu = s;
              break;
            }
          }
          if (!myStu || !myStu.stopId) continue;
          const dir = myStu.stopId.slice(-1) as "N" | "S";
          if (dir !== "N" && dir !== "S") continue;
          const t = toNum(myStu.arrival?.time ?? myStu.departure?.time);
          if (!t) continue;
          const minutes = Math.round((t - now) / 60);
          if (minutes < 0 || minutes > 90) continue;

          // Destination = last stopTimeUpdate's parent stop name
          let destination: string | null = null;
          for (let i = stus.length - 1; i >= 0; i--) {
            const last = stus[i];
            if (last?.stopId) {
              destination = nameForRtStop(last.stopId);
              if (destination) break;
            }
          }
          if (!destination) destination = dirLabel(route, dir);

          out.push({
            route: route.toUpperCase(),
            destination,
            direction: dir,
            directionLabel: dirLabel(route, dir),
            minutes,
            arrivalEpoch: t,
            tripId: tu.trip.tripId || "",
          });
        }
      }
    } catch (err) {
      return {
        arrivals: [] as Arrival[],
        stop,
        error: `Failed to load MTA feed: ${(err as Error).message}`,
      };
    }

    out.sort((a, b) => a.arrivalEpoch - b.arrivalEpoch);
    return { arrivals: out, stop, error: null as string | null };
  });

const alertsInput = z.object({
  routes: z.array(z.string().min(1).max(5)).min(1).max(30),
});

export type ServiceAlert = {
  id: string;
  header: string;
  description: string;
  routes: string[];
};

export const getAlerts = createServerFn({ method: "POST" })
  .inputValidator((d) => alertsInput.parse(d))
  .handler(async ({ data }) => {
    const wanted = new Set(data.routes.map((r) => r.toUpperCase()));
    try {
      const res = await fetch(
        "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts",
        { headers: { "User-Agent": "lovable-mta-tracker/1.0" } },
      );
      if (!res.ok) return { alerts: [] as ServiceAlert[], error: null };
      const buf = new Uint8Array(await res.arrayBuffer());
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
      const now = Math.floor(Date.now() / 1000);
      const out: ServiceAlert[] = [];
      for (const entity of feed.entity) {
        const a = entity.alert;
        if (!a) continue;
        // active period filter
        const periods = a.activePeriod || [];
        if (periods.length > 0) {
          const active = periods.some((p) => {
            const start = toNum(p.start);
            const end = toNum(p.end);
            return (start === 0 || start <= now) && (end === 0 || end >= now);
          });
          if (!active) continue;
        }
        const routes = new Set<string>();
        for (const inf of a.informedEntity || []) {
          if (inf.routeId) routes.add(inf.routeId.toUpperCase());
        }
        let hit = false;
        for (const r of routes) if (wanted.has(r)) { hit = true; break; }
        if (!hit) continue;

        const header = a.headerText?.translation?.[0]?.text || "";
        const description = a.descriptionText?.translation?.[0]?.text || "";
        if (!header) continue;
        out.push({
          id: entity.id || header.slice(0, 40),
          header,
          description,
          routes: [...routes],
        });
      }
      return { alerts: out.slice(0, 5), error: null as string | null };
    } catch (err) {
      return { alerts: [] as ServiceAlert[], error: (err as Error).message };
    }
  });
