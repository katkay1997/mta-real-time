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

    const query = `Next two ${data.train} train arrivals at ${data.station} MTA subway station right now, with destination/direction and minutes until arrival`;

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

      const isManhattanStation = /manhattan|times sq|grand central|penn|herald|union sq|columbus|wall st|canal|14 st|34 st|42 st|59 st|72 st|86 st|96 st|125 st|harlem|midtown|downtown manhattan|upper (east|west)/i.test(
        data.station,
      );

      const arrivals: Arrival[] = [];
      const seen = new Set<string>();

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
        // Reject destinations that are just the train identifier
        const trainTok = data.train.trim().toUpperCase();
        const cleanedDest = dest.replace(/\s*train\s*$/i, "").trim();
        if (
          !cleanedDest ||
          cleanedDest.toUpperCase() === trainTok ||
          /^(the\s+)?\d{1,2}$/i.test(cleanedDest) ||
          /^[A-Z]$/i.test(cleanedDest)
        ) {
          return;
        }
        // Normalize direction tokens for Manhattan stations
        const dirOnly = /^(uptown|downtown|northbound|southbound|eastbound|westbound)$/i;
        if (dirOnly.test(dest)) {
          dest = dest.charAt(0).toUpperCase() + dest.slice(1).toLowerCase();
          if (/northbound/i.test(dest)) dest = "Uptown";
          if (/southbound/i.test(dest)) dest = "Downtown";
        }
        const key = `${dest.toLowerCase()}|${minutes}`;
        if (seen.has(key)) return;
        if (minutes < 0 || minutes > 120) return;
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
        while ((m = bareRe.exec(haystack)) && mins.length < 2) {
          const v = parseInt(m[1], 10);
          if (v >= 0 && v <= 120) mins.push(v);
        }
        const trainKey = data.train.trim().toUpperCase();
        const terms = TERMINALS[trainKey] || [];
        mins.forEach((v, i) => {
          const dest = isManhattanStation
            ? i === 0
              ? "Uptown"
              : "Downtown"
            : terms[i] || (i === 0 ? "Northbound" : "Southbound");
          pushArrival(dest, v);
        });
      }

      arrivals.sort((a, b) => a.minutes - b.minutes);
      return { arrivals: arrivals.slice(0, 2), error: null };
    } catch (err: any) {
      console.error("Tavily error", err);
      return { arrivals: [] as Arrival[], error: "Failed to reach search service" };
    }
  });