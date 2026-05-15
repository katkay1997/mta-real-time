import { createServerFn } from "@tanstack/react-start";

type Visit = {
  route: string;
  destination: string;
  etaMin: number | null;
  expectedEpoch: number | null;
  stopsAway: number | null;
  proximity: string;
};

type Vehicle = {
  ref: string;
  progress: string;
  location: string;
  occupancy: string;
};

export type NearbyStop = {
  stopId: string;
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
    const line = String(input?.line ?? "").trim().toUpperCase().slice(0, 16);
    const stop = String(input?.stop ?? "").trim().slice(0, 16);
    if (!line || !stop) throw new Error("line and stop are required");
    if (!/^[A-Z0-9]+$/.test(line)) throw new Error("invalid line");
    if (!/^[0-9]+$/.test(stop)) throw new Error("invalid stop id");
    return { line, stop };
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
    const smUrl = `https://bustime.mta.info/api/siri/stop-monitoring.json?key=${encodeURIComponent(
      apiKey,
    )}&MonitoringRef=${encodeURIComponent(data.stop)}&LineRef=${encodeURIComponent(
      lineRef,
    )}&version=2`;
    const vmUrl = `https://bustime.mta.info/api/siri/vehicle-monitoring.json?key=${encodeURIComponent(
      apiKey,
    )}&LineRef=${encodeURIComponent(lineRef)}&version=2`;

    try {
      const [smRes, vmRes] = await Promise.all([fetch(smUrl), fetch(vmUrl)]);
      if (!smRes.ok) {
        return {
          error: `Stop monitoring failed (${smRes.status})`,
          visits: [] as Visit[],
          vehicles: [] as Vehicle[],
        };
      }
      const sm: any = await smRes.json();
      const vm: any = vmRes.ok ? await vmRes.json() : null;

      const smDelivery =
        sm?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0];
      const errText =
        smDelivery?.ErrorCondition?.OtherError?.ErrorText ||
        sm?.Siri?.ServiceDelivery?.ErrorCondition?.OtherError?.ErrorText;
      if (errText) {
        return { error: String(errText), visits: [], vehicles: [] };
      }

      const monitored: any[] = smDelivery?.MonitoredStopVisit ?? [];
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