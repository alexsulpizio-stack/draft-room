import { matchRankingSource } from "./espn";
import type { Player } from "./types";

export type RankImportSource = "fp" | "ds";

export type RankImportUpdate = {
  fpRank?: number;
  dsRank?: number;
  adp?: number;
};

export type RankImportResult = {
  updates: Map<string, RankImportUpdate>;
  unmatched: string[];
  matched: number;
  source: RankImportSource;
};

function clean(s: string) {
  return s.trim().replace(/^["']|["']$/g, "");
}

function looksLikeHeader(line: string) {
  const l = line.toLowerCase();
  // Rank,Player rows include the word "player" in the name — only treat as a
  // header when the first cell is a label, not a numeric rank.
  const first = clean(line.split(/[,\t]/)[0] ?? "").toLowerCase();
  if (/^\d+(\.\d+)?$/.test(first)) return false;
  return (
    /^(rk|rank|ecr|overall|#)$/.test(first) ||
    l.includes("player") ||
    l.includes("rank") ||
    l.includes("name")
  );
}

/** Prefer RK / rank_ecr / ECR. Never rank_ave, rank_min, FPTS, player_id, owned. */
function ecrRankColumnIndex(cols: string[]): number {
  const exact = cols.findIndex((c) => /^(rk|rank|ecr|overall|rank_ecr|overall rank|overall_rank)$/.test(c));
  if (exact >= 0) return exact;
  return cols.findIndex((c) => {
    if (/rank[_\s-]?(ave|avg|average|min|max|std|adp)/.test(c)) return false;
    if (/\b(fpts|points|proj|owned|player_id|player id|3d|value)\b/.test(c)) return false;
    return /^(rk|ecr)\b/.test(c) || c.includes("rank_ecr") || c === "rank" || c.includes("overall");
  });
}

function teamColumnIndex(cols: string[]): number {
  return cols.findIndex((c) => /^(team|tm|player_team_id)$/.test(c) || c === "nfl team");
}

function posColumnIndex(cols: string[]): number {
  return cols.findIndex((c) => /^(pos|position|player_position_id)$/.test(c));
}

function stripPlayerDecorations(name: string) {
  return name
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/\s+(QB|RB|WR|TE|K|DST|DEF)\d*$/i, "")
    .replace(/\s+[A-Z]{2,3}$/, "")
    .trim();
}

/**
 * Accepts FantasyPros or DraftSharks CSV/TSV (or Rank,Player paste).
 * Overlays fpRank (FP) or dsRank (DS), plus ADP when present.
 */
export function parseRankingPaste(
  text: string,
  source: RankImportSource = "fp",
): RankImportResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const updates = new Map<string, RankImportUpdate>();
  const unmatched: string[] = [];
  if (lines.length === 0) return { updates, unmatched, matched: 0, source };

  const header = looksLikeHeader(lines[0]) ? lines[0] : "";
  const rows = header ? lines.slice(1) : lines;
  const cols = header.split(/[,\t]/).map((c) => clean(c).toLowerCase());

  const idx = (names: string[]) => cols.findIndex((c) => names.some((n) => c.includes(n)));
  const playerIdx = header ? Math.max(0, idx(["player", "name"])) : -1;
  const rankIdx = header ? ecrRankColumnIndex(cols) : -1;
  const adpIdx = header
    ? cols.findIndex((c) => /^(adp)$/.test(c) || (c.includes("adp") && !c.includes("ecr")))
    : -1;
  const teamIdx = header ? teamColumnIndex(cols) : -1;
  const posIdx = header ? posColumnIndex(cols) : -1;

  rows.forEach((line, i) => {
    const parts = line.split(/[,\t]/).map(clean);
    let name = "";
    let rank: number | undefined;
    let adp: number | undefined;
    let team: string | undefined;
    let pos: string | undefined;

    if (header && playerIdx >= 0) {
      name = parts[playerIdx] ?? "";
      if (rankIdx >= 0) rank = Number(parts[rankIdx]);
      if (adpIdx >= 0) adp = Number(parts[adpIdx]);
      if (teamIdx >= 0) team = parts[teamIdx] || undefined;
      if (posIdx >= 0) pos = parts[posIdx] || undefined;
    } else if (/^\d+/.test(parts[0] ?? "") && parts.length >= 2) {
      rank = Number(parts[0]);
      name = parts[1];
      // Common paste shapes: Rank,Player,Team,Pos[,ADP]
      if (parts[2] && /^[A-Za-z]{2,4}$/.test(parts[2])) team = parts[2];
      if (parts[3] && /^(QB|RB|WR|TE|K|DST|DEF)$/i.test(parts[3])) pos = parts[3];
      if (parts[4] && !Number.isNaN(Number(parts[4]))) adp = Number(parts[4]);
      else if (parts[2] && !Number.isNaN(Number(parts[2])) && !team) adp = Number(parts[2]);
    } else {
      name = parts[0] ?? "";
      rank = i + 1;
    }

    name = stripPlayerDecorations(name);
    if (!name) return;

    const hit = matchPlayer(name, { pos, team });
    if (!hit) {
      unmatched.push(name);
      return;
    }
    const next = updates.get(hit.id) ?? {};
    if (rank && Number.isFinite(rank) && rank > 0) {
      if (source === "ds") {
        if (next.dsRank == null || rank < next.dsRank) next.dsRank = rank;
      } else if (next.fpRank == null || rank < next.fpRank) {
        next.fpRank = rank;
      }
    }
    if (source === "fp" && adp != null && Number.isFinite(adp) && adp > 0) next.adp = adp;
    updates.set(hit.id, next);
  });

  return { updates, unmatched: unmatched.slice(0, 12), matched: updates.size, source };
}

function matchPlayer(name: string, opts?: { pos?: string; team?: string }): Player | undefined {
  return matchRankingSource(name, opts);
}

/** Persistable patches from an import Map. */
export function updatesToPatches(updates: Map<string, RankImportUpdate>): Record<string, RankImportUpdate> {
  return Object.fromEntries(updates);
}

/**
 * Overlay league-specific FP and/or DS ranks. Only replaces the source column
 * present on each patch (FP import never blanks DS, and vice versa).
 */
export function applyLeagueRankUpdates(
  players: Player[],
  updates: Map<string, RankImportUpdate> | Record<string, RankImportUpdate> | undefined,
): Player[] {
  if (!updates) return players;
  const map = updates instanceof Map ? updates : new Map(Object.entries(updates));
  if (map.size === 0) return players;
  return players.map((p) => {
    const u = map.get(p.id);
    if (!u) return p;
    return {
      ...p,
      fpRank: u.fpRank != null && u.fpRank > 0 ? u.fpRank : p.fpRank,
      dsRank: u.dsRank != null && u.dsRank > 0 ? u.dsRank : p.dsRank,
      adp: u.adp != null && u.adp > 0 && u.adp < 900 ? u.adp : p.adp,
    };
  });
}

/** @deprecated Prefer applyLeagueRankUpdates — kept for older call sites. */
export function applyUpdates(
  players: Player[],
  updates: Map<string, { fpRank?: number; adp?: number }>,
): Player[] {
  return applyLeagueRankUpdates(players, updates);
}
