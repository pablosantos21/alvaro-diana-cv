/**
 * Netlify Scheduled Function — trigger-rebuild
 *
 * Runs daily at 02:00 UTC.
 * If the last occurrence of any event in events.json fell on the previous day,
 * it triggers a Netlify Build Hook so the site is rebuilt (e.g. to remove the
 * finished event from the upcoming-events list).
 *
 * Required env variable:
 *   BUILD_HOOK_URL — the Netlify Build Hook URL to POST to.
 */

import type { Config } from "@netlify/functions";
import eventsData from "../../src/data/events.json";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Occurrence {
  date: string;
  eventUrl: string;
}

interface Play {
  title: string;
  composer: string;
  category: string;
  place: string;
  stageDirector: string;
  musicDirector: string;
  role: string;
  occurrences: Occurrence[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns yesterday's date as a YYYY-MM-DD string, in UTC.
 */
function getYesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

/**
 * Normalises a date string (with or without a time component) to YYYY-MM-DD.
 */
function toDateOnly(dateStr: string): string {
  return dateStr.split("T")[0];
}

/**
 * Returns true if the very last occurrence of a play falls on `dateString`.
 */
function isLastOccurrenceOn(play: Play, dateString: string): boolean {
  if (play.occurrences.length === 0) return false;
  const sorted = [...play.occurrences].sort((a, b) =>
    toDateOnly(a.date).localeCompare(toDateOnly(b.date))
  );
  return toDateOnly(sorted[sorted.length - 1].date) === dateString;
}

/**
 * POSTs to the Netlify Build Hook URL and throws if the response is not OK.
 */
async function triggerBuildHook(url: string): Promise<void> {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(
      `Build hook responded with HTTP ${response.status} ${response.statusText}`
    );
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(_req: Request): Promise<Response> {
  const buildHookUrl = process.env.BUILD_HOOK_URL;

  if (!buildHookUrl) {
    const msg = "BUILD_HOOK_URL environment variable is not set.";
    console.error(`[trigger-rebuild] ${msg}`);
    return Response.json({ message: msg, triggered: false }, { status: 500 });
  }

  const yesterday = getYesterdayUTC();
  const plays = eventsData.plays as Play[];

  // Find every play whose run finished yesterday (last occurrence = yesterday).
  const finishedYesterday = plays.filter((play) =>
    isLastOccurrenceOn(play, yesterday)
  );

  if (finishedYesterday.length === 0) {
    const msg = `No event run ended on ${yesterday}. Build not triggered.`;
    console.log(`[trigger-rebuild] ${msg}`);
    return Response.json({ message: msg, triggered: false }, { status: 200 });
  }

  // At least one event run ended yesterday — rebuild the site.
  try {
    await triggerBuildHook(buildHookUrl);

    const titles = finishedYesterday.map((p) => p.title);
    const msg = `Build triggered. ${finishedYesterday.length} event run(s) ended on ${yesterday}: ${titles.join(", ")}.`;
    console.log(`[trigger-rebuild] ${msg}`);
    return Response.json(
      { message: msg, triggered: true, events: titles },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(
      `[trigger-rebuild] Failed to trigger build hook: ${errorMessage}`
    );
    return Response.json(
      {
        message: `Failed to trigger build hook: ${errorMessage}`,
        triggered: false,
      },
      { status: 502 }
    );
  }
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export const config: Config = {
  schedule: "0 2 * * *", // Every day at 02:00 UTC
};
