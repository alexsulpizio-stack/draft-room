import { matchByName, matchOurPlayer } from "./espn";
import type { Player, Position, Scoring } from "./types";

export type RankPatch = { fpRank?: number; dsRank?: number; adp?: number };

export type RankRefreshResult = {
  ok: boolean;
  scoring: Scoring;
  fetchedAt: number;
  fpUpdated?: string;
  fpMatched: number;
  dsMatched: number;
  fpTotal: number;
  dsTotal: number;
  patches: Record<string, RankPatch>;
  warnings: string[];
  error?: string;
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function fpUrl(scoring: Scoring) {
  if (scoring === "ppr") return "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php";
  if (scoring === "half") {
    return "https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php";
  }
  return "https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php";
}

function dsSlug(scoring: Scoring) {
  if (scoring === "ppr") return "ppr";
  if (scoring === "half") return "half-ppr";
  return "";
}

async function fetchText(url: string, extra?: HeadersInit) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/json", ...extra },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

function posOf(raw: string): Position {
  const p = raw.toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  return "DST";
}

function idFor(name: string, pos?: string, team?: string): string | null {
  if (pos && team && team !== "FA") {
    const matched = matchOurPlayer(name, posOf(pos), team);
    if (matched) return matched;
  }
  return matchByName(name)?.id ?? null;
}

export function parseFantasyProsEcr(html: string): {
  players: Array<{ name: string; rank: number; team: string; pos: string }>;
  updated?: string;
} {
  const m = html.match(/var ecrData\s*=\s*(\{[\s\S]*?\});/);
  if (!m) throw new Error("FantasyPros page did not include ecrData.");
  const data = JSON.parse(m[1]) as {
    last_updated?: string;
    players?: Array<{
      player_name?: string;
      rank_ecr?: number;
      player_team_id?: string;
      player_position_id?: string;
    }>;
  };
  const players = (data.players ?? [])
    .map((p) => ({
      name: p.player_name ?? "",
      rank: Number(p.rank_ecr),
      team: p.player_team_id ?? "FA",
      pos: p.player_position_id ?? "",
    }))
    .filter((p) => p.name && Number.isFinite(p.rank) && p.rank > 0);
  return { players, updated: data.last_updated };
}

export function parseDraftSharksTable(html: string): Array<{
  name: string;
  rank: number;
  pos: string;
}> {
  const out: Array<{ name: string; rank: number; pos: string }> = [];
  const re =
    /data-fantasy-position="([^"]+)"[\s\S]{0,500}?data-player-name="([^"]+)"[\s\S]{0,1500}?rank-index">\s*<span>(\d+)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = m[2].replace(/\s+/g, " ").trim();
    const rank = Number(m[3]);
    if (!name || !Number.isFinite(rank)) continue;
    out.push({ name, rank, pos: m[1] });
  }
  return out;
}

export async function refreshLiveRankings(scoring: Scoring): Promise<RankRefreshResult> {
  const warnings: string[] = [];
  const patches = new Map<string, RankPatch>();
  let fpUpdated: string | undefined;
  let fpTotal = 0;
  let dsTotal = 0;
  let fpMatched = 0;
  let dsMatched = 0;

  const fpJob = fetchText(fpUrl(scoring)).then(parseFantasyProsEcr);
  const dsUrl =
    "https://www.draftsharks.com/rankings/load-table?" +
    new URLSearchParams({
      pprSuperflexSlug: dsSlug(scoring),
      fantasyPosition: "",
      researchDepth: "rankings",
      playerGroup: "all",
    }).toString();
  const dsJob = fetchText(dsUrl, {
    "HX-Request": "true",
    Referer: `https://www.draftsharks.com/rankings/${dsSlug(scoring) || ""}`.replace(/\/$/, ""),
  }).then(parseDraftSharksTable);

  const [fpRes, dsRes] = await Promise.allSettled([fpJob, dsJob]);

  if (fpRes.status === "fulfilled") {
    fpUpdated = fpRes.value.updated;
    fpTotal = fpRes.value.players.length;
    for (const p of fpRes.value.players) {
      const id = idFor(p.name, p.pos, p.team);
      if (!id) continue;
      const cur = patches.get(id) ?? {};
      cur.fpRank = p.rank;
      patches.set(id, cur);
      fpMatched += 1;
    }
  } else {
    warnings.push(`FantasyPros: ${fpRes.reason instanceof Error ? fpRes.reason.message : "failed"}`);
  }

  if (dsRes.status === "fulfilled") {
    dsTotal = dsRes.value.length;
    for (const p of dsRes.value) {
      const id = idFor(p.name, p.pos);
      if (!id) continue;
      const cur = patches.get(id) ?? {};
      cur.dsRank = p.rank;
      patches.set(id, cur);
      dsMatched += 1;
    }
  } else {
    warnings.push(`DraftSharks: ${dsRes.reason instanceof Error ? dsRes.reason.message : "failed"}`);
  }

  if (fpMatched === 0 && dsMatched === 0) {
    return {
      ok: false,
      scoring,
      fetchedAt: Date.now(),
      fpMatched: 0,
      dsMatched: 0,
      fpTotal,
      dsTotal,
      patches: {},
      warnings,
      error: warnings.join(" · ") || "Could not reach FantasyPros or DraftSharks.",
    };
  }

  return {
    ok: true,
    scoring,
    fetchedAt: Date.now(),
    fpUpdated,
    fpMatched,
    dsMatched,
    fpTotal,
    dsTotal,
    patches: Object.fromEntries(patches),
    warnings,
  };
}

export function applyRankPatches(players: Player[], patches: Record<string, RankPatch> | undefined) {
  if (!patches || Object.keys(patches).length === 0) return players;
  return players.map((p) => {
    const u = patches[p.id];
    if (!u) return p;
    return {
      ...p,
      fpRank: u.fpRank ?? p.fpRank,
      dsRank: u.dsRank ?? p.dsRank,
      adp: u.adp ?? p.adp,
    };
  });
}

export function scoringLabel(scoring: Scoring) {
  if (scoring === "ppr") return "PPR";
  if (scoring === "half") return "Half PPR";
  return "Standard";
}
