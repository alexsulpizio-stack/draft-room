import { matchOurPlayer } from "./espn";
import type { DraftPick, DraftType } from "./types";

export type YahooRawPick = {
  overall: number;
  team?: number;
  playerName: string;
  pos?: string;
  nflTeam?: string;
};

export type YahooSyncPayload = {
  picks: YahooRawPick[];
  href?: string;
  title?: string;
  ts: number;
};

export function isAllowedYahooHref(href?: string) {
  if (!href) return true;
  try {
    const host = new URL(href).hostname.toLowerCase();
    return host === "yahoo.com" || host.endsWith(".yahoo.com");
  } catch {
    return false;
  }
}

export function normalizeYahooPicks(raw: unknown): YahooRawPick[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: YahooRawPick[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<YahooRawPick>;
    const overall = Number(row.overall ?? 0);
    const playerName = typeof row.playerName === "string" ? row.playerName.replace(/\s+/g, " ").trim() : "";
    if (!(overall > 0) || !playerName || seen.has(overall)) continue;
    seen.add(overall);
    out.push({
      overall,
      team: Number(row.team ?? 0) || undefined,
      playerName,
      pos: typeof row.pos === "string" ? row.pos : undefined,
      nflTeam: typeof row.nflTeam === "string" ? row.nflTeam : undefined,
    });
  }
  return out.sort((a, b) => a.overall - b.overall);
}

export function teamForOverall(overall: number, teams: number, draftType: DraftType = "snake") {
  if (!(overall > 0) || !(teams > 0)) return 0;
  const round = Math.floor((overall - 1) / teams) + 1;
  const slot = ((overall - 1) % teams) + 1;
  if (draftType === "linear" || round % 2 === 1) return slot;
  return teams - slot + 1;
}

export function yahooToDraftPicks(
  raw: YahooRawPick[],
  teams: number,
  draftType: DraftType = "snake",
): { picks: DraftPick[]; unmatched: number } {
  const picks: DraftPick[] = [];
  let unmatched = 0;
  for (const row of raw) {
    const playerId = matchOurPlayer(row.playerName, row.pos, row.nflTeam);
    if (!playerId) {
      unmatched += 1;
      continue;
    }
    picks.push({
      overall: row.overall,
      team: row.team && row.team > 0 ? row.team : teamForOverall(row.overall, teams, draftType),
      playerId,
    });
  }
  return { picks, unmatched };
}
