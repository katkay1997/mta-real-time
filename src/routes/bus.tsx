import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { NavBar } from "@/components/NavBar";

export const Route = createFileRoute("/bus")({
  component: BusPage,
  head: () => ({
    meta: [
      { title: "MTA Bus Feed — Live Arrivals" },
      {
        name: "description",
        content: "Real-time NYC MTA bus arrivals via SIRI BusTime API.",
      },
    ],
  }),
});

const REFRESH_SECONDS = 30;
const BG =
  "linear-gradient(135deg, #0d1b2a 0%, #1b2a4a 50%, #0d1b2a 100%)";

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

function etaColor(min: number | null): string {
  if (min == null) return "#9CA3AF";
  if (min < 2) return "#FF4040";
  if (min <= 5) return "#FFB020";
  return "#22C55E";
}

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

function BusPage() {
  const apiKey = import.meta.env.VITE_MTA_BUS_API_KEY as string | undefined;

  const [busLine, setBusLine] = useState("");
  const [stop, setStop] = useState("");
  const [submitted, setSubmitted] = useState<{ line: string; stop: string } | null>(
    null,
  );
  const [visits, setVisits] = useState<Visit[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_SECONDS);
  const [, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(
    async (line: string, stopId: string) => {
      if (!apiKey) {
        setError(
          "API key not configured. Please add your MTA BusTime API key.",
        );
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      try {
        const lineRef = `MTA NYCT_${line.toUpperCase()}`;
        const smUrl = `https://bustime.mta.info/api/siri/stop-monitoring.json?key=${encodeURIComponent(
          apiKey,
        )}&MonitoringRef=${encodeURIComponent(stopId)}&LineRef=${encodeURIComponent(
          lineRef,
        )}&version=2`;
        const vmUrl = `https://bustime.mta.info/api/siri/vehicle-monitoring.json?key=${encodeURIComponent(
          apiKey,
        )}&LineRef=${encodeURIComponent(lineRef)}&version=2`;

        const [smRes, vmRes] = await Promise.all([
          fetch(smUrl, { signal: ac.signal }),
          fetch(vmUrl, { signal: ac.signal }),
        ]);
        if (!smRes.ok) throw new Error(`Stop monitoring failed (${smRes.status})`);
        const sm = await smRes.json();
        const vm = vmRes.ok ? await vmRes.json() : null;

        const smDelivery =
          sm?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0];
        const errText =
          smDelivery?.ErrorCondition?.OtherError?.ErrorText ||
          sm?.Siri?.ServiceDelivery?.ErrorCondition?.OtherError?.ErrorText;
        if (errText) {
          setVisits([]);
          setVehicles([]);
          setError(errText);
          setLastUpdate(Date.now());
          setSecondsLeft(REFRESH_SECONDS);
          return;
        }

        const monitored: any[] = smDelivery?.MonitoredStopVisit ?? [];
        const parsedVisits: Visit[] = monitored.map((v) => {
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
            (j.LineRef ? String(j.LineRef).split("_").pop() : line.toUpperCase());
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
        parsedVisits.sort(
          (a, b) => (a.etaMin ?? 999) - (b.etaMin ?? 999),
        );

        const vmActivities: any[] =
          vm?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.[0]
            ?.VehicleActivity ?? [];
        const parsedVehicles: Vehicle[] = vmActivities.map((a) => {
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

        setVisits(parsedVisits);
        setVehicles(parsedVehicles);
        setLastUpdate(Date.now());
        setSecondsLeft(REFRESH_SECONDS);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.error(err);
        setError(
          (err as Error).message ||
            "Could not reach MTA BusTime. Try again shortly.",
        );
      } finally {
        setLoading(false);
      }
    },
    [apiKey],
  );

  useEffect(() => {
    if (!submitted) return;
    fetchData(submitted.line, submitted.stop);
    const id = setInterval(
      () => fetchData(submitted.line, submitted.stop),
      REFRESH_SECONDS * 1000,
    );
    return () => clearInterval(id);
  }, [submitted, fetchData]);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const l = busLine.trim();
    const s = stop.trim();
    if (!l || !s) return;
    setSubmitted({ line: l, stop: s });
  };

  const secondsAgo = lastUpdate
    ? Math.floor((Date.now() - lastUpdate) / 1000)
    : 0;

  return (
    <main className="min-h-screen text-white" style={{ background: BG }}>
      <NavBar />
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        <header className="mb-5">
          <h1
            className="text-2xl font-extrabold tracking-tight sm:text-3xl"
            style={{
              textShadow:
                "0 0 20px rgba(0, 120, 255, 0.6), 0 0 40px rgba(0, 80, 200, 0.3)",
            }}
          >
            MTA Bus Feed
          </h1>
          <p className="mt-1 text-xs text-neutral-400">
            Real-time bus arrivals from MTA BusTime
          </p>
        </header>

        {!apiKey && (
          <div className="mb-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
            API key not configured. Please add your MTA BusTime API key as
            <code className="mx-1 rounded bg-black/30 px-1">VITE_MTA_BUS_API_KEY</code>.
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="text"
            value={busLine}
            onChange={(e) => setBusLine(e.target.value)}
            placeholder="Bus number (e.g. B46, M15, Q58)"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white placeholder:text-neutral-500 focus:border-blue-400/60 focus:outline-none"
            autoComplete="off"
          />
          <input
            type="text"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            placeholder="Bus stop (5-digit MTA stop ID)"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white placeholder:text-neutral-500 focus:border-blue-400/60 focus:outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-base font-bold text-white transition hover:bg-red-500 disabled:opacity-50"
            disabled={!busLine.trim() || !stop.trim()}
          >
            Search
          </button>
        </form>

        {submitted && (
          <>
            <div className="mt-5 flex items-center justify-between text-xs text-neutral-400">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      loading ? "animate-ping bg-yellow-400" : "animate-ping bg-green-500"
                    }`}
                  />
                  <span
                    className={`relative inline-flex h-2 w-2 rounded-full ${
                      loading ? "bg-yellow-400" : "bg-green-500"
                    }`}
                  />
                </span>
                <span>
                  {lastUpdate
                    ? `Updated ${secondsAgo}s ago`
                    : loading
                      ? "Loading…"
                      : "—"}
                </span>
              </div>
              <span>Refresh in {secondsLeft}s</span>
            </div>

            {error && (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            {!loading && !error && visits.length === 0 && (
              <div className="mt-4 rounded-xl border border-white/10 bg-black/30 px-4 py-8 text-center text-sm text-neutral-300">
                No active buses found for this stop. Try a different stop ID
                or check the route number.
              </div>
            )}

            {visits.length > 0 && (
              <ul className="mt-4 space-y-2">
                {visits.slice(0, 5).map((v, i) => (
                  <li
                    key={`${v.route}-${i}-${v.expectedEpoch ?? i}`}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-3"
                  >
                    <span
                      className="inline-flex h-9 min-w-[44px] shrink-0 items-center justify-center rounded-full px-2 text-sm font-bold text-white"
                      style={{ backgroundColor: "#0039A6" }}
                    >
                      🚌 {v.route}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-bold text-white">
                        {v.destination}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                        {v.stopsAway != null && (
                          <span>
                            {v.stopsAway} stop{v.stopsAway === 1 ? "" : "s"} away
                          </span>
                        )}
                        {v.proximity && (
                          <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[11px] font-semibold text-blue-200">
                            {v.proximity}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className="text-2xl font-extrabold leading-none tabular-nums"
                        style={{ color: etaColor(v.etaMin) }}
                      >
                        {v.etaMin == null
                          ? "—"
                          : v.etaMin <= 0
                            ? "Now"
                            : `${v.etaMin} min`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {vehicles.length > 0 && (
              <section className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-neutral-400">
                  Live vehicles on {submitted.line.toUpperCase()} ·{" "}
                  {vehicles.length} active
                </h3>
                <ul className="space-y-1.5 text-sm">
                  {vehicles.slice(0, 6).map((vh) => (
                    <li
                      key={vh.ref}
                      className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 last:border-0"
                    >
                      <span className="truncate text-neutral-200">
                        #{vh.ref} · {vh.location}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-400">
                        {vh.progress}
                        {vh.occupancy ? ` · ${vh.occupancy}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}