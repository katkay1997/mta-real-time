import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getEta } from "@/lib/eta.functions";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "MTA Subway Train Tracker — Live ETAs" },
      {
        name: "description",
        content:
          "Track NYC MTA subway train ETAs. Enter a train line and station to see the next arrival time.",
      },
    ],
  }),
});

const TRAINS = [
  "1","2","3","4","5","6","7","A","C","E","B","D","F","M","G","J","Z","L","N","Q","R","W","S",
];

function trainColors(t: string): { bg: string; fg: string } {
  if (["1","2","3"].includes(t)) return { bg: "#EE352E", fg: "#FFFFFF" };
  if (["4","5","6"].includes(t)) return { bg: "#00933C", fg: "#FFFFFF" };
  if (t === "7") return { bg: "#B933AD", fg: "#FFFFFF" };
  if (["A","C","E"].includes(t)) return { bg: "#0039A6", fg: "#FFFFFF" };
  if (["B","D","F","M"].includes(t)) return { bg: "#FF6319", fg: "#FFFFFF" };
  if (t === "G") return { bg: "#6CBE45", fg: "#FFFFFF" };
  if (["J","Z"].includes(t)) return { bg: "#996633", fg: "#FFFFFF" };
  if (["N","Q","R","W"].includes(t)) return { bg: "#FCCC0A", fg: "#000000" };
  // L, S, default → grey
  return { bg: "#A7A9AC", fg: "#000000" };
}

type Arrival = { destination: string; minutes: number };

function Index() {
  const fetchEta = useServerFn(getEta);
  const [train, setTrain] = useState("");
  const [station, setStation] = useState("");
  const [loading, setLoading] = useState(false);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setArrivals([]);

    if (!train.trim() || !station.trim()) {
      setError("Please enter both a train and a station.");
      return;
    }

    setLoading(true);
    try {
      const result = await fetchEta({
        data: { train: train.trim().toUpperCase(), station: station.trim() },
      });
      if (result.error) {
        setError(result.error);
      } else if (!result.arrivals || result.arrivals.length === 0) {
        setInfo("No upcoming trains found.");
      } else {
        setArrivals(result.arrivals);
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            MTA Subway Train Tracker
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter a train line and a station to see the next arrival.
          </p>
        </header>

        <form onSubmit={onSearch} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <input
              type="text"
              value={train}
              onChange={(e) => setTrain(e.target.value)}
              placeholder="Train (e.g. A, 1, L)"
              maxLength={5}
              aria-label="Train line"
              className="w-full rounded-md bg-secondary px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              type="text"
              value={station}
              onChange={(e) => setStation(e.target.value)}
              placeholder="Station (e.g. Times Square)"
              maxLength={100}
              aria-label="Station name"
              className="w-full rounded-md bg-secondary px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        <div className="mt-6 min-h-[3rem]" aria-live="polite">
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
              {error}
            </p>
          )}
          {info && !error && (
            <p className="rounded-md border border-border bg-secondary px-4 py-3 text-sm text-muted-foreground">
              {info}
            </p>
          )}
          {arrivals.length > 0 && !error && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Next Arrivals
              </div>
              {arrivals.map((a, i) => {
                const t = train.trim().toUpperCase();
                const c = trainColors(t);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-4 rounded-md border border-border bg-secondary px-4 py-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold"
                        style={{ backgroundColor: c.bg, color: c.fg }}
                      >
                        {t}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">
                          {t} Train
                        </div>
                        <div className="truncate text-base font-semibold text-foreground">
                          {/^(Uptown|Downtown|Northbound|Southbound|Eastbound|Westbound)$/i.test(a.destination)
                            ? a.destination
                            : `to ${a.destination}`}
                        </div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-eta whitespace-nowrap">
                      {a.minutes} {a.minutes === 1 ? "min" : "mins"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            All MTA Subway Lines
          </h2>
          <div className="flex flex-wrap gap-2">
            {TRAINS.map((t) => {
              const c = trainColors(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTrain(t)}
                  className="flex h-10 w-10 items-center justify-center rounded-full font-bold transition hover:opacity-80"
                  style={{ backgroundColor: c.bg, color: c.fg }}
                  aria-label={`Select train ${t}`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
