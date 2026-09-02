import { slugifyName } from "./draft";
import { PLAYERS } from "./players";
import type { Player } from "./types";

function clean(s: string) {
  return s.trim().replace(/^["']|["']$/g, "");
}

function looksLikeHeader(line: string) {
  const l = line.toLowerCase();
  return l.includes("player") || l.includes("rank") || l.includes("name");
}

/**
 * Accepts FantasyPros-style CSV/TSV or a simple Rank,Player,Team,Pos paste.
 * Overlays fpRank (and ADP when present) onto the built-in board.
 */
export function parseRankingPaste(text: string): {
  updates: Map<string, { fpRank?: number; adp?: number }>;
  unmatched: string[];
  matched: number;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const updates = new Map<string, { fpRank?: number; adp?: number }>();
  const unmatched: string[] = [];
  if (lines.length === 0) return { updates, unmatched, matched: 0 };

  const header = looksLikeHeader(lines[0]) ? lines[0] : "";
  const rows = header ? lines.slice(1) : lines;
  const cols = header.split(/[,\t]/).map((c) => clean(c).toLowerCase());

  const idx = (names: string[]) => cols.findIndex((c) => names.some((n) => c.includes(n)));
  const playerIdx = header ? Math.max(0, idx(["player", "name"])) : -1;
  const rankIdx = header ? idx(["rk", "rank", "ecr", "overall"]) : -1;
  const adpIdx = header ? idx(["adp"]) : -1;

  rows.forEach((line, i) => {
    const parts = line.split(/[,\t]/).map(clean);
    let name = "";
    let rank: number | undefined;
    let adp: number | undefined;

    if (header && playerIdx >= 0) {
      name = parts[playerIdx] ?? "";
      if (rankIdx >= 0) rank = Number(parts[rankIdx]);
      if (adpIdx >= 0) adp = Number(parts[adpIdx]);
    } else if (/^\d+/.test(parts[0] ?? "") && parts.length >= 2) {
      rank = Number(parts[0]);
      name = parts[1];
      if (parts[4] && !Number.isNaN(Number(parts[4]))) adp = Number(parts[4]);
    } else {
      name = parts[0] ?? "";
      rank = i + 1;
    }

    name = name
      .replace(/\s*\(.*\)\s*$/, "")
      .replace(/\s+(QB|RB|WR|TE|K|DST|DEF)\d*$/i, "")
      .replace(/\s+[A-Z]{2,3}$/, "")
      .trim();
    if (!name) return;

    const hit = matchPlayer(name);
    if (!hit) {
      unmatched.push(name);
      return;
    }
    const next = updates.get(hit.id) ?? {};
    if (rank && Number.isFinite(rank) && rank > 0) next.fpRank = rank;
    if (adp != null && Number.isFinite(adp) && adp > 0) next.adp = adp;
    updates.set(hit.id, next);
  });

  return { updates, unmatched: unmatched.slice(0, 12), matched: updates.size };
}

function matchPlayer(name: string): Player | undefined {
  const s = slugifyName(name);
  const direct = PLAYERS.find((p) => p.id === s);
  if (direct) return direct;
  const lower = name.toLowerCase();
  return PLAYERS.find(
    (p) =>
      p.name.toLowerCase() === lower ||
      p.name.toLowerCase().includes(lower) ||
      lower.includes(p.name.toLowerCase())
  );
}

export function applyUpdates(
  players: Player[],
  updates: Map<string, { fpRank?: number; adp?: number }>
): Player[] {
  if (updates.size === 0) return players;
  return players.map((p) => {
    const u = updates.get(p.id);
    if (!u) return p;
    return {
      ...p,
      fpRank: u.fpRank != null && u.fpRank > 0 ? u.fpRank : p.fpRank,
      adp: u.adp != null && u.adp > 0 && u.adp < 900 ? u.adp : p.adp,
    };
  });
}
