import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { NavBar } from "@/components/NavBar";
import { getBusArrivals, findStopsByAddress, type NearbyStop } from "@/lib/bus.functions";

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

function BusPage() {
  const fetchBus = useServerFn(getBusArrivals);
  const lookupStops = useServerFn(findStopsByAddress);
  const [busLine, setBusLine] = useState("");
  const [address, setAddress] = useState("");
  const [nearbyStops, setNearbyStops] = useState<NearbyStop[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string>("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
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
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchBus({
          data: { line: line.toUpperCase(), stop: stopId },
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        if (result.error) {
          setVisits(result.visits as Visit[]);
          setVehicles(result.vehicles as Vehicle[]);
          setError(result.error);
          setLastUpdate(Date.now());
          setSecondsLeft(REFRESH_SECONDS);
          return;
        }
        setVisits(result.visits as Visit[]);
        setVehicles(result.vehicles as Vehicle[]);
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
    [fetchBus],
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
    if (!l) return;
    if (!selectedStopId) {
      setLookupError("Please select a stop from the list before searching.");
      return;
    }
    setSubmitted({ line: l, stop: selectedStopId });
  };

  const onLookup = async () => {
    const a = address.trim();
    if (!a) return;
    setLookupLoading(true);
    setLookupError(null);
    setNearbyStops([]);
    setSelectedStopId("");
    try {
      const res = await lookupStops({ data: { address: a } });
      if (res.error) {
        setLookupError(res.error);
        return;
      }
      setNearbyStops(res.stops as NearbyStop[]);
    } catch (err) {
      setLookupError((err as Error).message || "Address lookup failed.");
    } finally {
      setLookupLoading(false);
    }
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

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="text"
            value={busLine}
            onChange={(e) => setBusLine(e.target.value)}
            placeholder="Bus number (e.g. B46, M15, Q58)"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white placeholder:text-neutral-500 focus:border-blue-400/60 focus:outline-none"
            autoComplete="off"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onLookup();
                }
              }}
              placeholder="Address or intersection (e.g. Flatbush Ave & Church Ave, Brooklyn)"
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white placeholder:text-neutral-500 focus:border-blue-400/60 focus:outline-none"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={onLookup}
              disabled={!address.trim() || lookupLoading}
              className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              {lookupLoading ? "…" : "Find stops"}
            </button>
          </div>

          {lookupError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {lookupError}
            </div>
          )}

          {nearbyStops.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/30 p-2">
              <div className="mb-1 px-2 pt-1 text-[11px] font-bold uppercase tracking-widest text-neutral-400">
                Select a stop ({nearbyStops.length} nearby)
              </div>
              <ul className="max-h-64 overflow-y-auto">
                {nearbyStops.map((s) => {
                  const active = selectedStopId === s.stopId;
                  return (
                    <li key={s.stopId}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStopId(s.stopId);
                          setLookupError(null);
                        }}
                        className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${
                          active
                            ? "bg-blue-500/20 text-white"
                            : "text-neutral-200 hover:bg-white/5"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">
                            {s.name}
                          </div>
                          {s.routes.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {s.routes.slice(0, 8).map((r) => (
                                <span
                                  key={r}
                                  className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-neutral-200"
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {active && (
                          <span className="shrink-0 text-[11px] font-bold text-blue-200">
                            ✓
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-base font-bold text-white transition hover:bg-red-500 disabled:opacity-50"
            disabled={!busLine.trim() || !selectedStopId}
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