import type {
  DraftPick,
  DraftType,
  LeagueSettings,
  Player,
  Position,
  Recommendation,
  Scoring,
} from "./types";
import { PLAYER_BY_ID } from "./players";

export function slugifyName(name: string) {
  return name
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function pickOwner(
  overall: number,
  teams: number,
  draftType: DraftType = "snake"
): number {
  const i = overall - 1;
  const pos = i % teams;
  if (draftType === "linear") return pos + 1;
  const round = Math.floor(i / teams);
  return round % 2 === 0 ? pos + 1 : teams - pos;
}

export function roundOf(overall: number, teams: number) {
  return Math.ceil(overall / teams);
}

export function pickInRound(overall: number, teams: number) {
  const pos = ((overall - 1) % teams) + 1;
  return pos;
}

export function userPickOveralls(
  slot: number,
  teams: number,
  rounds: number,
  draftType: DraftType = "snake"
) {
  const picks: number[] = [];
  for (let round = 1; round <= rounds; round++) {
    const overall =
      draftType === "linear" || round % 2 === 1
        ? (round - 1) * teams + slot
        : round * teams - slot + 1;
    picks.push(overall);
  }
  return picks;
}

export function nextUserPick(overall: number, settings: LeagueSettings) {
  const mine = userPickOveralls(
    settings.slot,
    settings.teams,
    settings.rounds,
    settings.draftType ?? "snake"
  );
  return mine.find((p) => p >= overall) ?? null;
}

export function picksUntilUser(overall: number, settings: LeagueSettings) {
  const next = nextUserPick(overall, settings);
  if (next == null) return 0;
  if (pickOwner(overall, settings.teams, settings.draftType ?? "snake") === settings.slot) {
    return 0;
  }
  return Math.max(0, next - overall);
}

export function blendedRank(player: Player, dsWeight: number) {
  const w = Math.min(100, Math.max(0, dsWeight)) / 100;
  return player.fpRank * (1 - w) + player.dsRank * w;
}

export function scoringMult(pos: Position, scoring: Scoring) {
  if (scoring === "ppr") return 1;
  if (scoring === "half") {
    if (pos === "WR") return 0.9;
    if (pos === "TE") return 0.92;
    if (pos === "RB") return 0.95;
    return 1;
  }
  if (pos === "WR") return 0.8;
  if (pos === "TE") return 0.84;
  if (pos === "RB") return 0.9;
  return 1;
}

export function adjustedProj(player: Player, settings: LeagueSettings) {
  let pts = player.proj * scoringMult(player.pos, settings.scoring);
  if (settings.superflex && player.pos === "QB") pts *= 1.08;
  return pts;
}

export function vor(player: Player, settings: LeagueSettings) {
  const repl: Record<Position, number> = {
    QB: settings.superflex ? 255 : 270,
    RB: 178,
    WR: 168,
    TE: 138,
    K: 120,
    DST: 102,
  };
  return adjustedProj(player, settings) - repl[player.pos];
}

export function rosterFor(
  picks: DraftPick[],
  team: number,
  byId: Map<string, Player> = PLAYER_BY_ID
): Player[] {
  return picks
    .filter((p) => p.team === team)
    .map((p) => byId.get(p.playerId))
    .filter((p): p is Player => Boolean(p));
}

export function countPos(roster: Player[], pos: Position) {
  return roster.filter((p) => p.pos === pos).length;
}

export function starterNeeds(roster: Player[], settings: LeagueSettings) {
  const r = settings.roster;
  const have: Record<Position, number> = {
    QB: countPos(roster, "QB"),
    RB: countPos(roster, "RB"),
    WR: countPos(roster, "WR"),
    TE: countPos(roster, "TE"),
    K: countPos(roster, "K"),
    DST: countPos(roster, "DST"),
  };
  const holes: Record<Position, number> = {
    QB: Math.max(0, r.qb - have.QB),
    RB: Math.max(0, r.rb - have.RB),
    WR: Math.max(0, r.wr - have.WR),
    TE: Math.max(0, r.te - have.TE),
    K: Math.max(0, r.k - have.K),
    DST: Math.max(0, r.dst - have.DST),
  };
  const extraRbWrTe = Math.max(0, have.RB - r.rb) + Math.max(0, have.WR - r.wr) + Math.max(0, have.TE - r.te);
  const flexHole = Math.max(0, r.flex - extraRbWrTe);
  return { have, holes, flexHole };
}

function needScore(player: Player, roster: Player[], settings: LeagueSettings) {
  const { have, holes, flexHole } = starterNeeds(roster, settings);
  const starters = settings.roster;
  if (player.pos === "K" || player.pos === "DST") {
    if (holes[player.pos] > 0) return 8;
    return -20;
  }
  if (holes[player.pos] > 0) return 22;
  if ((player.pos === "RB" || player.pos === "WR" || player.pos === "TE") && flexHole > 0) {
    return 14;
  }
  if (player.pos === "QB" && have.QB >= starters.qb + (settings.superflex ? 1 : 0)) return -12;
  if (player.pos === "TE" && have.TE >= starters.te + 1) return -8;
  if (player.pos === "RB" && have.RB >= starters.rb + starters.flex + 2) return -6;
  if (player.pos === "WR" && have.WR >= starters.wr + starters.flex + 2) return -4;
  return 4;
}

function scarcityScore(player: Player, available: Player[]) {
  const same = available.filter((p) => p.pos === player.pos);
  const better = same.filter(
    (p) => (p.fpRank + p.dsRank) / 2 < (player.fpRank + player.dsRank) / 2
  ).length;
  if (player.pos === "RB" && better <= 3) return 10;
  if (player.pos === "WR" && better <= 4) return 6;
  if (player.pos === "TE" && better <= 1) return 12;
  if (player.pos === "QB" && better <= 1) return 5;
  return 0;
}

export function recommendPicks(args: {
  available: Player[];
  roster: Player[];
  settings: LeagueSettings;
  overall: number;
  picksUntilNext: number;
}): Recommendation[] {
  const { available, roster, settings, overall, picksUntilNext } = args;
  const round = roundOf(overall, settings.teams);

  const scored = available
    .filter((p) => {
      if ((p.pos === "K" || p.pos === "DST") && round < settings.rounds - 1) return false;
      if (p.injury === "out" && round < 11) return false;
      return true;
    })
    .map((p) => {
      const v = vor(p, settings);
      const need = needScore(p, roster, settings);
      const value = p.adp - overall;
      const scarce = scarcityScore(p, available);
      const gap = p.fpRank - p.dsRank;
      const dsPull = (gap * settings.dsWeight) / 50;
      const rank = blendedRank(p, settings.dsWeight);
      const waitPicks = p.adp - overall;
      const wait: Recommendation["wait"] =
        waitPicks <= picksUntilNext + 1
          ? "now"
          : waitPicks <= picksUntilNext + 8
            ? "borderline"
            : "can-wait";

      const score =
        v * 1.15 +
        need * 1.4 +
        Math.max(value, -8) * 0.55 +
        scarce * 1.1 +
        dsPull * 0.35 +
        (180 - rank) * 0.45 +
        (wait === "now" ? 6 : 0) +
        (p.tags.includes("value") || p.tags.includes("ds-boost") ? 3 : 0) -
        (p.injury === "questionable" ? 8 : 0) -
        (p.injury === "watch" ? 3 : 0);

      const reasons: string[] = [];
      if (need >= 20) reasons.push(`Fills a starting ${p.pos} hole`);
      else if (need >= 12) reasons.push("Covers FLEX");
      if (value >= 8) reasons.push(`Falling ${Math.round(value)} spots past ADP`);
      if (gap >= 5) reasons.push(`DraftSharks ${gap} spots ahead of FantasyPros`);
      if (gap <= -5) reasons.push(`FantasyPros ${Math.abs(gap)} spots ahead of DraftSharks`);
      if (scarce >= 10) reasons.push(`${p.pos} cliff — next tier is a drop`);
      if (p.note && reasons.length < 3) reasons.push(p.note);
      if (wait === "now" && picksUntilNext > 0) {
        reasons.push("Unlikely to last until your next pick");
      } else if (wait === "can-wait") {
        reasons.push("Likely still there next turn if you want someone else");
      }
      if (reasons.length === 0) reasons.push(`Best remaining by blended rank (#${Math.round(rank)})`);

      return { player: p, score, reasons: reasons.slice(0, 3), wait };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 6);
}

export function autoPickForTeam(args: {
  team: number;
  roster: Player[];
  available: Player[];
  settings: LeagueSettings;
  overall: number;
}): Player | null {
  const { roster, available, settings, overall } = args;
  const round = roundOf(overall, settings.teams);
  const { holes, flexHole } = starterNeeds(roster, settings);

  const pool = available.filter((p) => {
    if (p.injury === "out") return false;
    if (p.pos === "K" || p.pos === "DST") return round >= settings.rounds - 1;
    if (p.pos === "QB" && countPos(roster, "QB") >= (settings.superflex ? 2 : 1) + 1) return false;
    return true;
  });
  if (pool.length === 0) return available[0] ?? null;

  const needPos = (["RB", "WR", "TE", "QB"] as Position[]).filter((pos) => holes[pos] > 0);
  const flexOk = flexHole > 0;

  const ranked = [...pool].sort((a, b) => a.adp - b.adp);
  const pickFrom = (list: Player[]) => list.sort((a, b) => a.adp - b.adp)[0];

  if (round <= 2) {
    return pickFrom(ranked.filter((p) => p.pos === "RB" || p.pos === "WR")) ?? ranked[0];
  }
  if (needPos.length) {
    const needed = ranked.filter((p) => needPos.includes(p.pos));
    if (needed[0] && needed[0].adp <= overall + 18) return needed[0];
  }
  if (flexOk) {
    const flex = ranked.filter((p) => p.pos === "RB" || p.pos === "WR" || p.pos === "TE");
    if (flex[0]) return flex[0];
  }
  return ranked[0];
}

export function sourceGap(player: Player) {
  return player.fpRank - player.dsRank;
}

export function formatPick(overall: number, teams: number) {
  const round = roundOf(overall, teams);
  const pick = pickInRound(overall, teams);
  return `${round}.${String(pick).padStart(2, "0")}`;
}

export const POS_ORDER: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
