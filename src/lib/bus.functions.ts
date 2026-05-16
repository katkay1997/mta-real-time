import { createServerFn } from "@tanstack/react-start";

type Visit = {
  route: string;
  destination: string;
  etaMin: number | null;
  expectedEpoch: number | null;
  stopsAway: number | null;
  proximity: string;
  directionRef: string;
};

type Vehicle = {
  ref: string;
  progress: string;
  location: string;
  occupancy: string;
};

export type NearbyStop = {
  stopId: string;
  stopIds: string[];
  name: string;
  routes: string[];
  lat: number;
  lon: number;
};

function minutesUntil(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - Date.now()) / 60000));
}

function epochOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export const getBusArrivals = createServerFn({ method: "POST" })
  .inputValidator((input: { line: string; stop: string }) => {
    const rawIn = String(input?.line ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    const stopRaw = String(input?.stop ?? "").trim().slice(0, 256);
    if (!rawIn) throw new Error("Please enter a bus route number");
    if (!stopRaw) throw new Error("stop is required");
    // Detect SBS: " SBS", "-SBS", or trailing "SBS" → "+"
    const isSBS = /(\s|-)?SBS$/.test(rawIn) || /\+$/.test(rawIn);
    const base = rawIn.replace(/(\s|-)?SBS$/, "").replace(/\+$/, "").replace(/\s+/g, "");
    if (!/^[A-Z]{1,3}[0-9]{1,3}$/.test(base)) throw new Error("invalid line");
    const line = isSBS ? `${base}+` : base;
    const stops = stopRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (stops.length === 0) throw new Error("stop is required");
    for (const s of stops) {
      if (!/^[0-9]+$/.test(s)) throw new Error("invalid stop id");
    }
    return { line, stops };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.MTA_BUS_API_KEY;
    if (!apiKey) {
      return {
        error: "Server is missing MTA_BUS_API_KEY.",
        visits: [] as Visit[],
        vehicles: [] as Vehicle[],
      };
    }

    const lineRef = `MTA NYCT_${data.line}`;
    const vmUrl = `https://bustime.mta.info/api/siri/vehicle-monitoring.json?key=${encodeURIComponent(
      apiKey,
    )}&LineRef=${encodeURIComponent(lineRef)}&version=2`;

    try {
      const smPromises = data.stops.map((s) =>
        fetch(
          `https://bustime.mta.info/api/siri/stop-monitoring.json?key=${encodeURIComponent(
            apiKey,
          )}&MonitoringRef=${encodeURIComponent(s)}&LineRef=${encodeURIComponent(
            lineRef,
          )}&version=2`,
        ),
      );
      const [smResults, vmRes] = await Promise.all([
        Promise.all(smPromises),
        fetch(vmUrl),
      ]);

      const monitored: any[] = [];
      let firstErr: string | null = null;
      for (const smRes of smResults) {
        if (!smRes.ok) {
          firstErr = firstErr ?? `Stop monitoring failed (${smRes.status})`;
          continue;
        }
        const sm: any = await smRes.json();
        const smDelivery = sm?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0];
        const errText =
          smDelivery?.ErrorCondition?.OtherError?.ErrorText ||
          sm?.Siri?.ServiceDelivery?.ErrorCondition?.OtherError?.ErrorText;
        if (errText && !firstErr) firstErr = String(errText);
        const list: any[] = smDelivery?.MonitoredStopVisit ?? [];
        for (const v of list) monitored.push(v);
      }
      if (monitored.length === 0 && firstErr) {
        return { error: firstErr, visits: [], vehicles: [] };
      }
      const vm: any = vmRes.ok ? await vmRes.json() : null;

      const visits: Visit[] = monitored.map((v) => {
        const j = v.MonitoredVehicleJourney || {};
        const call = j.MonitoredCall || {};
        const dest = Array.isArray(j.DestinationName)
          ? j.DestinationName[0]
          : j.DestinationName;
        const route =
          (j.PublishedLineName &&
            (Array.isArray(j.PublishedLineName)
              ? j.PublishedLineName[0]
              : j.PublishedLineName)) ||
          (j.LineRef ? String(j.LineRef).split("_").pop() : data.line);
        const dirRefRaw =
          j.DirectionRef != null
            ? Array.isArray(j.DirectionRef)
              ? j.DirectionRef[0]
              : j.DirectionRef
            : "";
        return {
          route: String(route).toUpperCase(),
          destination: dest || "—",
          etaMin: minutesUntil(call.ExpectedArrivalTime),
          expectedEpoch: epochOf(call.ExpectedArrivalTime),
          stopsAway:
            typeof call.NumberOfStopsAway === "number"
              ? call.NumberOfStopsAway
              : null,
          proximity: call.ArrivalProximityText || "",
          directionRef: String(dirRefRaw),
        };
      });
      visits.sort((a, b) => (a.etaMin ?? 999) - (b.etaMin ?? 999));

      const vmActivities: any[] =
        vm?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.[0]
          ?.VehicleActivity ?? [];
      const vehicles: Vehicle[] = vmActivities.map((a) => {
        const j = a.MonitoredVehicleJourney || {};
        return {
          ref: String(j.VehicleRef || "").split("_").pop() || "—",
          progress: j.ProgressStatus
            ? Array.isArray(j.ProgressStatus)
              ? j.ProgressStatus.join(", ")
              : String(j.ProgressStatus)
            : "in transit",
          location:
            j.MonitoredCall?.StopPointName ||
            j.OnwardCalls?.OnwardCall?.[0]?.StopPointName ||
            "—",
          occupancy: j.Occupancy || j.OccupancyStatus || "",
        };
      });

      return { error: null, visits, vehicles };
    } catch (err) {
      console.error("bus arrivals error", err);
      return {
        error: "Could not reach MTA BusTime. Try again shortly.",
        visits: [] as Visit[],
        vehicles: [] as Vehicle[],
      };
    }
  });

export const findStopsByAddress = createServerFn({ method: "POST" })
  .inputValidator((input: { address: string }) => {
    const address = String(input?.address ?? "").trim().slice(0, 200);
    if (!address) throw new Error("address is required");
    return { address };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.MTA_BUS_API_KEY;
    if (!apiKey) {
      return {
        error: "Server is missing MTA_BUS_API_KEY.",
        stops: [] as NearbyStop[],
      };
    }
    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        data.address,
      )}&format=json&limit=1`;
      const geoRes = await fetch(geoUrl, {
        headers: {
          "User-Agent": "MTA-Subway-Feed/1.0 (lovable.app)",
          Accept: "application/json",
        },
      });
      if (!geoRes.ok) {
        return {
          error: `Geocoding failed (${geoRes.status})`,
          stops: [] as NearbyStop[],
        };
      }
      const geo: any = await geoRes.json();
      if (!Array.isArray(geo) || geo.length === 0) {
        return {
          error:
            "Address not found. Try adding a borough or city (e.g. 'Brooklyn, NY')",
          stops: [] as NearbyStop[],
        };
      }
      const lat = parseFloat(geo[0].lat);
      const lon = parseFloat(geo[0].lon);
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        return {
          error: "Address not found. Try a more specific intersection.",
          stops: [] as NearbyStop[],
        };
      }

      const stopsUrl = `https://bustime.mta.info/api/where/stops-for-location.json?lat=${lat}&lon=${lon}&latSpan=0.005&lonSpan=0.005&key=${encodeURIComponent(
        apiKey,
      )}`;
      const stopsRes = await fetch(stopsUrl);
      if (!stopsRes.ok) {
        return {
          error: `Stop lookup failed (${stopsRes.status})`,
          stops: [] as NearbyStop[],
        };
      }
      const stopsJson: any = await stopsRes.json();
      const list: any[] = stopsJson?.data?.stops ?? stopsJson?.data?.list ?? [];
      const stops: NearbyStop[] = list.map((s) => ({
        stopId: String(s.id ?? s.code ?? "").split("_").pop() ?? "",
        stopIds: [],
        name: String(s.name ?? "—"),
        routes: Array.isArray(s.routeIds)
          ? s.routeIds.map((r: string) => String(r).split("_").pop() ?? r)
          : Array.isArray(s.routes)
            ? s.routes.map((r: any) =>
                String(r.shortName ?? r.id ?? "").split("_").pop() ?? "",
              )
            : [],
        lat: Number(s.lat ?? 0),
        lon: Number(s.lon ?? 0),
      }));
      const filtered = stops.filter((s) => s.stopId);
      // Merge by normalized name so a single corner with multiple
      // direction-specific stop IDs becomes one entry.
      const byName = new Map<string, NearbyStop>();
      for (const s of filtered) {
        const key = s.name.trim().toLowerCase();
        const existing = byName.get(key);
        if (existing) {
          if (!existing.stopIds.includes(s.stopId)) existing.stopIds.push(s.stopId);
          for (const r of s.routes) {
            if (!existing.routes.includes(r)) existing.routes.push(r);
          }
        } else {
          byName.set(key, { ...s, stopIds: [s.stopId] });
        }
      }
      const merged = Array.from(byName.values());
      if (merged.length === 0) {
        return {
          error:
            "No bus stops found near this address. Try a nearby intersection.",
          stops: [] as NearbyStop[],
        };
      }
      return { error: null, stops: merged };
    } catch (err) {
      console.error("findStopsByAddress error", err);
      return {
        error: "Could not look up that address. Try again shortly.",
        stops: [] as NearbyStop[],
      };
    }
  });