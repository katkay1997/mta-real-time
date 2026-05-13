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

function Index() {
  const fetchEta = useServerFn(getEta);
  const [train, setTrain] = useState("");
  const [station, setStation] = useState("");
  const [loading, setLoading] = useState(false);
  const [eta, setEta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setEta(null);

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
      } else if (!result.eta) {
        setInfo("No ETA found for this train and station.");
      } else {
        setEta(result.eta);
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
          {eta && !error && (
            <div className="rounded-md border border-eta/30 bg-secondary px-4 py-4 text-center">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Next {train.toUpperCase()} at {station}
              </div>
              <div className="mt-1 text-3xl font-bold text-eta">{eta}</div>
            </div>
          )}
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            All MTA Subway Lines
          </h2>
          <div className="flex flex-wrap gap-2">
            {TRAINS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrain(t)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary font-bold text-foreground transition hover:bg-muted"
                aria-label={`Select train ${t}`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
