import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEta, getAlerts, type Arrival, type ServiceAlert } from "@/lib/eta.functions";
import {
  STATIONS,
  getStation,
  searchStations,
  nearbyStations,
  type Station,
} from "@/lib/stations";
import { NavBar } from "@/components/NavBar";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "MTA Subway Tracker — Live Arrival Times" },
      {
        name: "description",
        content:
          "Real-time NYC MTA subway arrivals with destinations, service alerts, and nearby stations.",
      },
    ],
  }),
});

function trainColors(t: string): { bg: string; fg: string } {
  if (["1", "2", "3"].includes(t)) return { bg: "#EE352E", fg: "#FFFFFF" };
  if (["4", "5", "6"].includes(t)) return { bg: "#00933C", fg: "#FFFFFF" };
  if (t === "7") return { bg: "#B933AD", fg: "#FFFFFF" };
  if (["A", "C", "E"].includes(t)) return { bg: "#0039A6", fg: "#FFFFFF" };
  if (["B", "D", "F", "M"].includes(t)) return { bg: "#FF6319", fg: "#FFFFFF" };
  if (t === "G") return { bg: "#6CBE45", fg: "#FFFFFF" };
  if (["J", "Z"].includes(t)) return { bg: "#996633", fg: "#FFFFFF" };
  if (["N", "Q", "R", "W"].includes(t)) return { bg: "#FCCC0A", fg: "#000000" };
  if (t === "L") return { bg: "#A7A9AC", fg: "#FFFFFF" };
  if (t === "SI" || t === "SIR") return { bg: "#0078C6", fg: "#FFFFFF" };
  return { bg: "#808183", fg: "#FFFFFF" };
}

function Bullet({ line, size = 28 }: { line: string; size?: number }) {
  if (line === "FX" || line === "7X") return null;
  const c = trainColors(line);
  const fontSize = Math.round(size * 0.55);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none"
      style={{
        backgroundColor: c.bg,
        color: c.fg,
        width: size,
        height: size,
        fontSize,
      }}
      aria-label={`${line} train`}
    >
      {line}
    </span>
  );
}

function etaColor(min: number): string {
  if (min < 2) return "#FF4040";
  if (min <= 5) return "#FFB020";
  return "#22C55E";
}

function clockTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const REFRESH_SECONDS = 30;

function Index() {
  const fetchEta = useServerFn(getEta);
  const fetchAlerts = useServerFn(getAlerts);

  // State
  const [query, setQuery] = useState("");
  const [station, setStation] = useState<Station | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);
  const [trainFilter, setTrainFilter] = useState<string | null>(null);
  const [bothDirections, setBothDirections] = useState(true);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_SECONDS);
  const [tick, setTick] = useState(0);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [nearbyOpen, setNearbyOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Suggestions
  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    return searchStations(query, 8);
  }, [query]);

  const nearby = useMemo(() => {
    if (!coords) return [];
    return nearbyStations(coords.lat, coords.lon, 4, station?.id);
  }, [coords, station?.id]);

  // Geolocation (lazy, on user click)
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => {},
      { timeout: 8000 },
    );
  }, []);

  // Load arrivals
  const loadArrivals = useCallback(
    async (s: Station, lineFilter: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const trains = lineFilter ? [lineFilter] : s.lines;
        const [eta, alertRes] = await Promise.all([
          fetchEta({ data: { stopId: s.id, trains } }),
          fetchAlerts({ data: { routes: s.lines } }),
        ]);
        if (eta.error) setError(eta.error);
        setArrivals(eta.arrivals || []);
        setAlerts(alertRes.alerts || []);
        setLastUpdate(Date.now());
        setSecondsLeft(REFRESH_SECONDS);
      } catch (err) {
        console.error(err);
        setError("Could not reach the MTA feed. Retrying soon.");
      } finally {
        setLoading(false);
      }
    },
    [fetchEta, fetchAlerts],
  );

  // Auto-refresh
  useEffect(() => {
    if (!station) return;
    loadArrivals(station, trainFilter);
    const interval = setInterval(() => loadArrivals(station, trainFilter), REFRESH_SECONDS * 1000);
    return () => clearInterval(interval);
  }, [station, trainFilter, loadArrivals]);

  // 1s tick for "X seconds ago" + countdown
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const onSelectStation = (s: Station) => {
    setStation(s);
    setQuery(s.name);
    setShowSuggest(false);
    setTrainFilter(null);
    setArrivals([]);
    inputRef.current?.blur();
  };

  // Group arrivals by direction
  const grouped = useMemo(() => {
    const byDir: { N: Arrival[]; S: Arrival[] } = { N: [], S: [] };
    for (const a of arrivals) byDir[a.direction].push(a);
    byDir.N.sort((a, b) => a.minutes - b.minutes);
    byDir.S.sort((a, b) => a.minutes - b.minutes);
    return byDir;
  }, [arrivals]);

  const visibleAlerts = alerts.filter((a) => !dismissedAlerts.has(a.id));

  const secondsAgo = lastUpdate ? Math.floor((Date.now() - lastUpdate) / 1000) : 0;

  return (
    <main
      className="min-h-screen text-white"
      style={{
        background:
          "linear-gradient(135deg, #0d1b2a 0%, #1b2a4a 50%, #0d1b2a 100%)",
      }}
    >
      <NavBar />
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        {/* Header */}
        <header className="mb-5">
          <h1
            className="text-2xl font-extrabold tracking-tight sm:text-3xl"
            style={{
              textShadow:
                "0 0 20px rgba(0, 120, 255, 0.6), 0 0 40px rgba(0, 80, 200, 0.3)",
            }}
          >
            MTA Subway Feed
          </h1>
          <p className="mt-1 text-xs text-neutral-400">
            Real-time arrivals from the MTA
          </p>
        </header>

        {/* Station search */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggest(true);
            }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            placeholder="Search a station (e.g. Times Sq, 23 St)"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3.5 text-base text-white placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none"
            aria-label="Search station"
            autoComplete="off"
          />
          {showSuggest && suggestions.length > 0 && (
            <div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelectStation(s)}
                  className="flex w-full items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3 text-left last:border-0 hover:bg-neutral-900"
                >
                  <span className="truncate text-sm font-medium text-white">
                    {s.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.lines.map((l) => (
                      <Bullet key={l} line={l} size={20} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Geo + nearby quick action */}
        {!station && (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              onClick={requestLocation}
              className="rounded-full border border-neutral-800 bg-neutral-900 px-4 py-2 text-neutral-200 hover:bg-neutral-800"
            >
              Use my location
            </button>
            {coords && nearby.slice(0, 3).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectStation(s)}
                className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 hover:bg-neutral-800"
              >
                <span className="text-neutral-200">{s.name}</span>
                <span className="text-xs text-neutral-500">
                  {Math.round(s.distance)}m
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Selected station + line filters */}
        {station && (
          <>
            <div className="mt-5 flex items-baseline justify-between gap-3">
              <h2 className="truncate text-xl font-bold">{station.name}</h2>
              <button
                type="button"
                onClick={() => {
                  setStation(null);
                  setQuery("");
                  setArrivals([]);
                  setAlerts([]);
                }}
                className="shrink-0 text-xs text-neutral-400 hover:text-white"
              >
                Change
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTrainFilter(null)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  trainFilter === null
                    ? "bg-white text-black"
                    : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                All
              </button>
              {station.lines.map((l) => {
                const active = trainFilter === l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setTrainFilter(active ? null : l)}
                    className={`rounded-full p-0.5 transition ${
                      active ? "ring-2 ring-white" : "opacity-80 hover:opacity-100"
                    }`}
                    aria-label={`Filter ${l} train`}
                  >
                    <Bullet line={l} size={28} />
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setBothDirections((v) => !v)}
                className="ml-auto rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-800"
              >
                {bothDirections ? "Both directions" : "One direction"}
              </button>
            </div>

            {/* Service alerts */}
            {visibleAlerts.length > 0 && (
              <div className="mt-4 space-y-2">
                {visibleAlerts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-sm"
                  >
                    <span className="mt-0.5 text-yellow-400">⚠</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-yellow-200">
                        {a.header}
                      </div>
                      {a.description && (
                        <div className="mt-1 line-clamp-3 text-xs text-yellow-100/80">
                          {a.description}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDismissedAlerts((prev) => {
                          const next = new Set(prev);
                          next.add(a.id);
                          return next;
                        })
                      }
                      className="text-yellow-300/70 hover:text-yellow-200"
                      aria-label="Dismiss alert"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Last updated bar */}
            <div className="mt-4 flex items-center justify-between text-xs text-neutral-400">
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

            {/* Arrivals board */}
            <section className="mt-4 space-y-6">
              {(["N", "S"] as const)
                .filter((dir) => bothDirections || grouped[dir].length >= grouped[dir === "N" ? "S" : "N"].length)
                .map((dir) => {
                  const list = grouped[dir].slice(0, 6);
                  if (list.length === 0) return null;
                  // Header label uses the most common destination/direction for this group
                  const headerLabel = list[0].directionLabel.replace(/^to /, "To ");
                  return (
                    <div key={dir}>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                          {headerLabel}
                        </h3>
                        <span className="text-[10px] uppercase tracking-widest text-neutral-600">
                          {dir === "N" ? "Northbound" : "Southbound"}
                        </span>
                      </div>
                      <ul className="divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-900 bg-neutral-950">
                        {list.map((a, i) => (
                          <li
                            key={`${a.tripId}-${a.arrivalEpoch}-${i}`}
                            className="flex items-center gap-3 px-3 py-3"
                          >
                            <Bullet line={a.route} size={36} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-base font-bold text-white">
                                {a.destination}
                              </div>
                              <div className="truncate text-xs text-neutral-500">
                                {a.directionLabel}
                              </div>
                            </div>
                            <div className="text-right">
                              <div
                                className="text-2xl font-extrabold leading-none tabular-nums"
                                style={{ color: etaColor(a.minutes) }}
                              >
                                {a.minutes <= 0 ? "Now" : `${a.minutes} min`}
                              </div>
                              <div className="mt-1 text-[11px] text-neutral-500 tabular-nums">
                                {clockTime(a.arrivalEpoch)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}

              {!loading && arrivals.length === 0 && !error && (
                <div className="rounded-xl border border-neutral-900 bg-neutral-950 px-4 py-8 text-center text-sm text-neutral-400">
                  No upcoming trains found.
                </div>
              )}
            </section>

            {/* Nearby stations */}
            <section className="mt-8">
              <button
                type="button"
                onClick={() => {
                  if (!coords) requestLocation();
                  setNearbyOpen((v) => !v);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-neutral-900 bg-neutral-950 px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold text-white">
                  Nearby stations
                </span>
                <span className="text-xs text-neutral-400">
                  {coords ? (nearbyOpen ? "Hide" : "Show") : "Enable location"}
                </span>
              </button>
              {nearbyOpen && coords && (
                <ul className="mt-2 space-y-1.5">
                  {nearby.slice(0, 3).map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onSelectStation(s)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-900 bg-neutral-950 px-3 py-2.5 text-left hover:bg-neutral-900"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">
                            {s.name}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {Math.round(s.distance)} m away
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {s.lines.map((l) => (
                            <Bullet key={l} line={l} size={20} />
                          ))}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* Tick reference (avoid unused-var warning) */}
        <span className="hidden">{tick}</span>
      </div>
    </main>
  );
}
