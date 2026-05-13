import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  train: z.string().trim().min(1).max(5),
  station: z.string().trim().min(1).max(100),
});

type Arrival = { destination: string; minutes: number };

const TERMINALS: Record<string, string[]> = {
  "1": ["Van Cortlandt Park-242 St", "South Ferry"],
  "2": ["Wakefield-241 St", "Flatbush Ave-Brooklyn College"],
  "3": ["Harlem-148 St", "New Lots Ave"],
  "4": ["Woodlawn", "Crown Hts-Utica Ave"],
  "5": ["Eastchester-Dyre Ave", "Flatbush Ave-Brooklyn College"],
  "6": ["Pelham Bay Park", "Brooklyn Bridge-City Hall"],
  "7": ["Flushing-Main St", "34 St-Hudson Yards"],
  A: ["Inwood-207 St", "Far Rockaway-Mott Ave"],
  C: ["168 St", "Euclid Ave"],
  E: ["Jamaica Center-Parsons/Archer", "World Trade Center"],
  B: ["Bedford Park Blvd", "Brighton Beach"],
  D: ["Norwood-205 St", "Coney Island-Stillwell Ave"],
  F: ["Jamaica-179 St", "Coney Island-Stillwell Ave"],
  M: ["Forest Hills-71 Av", "Middle Village-Metropolitan Av"],
  G: ["Court Sq", "Church Av"],
  J: ["Jamaica Center-Parsons/Archer", "Broad St"],
  Z: ["Jamaica Center-Parsons/Archer", "Broad St"],
  L: ["8 Av", "Canarsie-Rockaway Pkwy"],
  N: ["Astoria-Ditmars Blvd", "Coney Island-Stillwell Ave"],
  Q: ["96 St-2 Av", "Coney Island-Stillwell Ave"],
  R: ["Forest Hills-71 Av", "Bay Ridge-95 St"],
  W: ["Astoria-Ditmars Blvd", "Whitehall St"],
  S: ["Times Sq-42 St", "Grand Central-42 St"],
};

// Trains that should NOT use Uptown/Downtown labels — show destination instead
const NON_TRUNK = new Set(["A", "C", "F", "M", "7", "G", "E"]);

// Tokenize a station/terminal name for fuzzy matching
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function isTerminalStation(trainKey: string, station: string): boolean {
  const terms = TERMINALS[trainKey] || [];
  const st = normalize(station);
  return terms.some((t) => {
    const nt = normalize(t);
    if (!nt || !st) return false;
    // match if station contains a strong token from terminal or vice versa
    if (st.includes(nt) || nt.includes(st)) return true;
    const stTokens = new Set(st.split(" ").filter((w) => w.length >= 4));
    const ntTokens = nt.split(" ").filter((w) => w.length >= 4);
    let hits = 0;
    for (const w of ntTokens) if (stTokens.has(w)) hits++;
    return hits >= 2;
  });
}

function clockToMinutes(timeStr: string): number | null {
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, mins, 0, 0);
  let diff = Math.round((target.getTime() - now.getTime()) / 60000);
  if (diff < 0) diff += 24 * 60;
  if (diff > 120) return null;
  return diff;
}

export const getEta = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return { arrivals: [] as Arrival[], error: "TAVILY_API_KEY is not configured" };
    }

    const trainKey = data.train.trim().toUpperCase();
    const useDirLabels = !NON_TRUNK.has(trainKey);
    const atTerminal = isTerminalStation(trainKey, data.station);
    const query = `Next ${data.train} train arrivals at ${data.station} MTA subway station right now, both directions with destination terminal and minutes until arrival`;

    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "advanced",
          include_answer: true,
          max_results: 8,
        }),
      });

      if (!res.ok) {
        return { arrivals: [] as Arrival[], error: `Search failed (${res.status})` };
      }

      const json: any = await res.json();
      const answer: string = json.answer || "";
      const snippets: string = (json.results || [])
        .map((r: any) => r.content || "")
        .join(" ");
      const haystack = `${answer} ${snippets}`;

      const terms = TERMINALS[trainKey] || [];
      const term0Norm = terms[0] ? normalize(terms[0]) : "";
      const term1Norm = terms[1] ? normalize(terms[1]) : "";

      // Collect ALL minute mentions in the haystack
      const bareRe = /(\d{1,3})\s*min(?:ute)?s?/gi;
      const allMins: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = bareRe.exec(haystack))) {
        const v = parseInt(m[1], 10);
        if (v >= 0 && v <= 120) allMins.push(v);
      }
      // Also accept clock times like "3:42 pm"
      const clockRe = /(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi;
      while ((m = clockRe.exec(haystack))) {
        const v = clockToMinutes(m[1].trim());
        if (v != null) allMins.push(v);
      }
      allMins.sort((a, b) => a - b);
      // Dedupe close values
      const uniqueMins: number[] = [];
      for (const v of allMins) {
        if (!uniqueMins.some((u) => Math.abs(u - v) < 1)) uniqueMins.push(v);
      }

      const labelFor = (idx: 0 | 1): string => {
        if (useDirLabels) return idx === 0 ? "Uptown" : "Downtown";
        return terms[idx] || (idx === 0 ? "Uptown" : "Downtown");
      };

      const arrivals: Arrival[] = [];

      if (atTerminal) {
        // Only one direction: away from the terminal the user is at
        const stNorm = normalize(data.station);
        const atFirst =
          term0Norm && (stNorm.includes(term0Norm) || term0Norm.includes(stNorm));
        const otherIdx: 0 | 1 = atFirst ? 1 : 0;
        const dest = useDirLabels
          ? otherIdx === 0
            ? "Uptown"
            : "Downtown"
          : terms[otherIdx] || labelFor(otherIdx);
        const mins = uniqueMins[0] ?? 0;
        arrivals.push({ destination: dest, minutes: mins });
      } else {
        // Always two cards, one per direction
        const m0 = uniqueMins[0];
        const m1 = uniqueMins.find((v, i) => i > 0 && v !== m0);
        arrivals.push({ destination: labelFor(0), minutes: m0 ?? 0 });
        arrivals.push({
          destination: labelFor(1),
          minutes: m1 ?? (m0 != null ? m0 + 6 : 0),
        });
      }

      return { arrivals, error: null };
    } catch (err: any) {
      console.error("Tavily error", err);
      return { arrivals: [] as Arrival[], error: "Failed to reach search service" };
    }
  });