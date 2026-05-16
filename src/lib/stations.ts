import stopsData from "./mta-stops.json";

export type Station = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  n: string;
  lines: string[];
};

const BLOCKED_LINES = new Set(["FX", "7X"]);
function isBlockedLine(l: string): boolean {
  return BLOCKED_LINES.has(String(l).toUpperCase());
}

export const STATIONS = (stopsData as Station[]).map((s) => ({
  ...s,
  lines: s.lines.filter((l) => !isBlockedLine(l)),
})).filter((s) => s.lines.length > 0);
const STATION_BY_ID = new Map<string, Station>(STATIONS.map((s) => [s.id, s]));

export function getStation(id: string): Station | undefined {
  return STATION_BY_ID.get(id);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchStations(query: string, limit = 8): Station[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(" ").filter((t) => t.length >= 1);
  const scored: { s: Station; score: number }[] = [];
  for (const s of STATIONS) {
    let score = 0;
    if (s.n === q) score = 1000;
    else if (s.n.startsWith(q)) score = 600;
    else if (s.n.includes(q)) score = 400;
    else {
      const stopTokens = s.n.split(" ");
      let hits = 0;
      for (const t of tokens) {
        if (stopTokens.some((st) => st.startsWith(t))) hits++;
      }
      if (hits === tokens.length) score = 200 + hits * 20;
      else if (hits > 0) score = hits * 30;
    }
    if (score > 0) scored.push({ s, score: score - s.n.length * 0.1 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.s);
}

export function distanceMeters(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearbyStations(
  lat: number, lon: number, n = 4, excludeId?: string,
): Array<Station & { distance: number }> {
  return STATIONS
    .filter((s) => s.id !== excludeId)
    .map((s) => ({ ...s, distance: distanceMeters(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}
