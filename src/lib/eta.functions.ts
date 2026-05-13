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

      const arrivals: Arrival[] = [];
      const seen = new Set<string>();
      const dirSeen = new Set<string>(); // one arrival per direction

      const terms = TERMINALS[trainKey] || [];
      const term0Norm = terms[0] ? normalize(terms[0]) : "";
      const term1Norm = terms[1] ? normalize(terms[1]) : "";

      const directionOf = (dest: string): string => {
        const d = normalize(dest);
        if (term0Norm && (d.includes(term0Norm) || term0Norm.includes(d))) return "A";
        if (term1Norm && (d.includes(term1Norm) || term1Norm.includes(d))) return "B";
        if (/uptown|northbound/i.test(dest)) return "A";
        if (/downtown|southbound/i.test(dest)) return "B";
        return dest.toLowerCase();
      };

      // Pattern 1: "to <destination> in <N> min" or "to <destination> - <N> min"
      const toMinRe =
        /(?:to|toward(?:s)?|bound for)\s+([A-Z][\w./'\- ]{2,40}?)\s*(?:[-–—,:]| in | arriving in | is | will arrive in )\s*(\d{1,3})\s*min/gi;
      // Pattern 2: "<Uptown|Downtown> ... <N> min"
      const dirMinRe =
        /(uptown|downtown|northbound|southbound|eastbound|westbound)[^.]{0,80}?(\d{1,3})\s*min/gi;
      // Pattern 3: "to <destination> at <time>"
      const toTimeRe =
        /(?:to|toward(?:s)?|bound for)\s+([A-Z][\w./'\- ]{2,40}?)\s*(?:at|arriving at|arrives at)\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi;

      const pushArrival = (destRaw: string, minutes: number) => {
        let dest = destRaw.trim().replace(/\s+/g, " ");
        const trainTok = trainKey;
        const cleanedDest = dest.replace(/\s*train\s*$/i, "").trim();
        if (
          !cleanedDest ||
          cleanedDest.toUpperCase() === trainTok ||
          /^(the\s+)?\d{1,2}$/i.test(cleanedDest) ||
          /^[A-Z]$/i.test(cleanedDest)
        ) {
          return;
        }
        const dirOnly = /^(uptown|downtown|northbound|southbound|eastbound|westbound)$/i;
        if (dirOnly.test(dest)) {
          if (/northbound|uptown/i.test(dest)) dest = useDirLabels ? "Uptown" : (terms[0] || "Uptown");
          else if (/southbound|downtown/i.test(dest)) dest = useDirLabels ? "Downtown" : (terms[1] || "Downtown");
          else dest = dest.charAt(0).toUpperCase() + dest.slice(1).toLowerCase();
        } else if (!useDirLabels) {
          // strip stray Uptown/Downtown words for non-trunk trains
          dest = dest.replace(/\b(uptown|downtown|northbound|southbound)\b/gi, "").trim();
          if (!dest) return;
        }
        const key = `${dest.toLowerCase()}|${minutes}`;
        if (seen.has(key)) return;
        if (minutes < 0 || minutes > 120) return;
        const dir = directionOf(dest);
        if (dirSeen.has(dir)) return; // one arrival per direction
        dirSeen.add(dir);
        seen.add(key);
        arrivals.push({ destination: dest, minutes });
      };

      let m: RegExpExecArray | null;
      while ((m = toMinRe.exec(haystack)) && arrivals.length < 4) {
        pushArrival(m[1], parseInt(m[2], 10));
      }
      while ((m = dirMinRe.exec(haystack)) && arrivals.length < 4) {
        const dirRaw = m[1];
        let dir = dirRaw;
        if (/northbound/i.test(dir)) dir = "Uptown";
        else if (/southbound/i.test(dir)) dir = "Downtown";
        else dir = dir.charAt(0).toUpperCase() + dir.slice(1).toLowerCase();
        pushArrival(dir, parseInt(m[2], 10));
      }
      while ((m = toTimeRe.exec(haystack)) && arrivals.length < 4) {
        const mins = clockToMinutes(m[2].trim());
        if (mins != null) pushArrival(m[1], mins);
      }

      // Fallback: bare minute mentions if we still have nothing
      if (arrivals.length === 0) {
        const bareRe = /(\d{1,3})\s*min(?:ute)?s?/gi;
        const mins: number[] = [];
        const cap = atTerminal ? 1 : 2;
        while ((m = bareRe.exec(haystack)) && mins.length < cap) {
          const v = parseInt(m[1], 10);
          if (v >= 0 && v <= 120) mins.push(v);
        }
        mins.forEach((v, i) => {
          let dest: string;
          if (atTerminal) {
            // From a terminal, trains only depart toward the OTHER end
            const stNorm = normalize(data.station);
            const otherTerm =
              term0Norm && (stNorm.includes(term0Norm) || term0Norm.includes(stNorm))
                ? terms[1]
                : terms[0];
            dest = otherTerm || (useDirLabels ? "Downtown" : "");
          } else if (useDirLabels) {
            dest = i === 0 ? "Uptown" : "Downtown";
          } else {
            dest = terms[i] || terms[0] || "";
          }
          if (dest) pushArrival(dest, v);
        });
      }

      arrivals.sort((a, b) => a.minutes - b.minutes);
      return { arrivals: arrivals.slice(0, atTerminal ? 1 : 2), error: null };
    } catch (err: any) {
      console.error("Tavily error", err);
      return { arrivals: [] as Arrival[], error: "Failed to reach search service" };
    }
  });