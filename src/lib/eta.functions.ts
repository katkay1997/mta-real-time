import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  train: z.string().trim().min(1).max(5),
  station: z.string().trim().min(1).max(100),
});

export const getEta = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return { eta: null, error: "TAVILY_API_KEY is not configured" };
    }

    const query = `Next ${data.train} train arrival time ETA at ${data.station} MTA subway station right now`;

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
          max_results: 5,
        }),
      });

      if (!res.ok) {
        return { eta: null, error: `Search failed (${res.status})` };
      }

      const json: any = await res.json();
      const answer: string = json.answer || "";
      const snippets: string = (json.results || [])
        .map((r: any) => r.content || "")
        .join(" ");
      const haystack = `${answer} ${snippets}`;

      // Try to extract a minute-based ETA
      const minuteMatch = haystack.match(/(\d{1,3})\s*(?:min(?:ute)?s?)/i);
      // Or a clock time like 3:45 pm
      const timeMatch = haystack.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i);

      let eta: string | null = null;
      if (minuteMatch) {
        eta = `${minuteMatch[1]} min`;
      } else if (timeMatch) {
        eta = timeMatch[1];
      } else if (answer) {
        eta = answer.length > 200 ? answer.slice(0, 200) + "…" : answer;
      }

      if (!eta) {
        return { eta: null, error: null };
      }

      return { eta, error: null };
    } catch (err: any) {
      console.error("Tavily error", err);
      return { eta: null, error: "Failed to reach search service" };
    }
  });