import { BYE_BY_TEAM } from "./bye-weeks";
import { pickOwner } from "./draft";
import { PLAYER_BY_ID, PLAYERS } from "./players";
import type { DraftType, LeagueSettings, Player, Position, Scoring } from "./types";
import { DEFAULT_SETTINGS } from "./types";

export const ESPN_API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
export const ESPN_FANTASY_ORIGIN = "https://fantasy.espn.com";
export const ESPN_MOCK_LOBBY = `${ESPN_FANTASY_ORIGIN}/football/mockdraftlobby`;
export const ESPN_LIVE_LOBBY = `${ESPN_FANTASY_ORIGIN}/football/livedraftlobby`;

export type EspnIngestMeta = {
  leagueId?: string;
  season?: number;
  teams?: number;
  teamId?: number;
  slot?: number;
  leagueName?: string;
  draftType?: DraftType;
  teamNames?: string[];
  /** Bookmarklet 0-pick reason: no leagueId / 0 filled slots / ESPN 401. */
  reason?: string;
};

export function espnLeagueHomeUrl(leagueId: string, season = 2026) {
  const id = parseLeagueId(leagueId) || leagueId.trim();
  return `${ESPN_FANTASY_ORIGIN}/football/league?leagueId=${id}&seasonId=${season}`;
}

export function espnDraftRoomUrl(leagueId: string, season = 2026) {
  const id = parseLeagueId(leagueId) || leagueId.trim();
  return `${ESPN_FANTASY_ORIGIN}/football/draft?leagueId=${id}&seasonId=${season}`;
}

export function parseTeamId(input: string): number | null {
  const m = input.match(/[?&]teamId=(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function clampEspnTeams(n: number | undefined | null): number | undefined {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 2 || v > 20) return undefined;
  return Math.round(v);
}

export function parseEspnHref(href?: string): EspnIngestMeta {
  if (!href) return {};
  const leagueId = parseLeagueId(href) ?? undefined;
  const seasonRaw = parseSeason(href, 0);
  const teamId = parseTeamId(href) ?? undefined;
  return {
    leagueId,
    season: seasonRaw || undefined,
    teamId: teamId && teamId > 0 ? teamId : undefined,
  };
}

export function mergeIngestMeta(
  body: EspnIngestMeta | undefined,
  href?: string,
  title?: string,
): EspnIngestMeta {
  const fromHref = parseEspnHref(href);
  const teams = clampEspnTeams(body?.teams);
  const leagueName = body?.leagueName?.trim()
    || (title && !/^Fantasy Football/i.test(title) ? title.trim() : undefined);
  const slot = body?.slot && body.slot >= 1 && body.slot <= 20 ? body.slot : undefined;
  const teamId = body?.teamId || fromHref.teamId;
  return {
    ...fromHref,
    ...body,
    leagueId: body?.leagueId || fromHref.leagueId,
    season: body?.season || fromHref.season,
    teamId,
    teams,
    slot: slot || (teamId && teams && teamId <= teams ? teamId : undefined),
    leagueName,
    draftType: body?.draftType === "linear" ? "linear" : body?.draftType === "snake" ? "snake" : undefined,
  };
}

export function patchSettingsFromEspnMeta(
  current: LeagueSettings,
  meta: EspnIngestMeta,
): LeagueSettings {
  const teams = clampEspnTeams(meta.teams) ?? current.teams;
  let slot = current.slot;
  if (meta.slot && meta.slot >= 1 && meta.slot <= teams) slot = meta.slot;
  else if (meta.teamId && meta.teamId >= 1 && meta.teamId <= teams) slot = meta.teamId;
  const switchedLeague = Boolean(meta.leagueId && meta.leagueId !== current.espnLeagueId);
  const names =
    meta.teamNames && meta.teamNames.length === teams
      ? meta.teamNames
      : switchedLeague || current.teamNames.length !== teams
        ? Array.from({ length: teams }, (_, i) => `Team ${i + 1}`)
        : current.teamNames;
  return {
    ...current,
    teams,
    slot,
    espnLeagueId: meta.leagueId || current.espnLeagueId,
    leagueName: meta.leagueName || current.leagueName,
    draftType: meta.draftType ?? current.draftType,
    teamNames: names,
  };
}

/** ESPN proTeamId → NFL abbreviation. */
export const PRO_TEAM: Record<number, string> = {
  0: "FA",
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WAS",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

export function isUnknownNflTeam(team: string | undefined | null): boolean {
  const t = (team ?? "").trim().toUpperCase();
  return !t || t === "FA" || t === "NONE" || t === "N/A" || t === "--" || t === "0";
}

export function isSentinelAdp(n: number | undefined | null): boolean {
  return n == null || !Number.isFinite(n) || n <= 0 || n >= 900;
}

export function isSentinelBye(n: number | undefined | null): boolean {
  return n == null || !Number.isFinite(n) || n <= 0;
}

/** Synthetic "ESPN -1" names from unfilled slots — not real players. */
export function isPlaceholderEspnName(name: string | undefined | null): boolean {
  if (!name) return true;
  const m = name.trim().match(/^ESPN\s+(-?\d+)$/i);
  if (!m) return false;
  return Number(m[1]) <= 0;
}

/** Prefer live ESPN team/bye/ADP only when they are real; otherwise keep the snapshot. */
export function mergeLiveEspnFields(
  snapshot: { team?: string; bye?: number; adp?: number } | undefined,
  live: { team?: string; bye?: number; adp?: number },
): { team: string; bye: number; adp: number } {
  const team = !isUnknownNflTeam(live.team)
    ? live.team!.trim()
    : !isUnknownNflTeam(snapshot?.team)
      ? snapshot!.team!.trim()
      : ((live.team || snapshot?.team || "FA").trim() || "FA");
  const byeFromTeam = BYE_BY_TEAM[team] ?? 0;
  const bye = !isSentinelBye(live.bye)
    ? live.bye!
    : !isSentinelBye(snapshot?.bye)
      ? snapshot!.bye!
      : byeFromTeam;
  const adp = !isSentinelAdp(live.adp)
    ? live.adp!
    : !isSentinelAdp(snapshot?.adp)
      ? snapshot!.adp!
      : 999;
  return { team, bye, adp };
}

const POS_BY_ID: Record<number, Position> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

export type EspnRawPick = {
  overallPickNumber: number;
  playerId: number;
  teamId: number;
  roundId?: number;
  playerName?: string;
};

export type EspnTeam = {
  id: number;
  name: string;
  abbrev: string;
  slot: number;
  owner?: string;
};

export type MappedEspnPick = {
  overall: number;
  team: number;
  playerId: string;
  espnPlayerId: number;
  espnTeamId: number;
  name: string;
  pos: Position;
  nflTeam: string;
  adp?: number;
};

export type EspnPlayerMeta = {
  id: number;
  name: string;
  pos: Position;
  team: string;
  ourId: string | null;
  adp?: number;
};

export type EspnLeagueInfo = {
  leagueId: string;
  season: number;
  name: string;
  teams: EspnTeam[];
  pickOrder: number[];
  draftType: DraftType;
  inProgress: boolean;
  drafted: boolean;
  apiPickCount: number;
  settings: LeagueSettings;
  suggestedSlot: number;
};

export function parseLeagueId(input: string): string | null {
  const trimmed = input.trim();
  const fromQuery = trimmed.match(/[?&]leagueId=(-?\d+)/i);
  if (fromQuery) return fromQuery[1];
  const fromPath = trimmed.match(/leagues\/(-?\d+)/i);
  if (fromPath) return fromPath[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

export function parseSeason(input: string, fallback = 2026): number {
  const m = input.match(/[?&]seasonId=(\d{4})/i);
  if (m) return Number(m[1]);
  return fallback;
}

export function normalizeCookies(swid?: string, espnS2?: string): string | undefined {
  let s = (swid ?? "").trim().replace(/^SWID=/i, "");
  let e = (espnS2 ?? "").trim().replace(/^espn_s2=/i, "");
  if (e.includes("%")) {
    try {
      e = decodeURIComponent(e);
    } catch {
      /* keep encoded */
    }
  }
  if (s && !s.startsWith("{") && /-/u.test(s)) s = `{${s.replace(/[{}]/g, "")}}`;
  const parts: string[] = [];
  if (s) parts.push(`SWID=${s}`);
  if (e) parts.push(`espn_s2=${e}`);
  return parts.length ? parts.join("; ") : undefined;
}

export function espnPos(id?: number): Position {
  return POS_BY_ID[id ?? -1] ?? "WR";
}

/** ESPN uses 0 / -1 for empty or unresolved draft slots — not a real player. */
export function isValidEspnPlayerId(id: number | undefined | null): id is number {
  return typeof id === "number" && Number.isFinite(id) && id > 0;
}

export function espnPlayerIdOrZero(id: number | undefined | null): number {
  return isValidEspnPlayerId(id) ? id : 0;
}

/** Stable unmatched id: never `espn--1` / `espn-0` when many players lack an ESPN id. */
export function unmatchedEspnId(name: string, overall?: number, espnId?: number): string {
  if (isValidEspnPlayerId(espnId)) return `espn-${espnId}`;
  const slug = normalizePlayerName(name).replace(/\s+/g, "-");
  if (slug && !/^espn-?-?\d+$/i.test(slug)) return `espn-${slug}`;
  if (overall && overall > 0) return `espn-pick-${overall}`;
  return `espn-${slug || "unknown"}`;
}

export function normalizePlayerName(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|iii|ii|iv|v)\b/g, "")
    .replace(/\s+d\/st\b/g, "")
    .replace(/\s+dst\b/g, "")
    .replace(/\s+defense\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercased name with spaces removed — "Ja Marr Chase" and "Ja'Marr Chase" both become jamarrchase. */
export function compactPlayerName(s: string) {
  return normalizePlayerName(s).replace(/\s+/g, "");
}

function nameTokens(s: string) {
  return normalizePlayerName(s).split(" ").filter(Boolean);
}

function lastNameOf(s: string) {
  const parts = nameTokens(s);
  return parts[parts.length - 1] ?? "";
}

function firstNameOf(s: string) {
  return nameTokens(s)[0] ?? "";
}

/** "Chase, Ja'Marr" → "Ja'Marr Chase". Leave already-forward names alone. */
export function flipLastFirst(name: string) {
  const comma = name.indexOf(",");
  if (comma <= 0) return name;
  const last = name.slice(0, comma).trim();
  const first = name.slice(comma + 1).trim();
  if (!last || !first) return name;
  return `${first} ${last}`;
}

const FIRST_ALIASES: Record<string, string> = {
  cam: "cameron",
  cameron: "cameron",
  kenny: "kenneth",
  ken: "kenneth",
  kenneth: "kenneth",
  mike: "michael",
  michael: "michael",
  matt: "matthew",
  matthew: "matthew",
  chris: "christopher",
  christopher: "christopher",
  alex: "alexander",
  alexander: "alexander",
  nick: "nicholas",
  nicholas: "nicholas",
  josh: "joshua",
  joshua: "joshua",
  jake: "jacob",
  jacob: "jacob",
  will: "william",
  william: "william",
  rob: "robert",
  bob: "robert",
  bobby: "robert",
  robert: "robert",
  chig: "chigoziem",
  chigoziem: "chigoziem",
};

function canonicalFirst(first: string) {
  return FIRST_ALIASES[first] ?? first;
}

/** Cam/Cameron, Kenny/Kenneth; not J/Jonathan and not J'Mari/Jonathan. */
export function firstNamesCompatible(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (canonicalFirst(a) === canonicalFirst(b)) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

export function parseRankPos(raw?: string): Position | undefined {
  if (!raw) return undefined;
  const p = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  if (p === "DST" || p === "DEF" || p === "D") return "DST";
  return undefined;
}

export function canonicalNflTeam(team?: string): string | undefined {
  if (!team) return undefined;
  const t = team.toUpperCase().replace(/[^A-Z]/g, "");
  if (!t || t === "FA" || t === "NFLE") return undefined;
  if (t === "JAC") return "JAX";
  if (t === "LA") return "LAR";
  if (t === "WSH") return "WAS";
  if (t === "GBP") return "GB";
  if (t === "KCC") return "KC";
  if (t === "NEP") return "NE";
  if (t === "NOS") return "NO";
  if (t === "SFO") return "SF";
  if (t === "TBB") return "TB";
  return t;
}

function pickUnique(players: Player[]): Player | undefined {
  return players.length === 1 ? players[0] : undefined;
}

function sameTeamPos(p: Player, pos?: Position, team?: string) {
  if (pos && p.pos !== pos) return false;
  if (team && p.team !== team) return false;
  return true;
}

/**
 * Overlay matching for FantasyPros / DraftSharks (full names, not ESPN "J. Taylor").
 *
 * Order: (normalized full name + team + pos) → unique full name → unique compact
 * name → DST mascot/team → unique last name with compatible first name.
 * Never last-name-only, even if our board has only one Taylor — that is how
 * J'Mari Taylor (JAC) overwrote Jonathan Taylor.
 */
export function matchRankingSource(
  name: string,
  opts?: { pos?: string; team?: string },
): Player | undefined {
  const pos = parseRankPos(opts?.pos);
  if (opts?.pos && !pos) return undefined;
  const team = canonicalNflTeam(opts?.team);

  const candidates = [name.trim(), flipLastFirst(name)].filter((n, i, arr) => n && arr.indexOf(n) === i);
  const idx = getNameIndex();

  for (const raw of candidates) {
    const n = normalizePlayerName(raw);
    if (!n) continue;
    const compact = n.replace(/\s+/g, "");

    const exact = PLAYERS.filter((p) => normalizePlayerName(p.name) === n);
    const exactTeamPos = exact.filter((p) => sameTeamPos(p, pos, team));
    if (pos && team && exactTeamPos.length === 1) return exactTeamPos[0];
    const uniqueExact = pickUnique(exact);
    if (uniqueExact) return uniqueExact;

    const compacted = PLAYERS.filter((p) => compactPlayerName(p.name) === compact);
    const compactTeamPos = compacted.filter((p) => sameTeamPos(p, pos, team));
    if (pos && team && compactTeamPos.length === 1) return compactTeamPos[0];
    const uniqueCompact = pickUnique(compacted);
    if (uniqueCompact) return uniqueCompact;
  }

  if (!pos || pos === "DST") {
    if (team) {
      const byTeam = idx.dstByTeam.get(team);
      if (byTeam) return byTeam;
    }
    for (const raw of candidates) {
      const mascot = lastNameOf(raw);
      if (!mascot) continue;
      const dst = PLAYERS.filter((p) => p.pos === "DST" && compactPlayerName(p.name) === mascot);
      const hit = pickUnique(dst);
      if (hit) return hit;
    }
  }

  for (const raw of candidates) {
    const last = lastNameOf(raw);
    const first = firstNameOf(raw);
    if (!last || !first) continue;
    const sameLast = PLAYERS.filter((p) => lastNameOf(p.name) === last);
    if (sameLast.length !== 1) continue;
    const only = sameLast[0];
    if (pos && only.pos !== pos) continue;
    if (!firstNamesCompatible(first, firstNameOf(only.name))) continue;
    return only;
  }

  return undefined;
}

type NameIndex = {
  byName: Map<string, Player>;
  byLastTeamPos: Map<string, Player>;
  byLastPos: Map<string, Player[]>;
  dstByTeam: Map<string, Player>;
};

let nameIndex: NameIndex | null = null;

function lastName(name: string) {
  const parts = normalizePlayerName(name).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function getNameIndex(): NameIndex {
  if (nameIndex) return nameIndex;
  const byName = new Map<string, Player>();
  const byLastTeamPos = new Map<string, Player>();
  const byLastPos = new Map<string, Player[]>();
  const dstByTeam = new Map<string, Player>();
  for (const p of PLAYERS) {
    const n = normalizePlayerName(p.name);
    byName.set(n, p);
    const key = `${lastName(p.name)}|${p.team}|${p.pos}`;
    byLastTeamPos.set(key, p);
    const lp = `${lastName(p.name)}|${p.pos}`;
    const bucket = byLastPos.get(lp) ?? [];
    bucket.push(p);
    byLastPos.set(lp, bucket);
    if (p.pos === "DST") dstByTeam.set(p.team, p);
  }
  nameIndex = { byName, byLastTeamPos, byLastPos, dstByTeam };
  return nameIndex;
}

export function matchByName(name: string): Player | undefined {
  const idx = getNameIndex();
  const n = normalizePlayerName(name);
  return idx.byName.get(n) ?? PLAYERS.find((p) => normalizePlayerName(p.name) === n);
}

export function matchOurPlayer(name: string, pos: Position, team: string): string | null {
  const named = matchByName(name);
  if (named) return named.id;
  const idx = getNameIndex();
  if (pos === "DST") {
    const byTeam = idx.dstByTeam.get(team);
    if (byTeam) return byTeam.id;
  }
  const n = normalizePlayerName(name);
  const direct = idx.byName.get(n);
  if (direct) return direct.id;
  if (pos === "DST") {
    const nick = idx.byName.get(n.replace(/ football$/u, ""));
    if (nick?.pos === "DST") return nick.id;
  }
  const combo = idx.byLastTeamPos.get(`${lastName(name)}|${team}|${pos}`);
  if (combo) return combo.id;
  const same = idx.byLastPos.get(`${lastName(name)}|${pos}`) ?? [];
  if (same.length === 1) return same[0].id;
  return null;
}

export function stubFromEspn(meta: {
  espnId: number;
  name: string;
  pos: Position;
  team: string;
  id?: string;
  overall?: number;
  adp?: number;
}): Player {
  const name = meta.name.replace(/\s+D\/ST$/i, "");
  const named = isPlaceholderEspnName(name) ? undefined : matchByName(name);
  const live = mergeLiveEspnFields(named, {
    team: meta.team,
    bye: BYE_BY_TEAM[meta.team] ?? 0,
    adp: meta.adp,
  });
  if (named) {
    return {
      ...named,
      team: live.team,
      bye: live.bye,
      adp: live.adp,
    };
  }
  const espnId = espnPlayerIdOrZero(meta.espnId);
  return {
    id: meta.id || unmatchedEspnId(name, meta.overall, espnId),
    name: name || "Unknown player",
    team: live.team,
    pos: meta.pos,
    bye: live.bye,
    fpRank: 999,
    dsRank: 999,
    adp: live.adp,
    proj: 0,
    tags: ["espn"],
    note: "On ESPN's board but not in this snapshot — still tracked as taken.",
  };
}

type EspnScoringItem = { statId?: number; points?: number };
type EspnDraftSettings = {
  auction?: boolean;
  orderType?: string;
  type?: string;
  pickOrder?: number[];
  numRounds?: number;
};
type EspnSettings = {
  name?: string;
  size?: number;
  scoringSettings?: { scoringItems?: EspnScoringItem[] };
  rosterSettings?: { lineupSlotCounts?: Record<string, number> };
  draftSettings?: EspnDraftSettings;
};
type EspnTeamRaw = {
  id: number;
  abbrev?: string;
  location?: string;
  nickname?: string;
  primaryOwner?: string;
};
type EspnDraftDetail = {
  drafted?: boolean;
  inProgress?: boolean;
  picks?: Array<{
    overallPickNumber?: number;
    playerId?: number;
    teamId?: number;
    roundId?: number;
    keeper?: boolean;
  }>;
};

export type EspnLeaguePayload = {
  id?: number;
  scoringPeriodId?: number;
  settings?: EspnSettings;
  teams?: EspnTeamRaw[];
  draftDetail?: EspnDraftDetail;
};

function scoringFromItems(items: EspnScoringItem[] | undefined): Scoring {
  const rec = items?.find((i) => i.statId === 53);
  const pts = rec?.points ?? 0;
  if (pts >= 0.9) return "ppr";
  if (pts >= 0.4) return "half";
  return "standard";
}

function rosterFromSlots(counts: Record<string, number> | undefined): LeagueSettings["roster"] {
  if (!counts) return { ...DEFAULT_SETTINGS.roster };
  const n = (id: number) => counts[String(id)] ?? 0;
  return {
    qb: n(0) || DEFAULT_SETTINGS.roster.qb,
    rb: n(2),
    wr: n(4) || DEFAULT_SETTINGS.roster.wr,
    te: n(6) || DEFAULT_SETTINGS.roster.te,
    flex: n(23),
    rbwr: n(3),
    k: n(17),
    dst: n(16),
    bench: n(20) || DEFAULT_SETTINGS.roster.bench,
    ir: n(21),
  };
}

function draftTypeOf(ds: EspnDraftSettings | undefined): DraftType {
  const t = `${ds?.orderType ?? ""} ${ds?.type ?? ""}`.toUpperCase();
  if (t.includes("LINEAR") && !t.includes("SNAKE")) return "linear";
  return "snake";
}

export function parseEspnLeague(
  payload: EspnLeaguePayload,
  args: { leagueId: string; season: number; swid?: string; dsWeight: number }
): EspnLeagueInfo {
  const settingsRaw = payload.settings ?? {};
  const ds = settingsRaw.draftSettings ?? {};
  const teamsRaw = [...(payload.teams ?? [])].sort((a, b) => a.id - b.id);
  const pickOrder =
    ds.pickOrder && ds.pickOrder.length ? ds.pickOrder : teamsRaw.map((t) => t.id);
  const slotOf = (teamId: number) => {
    const i = pickOrder.indexOf(teamId);
    return i >= 0 ? i + 1 : teamId;
  };
  const teams: EspnTeam[] = teamsRaw.map((t) => ({
    id: t.id,
    name: `${t.location ?? ""} ${t.nickname ?? ""}`.trim() || t.abbrev || `Team ${t.id}`,
    abbrev: t.abbrev ?? `T${t.id}`,
    slot: slotOf(t.id),
    owner: t.primaryOwner,
  }));
  teams.sort((a, b) => a.slot - b.slot);

  const roster = rosterFromSlots(settingsRaw.rosterSettings?.lineupSlotCounts);
  const opSlots = settingsRaw.rosterSettings?.lineupSlotCounts?.["7"] ?? 0;
  const scoring = scoringFromItems(settingsRaw.scoringSettings?.scoringItems);
  const draftType = draftTypeOf(ds);
  const size = settingsRaw.size || teams.length || 12;
  const rounds =
    ds.numRounds ||
    roster.qb +
      roster.rb +
      roster.wr +
      roster.te +
      roster.flex +
      roster.rbwr +
      roster.k +
      roster.dst +
      roster.bench;

  let suggestedSlot = 1;
  const swid = (args.swid ?? "").replace(/[{}]/g, "").toLowerCase();
  if (swid) {
    const mine = teams.find((t) => (t.owner ?? "").replace(/[{}]/g, "").toLowerCase().includes(swid));
    if (mine) suggestedSlot = mine.slot;
  }

  const teamNames = Array.from({ length: size }, (_, i) => {
    const t = teams.find((x) => x.slot === i + 1);
    return t?.name ?? `Team ${i + 1}`;
  });

  const apiPicks = extractEspnDraftPicks(payload);

  return {
    leagueId: args.leagueId,
    season: args.season,
    name: settingsRaw.name || `League ${args.leagueId}`,
    teams,
    pickOrder,
    draftType,
    inProgress: Boolean(payload.draftDetail?.inProgress),
    drafted: Boolean(payload.draftDetail?.drafted),
    apiPickCount: apiPicks.length,
    suggestedSlot,
    settings: {
      ...DEFAULT_SETTINGS,
      leagueName: settingsRaw.name || DEFAULT_SETTINGS.leagueName,
      espnLeagueId: args.leagueId,
      teams: size,
      rounds,
      slot: suggestedSlot,
      scoring,
      superflex: opSlots > 0,
      dsWeight: args.dsWeight,
      draftType,
      teamNames,
      roster,
    },
  };
}

type LooseEspn = Record<string, unknown>;

function asRecord(v: unknown): LooseEspn | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as LooseEspn) : null;
}

/** League history returns `[{...}]`; some live clients wrap `{ data: {...} }`. */
export function unwrapEspnPayload(json: unknown): LooseEspn | null {
  if (Array.isArray(json)) {
    const first = json.find((x) => asRecord(x));
    return asRecord(first);
  }
  const root = asRecord(json);
  if (!root) return null;
  const data = asRecord(root.data);
  if (data && (data.draftDetail || data.picks || data.players || data.teams || data.settings)) {
    return data;
  }
  return root;
}

function espnPickPlayerId(p: LooseEspn): number {
  const direct = Number(p.playerId);
  if (direct > 0) return direct;
  const nested = asRecord(p.player);
  const nestedId = Number(nested?.id);
  if (nestedId > 0) return nestedId;
  const athlete = Number(p.athleteId);
  if (athlete > 0) return athlete;
  const id = Number(p.id);
  const overall = Number(p.overallPickNumber ?? p.overall ?? 0);
  if (id > 1000 && id !== overall) return id;
  return 0;
}

function espnPickName(p: LooseEspn, names: Map<number, string>): string {
  const nested = asRecord(p.player);
  let name = String(
    p.playerName ||
      p.fullName ||
      nested?.fullName ||
      nested?.name ||
      `${nested?.firstName ?? ""} ${nested?.lastName ?? ""}`.trim() ||
      "",
  ).trim();
  if (isPlaceholderEspnName(name)) name = "";
  const pid = espnPickPlayerId(p);
  if (!name && pid && names.has(pid)) name = names.get(pid) ?? "";
  return name;
}

function collectEspnPlayerNames(root: LooseEspn): Map<number, string> {
  const map = new Map<number, string>();
  const addList = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      const row = asRecord(e);
      if (!row) continue;
      const player = asRecord(row.player);
      const ppe = asRecord(row.playerPoolEntry);
      const inner = player || asRecord(ppe?.player) || ppe;
      const id = Number(row.id || row.playerId || inner?.id || 0);
      const name = String(
        row.fullName ||
          row.playerName ||
          inner?.fullName ||
          inner?.name ||
          `${inner?.firstName ?? ""} ${inner?.lastName ?? ""}`.trim() ||
          "",
      ).trim();
      if (id > 0 && name && !isPlaceholderEspnName(name)) map.set(id, name);
    }
  };
  addList(root.players);
  addList(root.playerPool);
  if (Array.isArray(root.teams)) {
    for (const t of root.teams) {
      const team = asRecord(t);
      const roster = asRecord(team?.roster);
      addList(roster?.entries);
    }
  }
  return map;
}

function picksFromEspnArray(raw: unknown, names: Map<number, string>): EspnRawPick[] {
  if (!Array.isArray(raw)) return [];
  const out: EspnRawPick[] = [];
  for (const item of raw) {
    const p = asRecord(item);
    if (!p) continue;
    const overall = Number(p.overallPickNumber ?? p.overall ?? p.pickNumber ?? 0);
    const playerId = espnPickPlayerId(p);
    const name = espnPickName(p, names);
    if (!overall || (!playerId && !name)) continue;
    const teamObj = asRecord(p.team);
    out.push({
      overallPickNumber: overall,
      playerId,
      teamId: Number(p.teamId ?? teamObj?.id ?? p.team ?? 0),
      playerName: name || undefined,
    });
  }
  return out;
}

function picksFromEspnRosters(root: LooseEspn, names: Map<number, string>): EspnRawPick[] {
  const out: EspnRawPick[] = [];
  const seen = new Set<string>();
  const push = (playerId: number, teamId: number, name: string) => {
    if (!playerId && !name) return;
    const key = playerId > 0 ? `id:${playerId}` : `n:${normalizePlayerName(name)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      overallPickNumber: out.length + 1,
      playerId,
      teamId,
      playerName: name || undefined,
    });
  };
  if (Array.isArray(root.teams)) {
    for (const t of root.teams) {
      const team = asRecord(t);
      if (!team) continue;
      const teamId = Number(team.id ?? 0);
      const roster = asRecord(team.roster);
      if (!Array.isArray(roster?.entries)) continue;
      for (const e of roster.entries) {
        const row = asRecord(e);
        if (!row) continue;
        const ppe = asRecord(row.playerPoolEntry) ?? row;
        const playerId = espnPickPlayerId({ ...ppe, playerId: row.playerId ?? ppe.playerId });
        const name = espnPickName({ ...ppe, playerId }, names);
        push(playerId, teamId, name);
      }
    }
  }
  if (!out.length && Array.isArray(root.players)) {
    for (const e of root.players) {
      const row = asRecord(e);
      if (!row) continue;
      const onTeam = Number(row.onTeamId ?? 0);
      if (!(onTeam > 0)) continue;
      push(espnPickPlayerId(row), onTeam, espnPickName(row, names));
    }
  }
  return out;
}

/**
 * Live ESPN rooms often omit `playerName` on `draftDetail.picks`, wrap history in an array,
 * nest `player: { id, fullName }`, or only show drafted players on rosters / `onTeamId`.
 * Empty slots (`playerId` 0/-1 and no real name) are dropped.
 */
export function extractEspnDraftPicks(json: unknown): EspnRawPick[] {
  const root = unwrapEspnPayload(json);
  if (!root) return [];
  const names = collectEspnPlayerNames(root);
  const detail = asRecord(root.draftDetail);
  const draft = asRecord(root.draft);
  const fromDetail = picksFromEspnArray(
    detail?.picks ?? root.picks ?? draft?.picks,
    names,
  );
  const filled = fromDetail.filter(
    (p) => isValidEspnPlayerId(p.playerId) || (Boolean(p.playerName) && !isPlaceholderEspnName(p.playerName)),
  );
  if (filled.length) {
    return filled.sort((a, b) => a.overallPickNumber - b.overallPickNumber);
  }
  return picksFromEspnRosters(root, names);
}

/** True for ESPN league/draft XHR — not the giant `players_wl` catalog. */
export function isEspnDraftNetworkUrl(url: string): boolean {
  const u = String(url || "");
  if (/\/players\?|view=players_wl/i.test(u)) return false;
  return /mDraftDetail|mDraft(?:[^A-Za-z]|$)|draftDetail|draftRecap|draftStatus|mRoster|\/leagues\/-?\d+|leagueHistory\/-?\d+|\/drafts\/\d+|gambit-api|livedraft|recentActivity/i.test(
    u,
  );
}

/** If listen mapped to `espn-4241457` but the name is on the board, use the snapshot id for taken. */
export function snapshotIdForEspnPick(p: { playerId: string; name?: string }): string {
  if (!p.playerId.startsWith("espn-")) return p.playerId;
  if (p.name && !isPlaceholderEspnName(p.name)) {
    const named = matchByName(p.name);
    if (named) return named.id;
  }
  return p.playerId;
}

export function remapMappedPicks(mapped: MappedEspnPick[]): MappedEspnPick[] {
  return mapped.map((p) => {
    const id = snapshotIdForEspnPick(p);
    return id === p.playerId ? p : { ...p, playerId: id };
  });
}

export function rawPicksFromDetail(payload: EspnLeaguePayload): EspnRawPick[] {
  return extractEspnDraftPicks(payload);
}

export function mergeEspnPicks(api: EspnRawPick[], ingest: EspnRawPick[]): EspnRawPick[] {
  const byOverall = new Map<number, EspnRawPick>();
  for (const p of [...api, ...ingest]) {
    const playerId = espnPlayerIdOrZero(p.playerId);
    if (!playerId && (!p.playerName || isPlaceholderEspnName(p.playerName))) continue;
    const overall = Number(p.overallPickNumber);
    if (!overall) continue;
    const next: EspnRawPick = { ...p, overallPickNumber: overall, playerId };
    const prev = byOverall.get(overall);
    if (!prev) {
      byOverall.set(overall, next);
      continue;
    }
    byOverall.set(overall, {
      ...prev,
      ...next,
      overallPickNumber: overall,
      playerId: playerId || prev.playerId,
      teamId: next.teamId || prev.teamId,
      playerName: next.playerName || prev.playerName,
    });
  }
  return [...byOverall.values()].sort((a, b) => a.overallPickNumber - b.overallPickNumber);
}

export function mapEspnPicks(args: {
  picks: EspnRawPick[];
  pickOrder: number[];
  teamsCount: number;
  players: Map<number, EspnPlayerMeta>;
  draftType?: DraftType;
}): MappedEspnPick[] {
  const { picks, pickOrder, teamsCount, players, draftType = "snake" } = args;
  const usedIds = new Set<string>();
  return picks
    .filter(
      (p) =>
        isValidEspnPlayerId(p.playerId) ||
        (Boolean(p.playerName) && !isPlaceholderEspnName(p.playerName)),
    )
    .map((p) => {
      const espnId = espnPlayerIdOrZero(p.playerId);
      const meta = espnId ? players.get(espnId) : undefined;
      const rawName =
        p.playerName &&
        !isPlaceholderEspnName(p.playerName) &&
        !/^player\s+\d+$/i.test(p.playerName.trim())
          ? p.playerName
          : undefined;
      const name = rawName || meta?.name || "";
      const snapshot =
        (name ? matchByName(name) : undefined) ??
        (meta?.ourId ? PLAYER_BY_ID.get(meta.ourId) : undefined);
      const pos = meta?.pos ?? snapshot?.pos ?? "WR";
      const live = mergeLiveEspnFields(snapshot, {
        team: meta?.team,
        bye: snapshot?.bye ?? (meta?.team ? BYE_BY_TEAM[meta.team] ?? 0 : 0),
        adp: meta?.adp ?? snapshot?.adp,
      });
      let ourId = snapshot?.id ?? meta?.ourId ?? (name ? matchOurPlayer(name, pos, live.team) : null);
      if (!ourId) ourId = unmatchedEspnId(name, p.overallPickNumber, espnId);
      if (ourId.startsWith("espn-") && name) {
        const named = matchByName(name);
        if (named) ourId = named.id;
      }
      if (usedIds.has(ourId)) ourId = unmatchedEspnId(name, p.overallPickNumber) + `-p${p.overallPickNumber}`;
      usedIds.add(ourId);
      const orderIdx = p.teamId ? pickOrder.indexOf(p.teamId) : -1;
      const team =
        orderIdx >= 0
          ? orderIdx + 1
          : p.teamId >= 1 && p.teamId <= teamsCount
            ? p.teamId
            : pickOwner(p.overallPickNumber, teamsCount, draftType);
      return {
        overall: p.overallPickNumber,
        team,
        playerId: ourId,
        espnPlayerId: espnId,
        espnTeamId: p.teamId,
        name: name || snapshot?.name || `Player ${espnId || p.overallPickNumber}`,
        pos,
        nflTeam: live.team,
        adp: live.adp,
      };
    });
}

export function extrasFromMapped(mapped: MappedEspnPick[]): Player[] {
  const extras: Player[] = [];
  const seen = new Set<string>();
  for (const p of mapped) {
    if (seen.has(p.playerId)) continue;
    seen.add(p.playerId);
    if (p.playerId.startsWith("espn-")) {
      if (isPlaceholderEspnName(p.name) && !isValidEspnPlayerId(p.espnPlayerId)) continue;
      extras.push(
        stubFromEspn({
          id: p.playerId,
          espnId: espnPlayerIdOrZero(p.espnPlayerId),
          name: p.name,
          pos: p.pos,
          team: p.nflTeam,
          overall: p.overall,
          adp: p.adp,
        }),
      );
      continue;
    }
    const snap = PLAYER_BY_ID.get(p.playerId);
    if (!snap) continue;
    const live = mergeLiveEspnFields(snap, {
      team: p.nflTeam,
      bye: BYE_BY_TEAM[p.nflTeam] ?? 0,
      adp: p.adp,
    });
    if (live.team === snap.team && live.bye === snap.bye && live.adp === snap.adp) continue;
    extras.push({ ...snap, team: live.team, bye: live.bye, adp: live.adp });
  }
  return extras;
}

/** Overlay ESPN extras onto the snapshot board without writing sentinel team/bye/ADP. */
export function mergeBoardWithEspnExtras(base: Player[], extras: Player[]): Player[] {
  if (!extras.length) return base;
  const byId = new Map(base.map((p) => [p.id, p]));
  const appended: Player[] = [];
  for (const e of extras) {
    const prev = byId.get(e.id);
    if (prev) {
      const live = mergeLiveEspnFields(prev, { team: e.team, bye: e.bye, adp: e.adp });
      if (live.team !== prev.team || live.bye !== prev.bye || live.adp !== prev.adp) {
        byId.set(e.id, { ...prev, team: live.team, bye: live.bye, adp: live.adp });
      }
      continue;
    }
    if (isPlaceholderEspnName(e.name) && e.tags.includes("espn")) continue;
    const named = e.name ? matchByName(e.name) : undefined;
    if (named && byId.has(named.id)) {
      const snap = byId.get(named.id)!;
      const live = mergeLiveEspnFields(snap, { team: e.team, bye: e.bye, adp: e.adp });
      byId.set(named.id, { ...snap, team: live.team, bye: live.bye, adp: live.adp });
      continue;
    }
    appended.push(e);
  }
  return [...byId.values(), ...appended];
}

let playerCache: { season: number; byId: Map<number, EspnPlayerMeta> } | null = null;

export async function loadEspnPlayers(
  season: number,
  cookie?: string
): Promise<Map<number, EspnPlayerMeta>> {
  if (playerCache && playerCache.season === season && playerCache.byId.size > 200) {
    return playerCache.byId;
  }
  const url = `${ESPN_API}/seasons/${season}/players?view=players_wl&scoringPeriodId=0`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Fantasy-Filter": JSON.stringify({ filterActive: { value: true } }),
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) return playerCache?.byId ?? new Map();
  const raw: unknown = await res.json();
  const list = (Array.isArray(raw)
    ? raw
    : asRecord(raw)?.players && Array.isArray(asRecord(raw)?.players)
      ? (asRecord(raw)!.players as unknown[])
      : []) as Array<{
    id: number;
    fullName?: string;
    defaultPositionId?: number;
    proTeamId?: number;
    ownership?: { averageDraftPosition?: number };
    draftRanksByRankType?: Record<string, { rank?: number }>;
  }>;
  const byId = new Map<number, EspnPlayerMeta>();
  for (const p of list) {
    const pos = espnPos(p.defaultPositionId);
    const team =
      p.proTeamId == null ? "" : (PRO_TEAM[p.proTeamId] ?? "");
    const name = p.fullName ?? `Player ${p.id}`;
    const adpRaw =
      p.ownership?.averageDraftPosition ??
      p.draftRanksByRankType?.STANDARD?.rank ??
      p.draftRanksByRankType?.PPR?.rank;
    const adp = Number(adpRaw);
    const teamOrFa = team || "FA";
    byId.set(p.id, {
      id: p.id,
      name,
      pos,
      team: teamOrFa,
      ourId: matchOurPlayer(name, pos, teamOrFa),
      adp: adp > 0 ? adp : undefined,
    });
  }
  playerCache = { season, byId };
  return byId;
}

export async function fetchEspnLeague(args: {
  leagueId: string;
  season: number;
  cookie?: string;
}): Promise<{ ok: boolean; status: number; payload?: EspnLeaguePayload; error?: string; needAuth?: boolean }> {
  const views = ["mDraftDetail", "mRoster", "mSettings", "mTeam"].map((v) => `view=${v}`).join("&");
  const url = `${ESPN_API}/seasons/${args.season}/segments/0/leagues/${args.leagueId}?${views}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (args.cookie) headers.Cookie = args.cookie;
  const res = await fetch(url, { headers, cache: "no-store" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, error: "ESPN returned a non-JSON response." };
  }
  if (!res.ok) {
    const messages = (json as { messages?: Array<{ message?: string }> })?.messages;
    const msg = messages?.[0]?.message ?? `ESPN ${res.status}`;
    const needAuth = res.status === 401 || /AUTH|not visible|unauthorized/i.test(msg);
    return { ok: false, status: res.status, error: msg, needAuth };
  }
  return { ok: true, status: res.status, payload: json as EspnLeaguePayload };
}

export function isEspnBrowserOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "espn.com" || host.endsWith(".espn.com");
  } catch {
    return false;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Prefer a public preview host when the page itself is 127.0.0.1 (Cloud Agent). */
export function bookmarkletOrigin(pageOrigin: string, publicOrigin?: string): string {
  const page = (pageOrigin || "").replace(/\/$/, "");
  const pub = (publicOrigin || "").replace(/\/$/, "");
  if (isLoopbackOrigin(page) && pub && !isLoopbackOrigin(pub)) return pub;
  return page;
}

export function requestPublicOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = (req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http")
    .split(",")[0]
    .trim();
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host)
    .split(",")[0]
    .trim();
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export function ingestCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const espn = isEspnBrowserOrigin(origin);
  // Echo the browser Origin so ESPN pages can POST ingest (ACAO cannot be * with credentials).
  const allowOrigin = origin && origin !== "null" ? origin : "*";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (espn || (allowOrigin !== "*" && origin)) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export function parseEspnPickLog(text: string, teams = 12): EspnRawPick[] {
  const picks: EspnRawPick[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let overall = 0;
  for (const line of lines) {
    const numbered = line.match(
      /^(?:(\d+)\.(\d+)\s+|(?:pick\s+)?(\d+)[\.:)\s]+)(.+)$/i
    );
    if (!numbered) continue;
    if (numbered[1] && numbered[2]) {
      overall = (Number(numbered[1]) - 1) * teams + Number(numbered[2]);
    } else if (numbered[3]) {
      overall = Number(numbered[3]);
    } else {
      overall += 1;
    }
    let rest = (numbered[4] ?? "").replace(/^\d+[\.)]\s*/, "");
    rest = rest.replace(/\s*[—–-]\s*.*$/, "");
    const name = rest
      .replace(/,?\s*(QB|RB|WR|TE|K|DST|D\/ST|DEF)\b.*$/i, "")
      .replace(/,?\s*[A-Z]{2,3}\s*$/, "")
      .replace(/\s*\(.*\)\s*$/, "")
      .trim();
    if (!name || name.length < 3) continue;
    const player = matchByName(name);
    picks.push({
      overallPickNumber: overall,
      playerId: 0,
      teamId: 0,
      playerName: player?.name ?? name,
    });
  }
  return picks;
}

/** Bookmarklet that runs on fantasy.espn.com. Must stay cheap: no fiber walks, no body.innerText. */
export function buildBookmarklet(origin: string, relayUrl = ""): string {
  const code = `(function(){
var O=${JSON.stringify(origin.replace(/\/$/, ""))};
var RELAY=${JSON.stringify(relayUrl)};
var POLL=5000;
var API="https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
function takeSize(n){n=Number(n);return (n>=2&&n<=20)?n:0;}
function urlMeta(){
  var meta={leagueId:"",season:0,teamId:0,teams:0,leagueName:"",draftType:"snake",teamNames:null,slot:0,draftId:""};
  try{
    var href=String(location.href||"");
    var sp=new URLSearchParams(location.search);
    meta.leagueId=sp.get("leagueId")||"";
    if(!meta.leagueId){
      var lm=href.match(/[?&#/](?:leagueId=|leagues\\/|league\\/)(-?\\d+)/i);
      if(lm) meta.leagueId=lm[1];
    }
    meta.season=Number(sp.get("seasonId")||0)||0;
    if(!meta.season){
      var sm=href.match(/seasonId=(\\d{4})/i);
      if(sm) meta.season=Number(sm[1]);
    }
    meta.teamId=Number(sp.get("teamId")||0)||0;
    meta.draftId=sp.get("draftId")||sp.get("draftChannelId")||sp.get("mockDraftId")||"";
  }catch(e){}
  return meta;
}
function teamName(t,i){
  if(!t||typeof t!=="object") return "Team "+(i+1);
  return ((t.location||"")+" "+(t.nickname||"")).trim()||t.name||t.abbrev||("Team "+(i+1));
}
function applyLeague(json,meta){
  if(!json||typeof json!=="object") return meta;
  var s=json.settings||{};
  var size=takeSize(s.size);
  if(size) meta.teams=size;
  if(typeof s.name==="string"&&s.name.length>1) meta.leagueName=s.name;
  var ds=s.draftSettings||{};
  var ot=String(ds.orderType||ds.type||"");
  if(/LINEAR/i.test(ot)&&!/SNAKE/i.test(ot)) meta.draftType="linear";
  else meta.draftType=meta.draftType||"snake";
  var teams=Array.isArray(json.teams)?json.teams:[];
  var order=(ds.pickOrder&&ds.pickOrder.length)?ds.pickOrder:teams.map(function(t){return t.id;});
  if(teams.length>=2&&teams.length<=20){
    if(!meta.teams) meta.teams=teams.length;
    var byId={};
    teams.forEach(function(t){if(t&&t.id!=null) byId[t.id]=t;});
    meta.teamNames=order.map(function(id,i){return teamName(byId[id],i);});
  }
  if(meta.teamId&&order.length){
    var ix=order.indexOf(meta.teamId);
    if(ix<0) ix=order.indexOf(Number(meta.teamId));
    if(ix>=0) meta.slot=ix+1;
  }
  if(!meta.slot&&meta.teamId&&meta.teams&&meta.teamId>=1&&meta.teamId<=meta.teams) meta.slot=meta.teamId;
  if(!meta.teams) meta.teams=12;
  return meta;
}
function unwrap(json){
  if(Array.isArray(json)){
    for(var i=0;i<json.length;i++) if(json[i]&&typeof json[i]==="object") return json[i];
    return null;
  }
  if(json&&json.data&&typeof json.data==="object"&&(json.data.draftDetail||json.data.teams||json.data.picks||json.data.settings)) return json.data;
  return json;
}
function pid(p){
  var n=Number(p.playerId||0); if(n>0) return n;
  if(p.player&&typeof p.player==="object"){ n=Number(p.player.id||0); if(n>0) return n; }
  var ppe=p.playerPoolEntry;
  if(ppe&&typeof ppe==="object"){
    n=Number(ppe.playerId||0); if(n>0) return n;
    if(ppe.player&&typeof ppe.player==="object"){ n=Number(ppe.player.id||0); if(n>0) return n; }
  }
  n=Number(p.athleteId||0); if(n>0) return n;
  return 0;
}
function nameMap(json){
  var m={};
  function add(list){
    if(!Array.isArray(list)) return;
    for(var i=0;i<list.length;i++){
      var e=list[i]; if(!e||typeof e!=="object") continue;
      var pl=e.player||(e.playerPoolEntry&&e.playerPoolEntry.player)||e;
      var id=Number(e.id||e.playerId||(pl&&pl.id)||0);
      var nm=e.fullName||e.playerName||(pl&&(pl.fullName||pl.name))||"";
      if(id>0&&nm&&!/^ESPN\s+-?\d+$/i.test(nm)) m[id]=nm;
    }
  }
  add(json.players);
  if(Array.isArray(json.teams)){
    for(var t=0;t<json.teams.length;t++){
      var roster=json.teams[t]&&json.teams[t].roster;
      add(roster&&roster.entries);
    }
  }
  return m;
}
function pname(p,names){
  var n="",pl=p.player;
  if(pl&&typeof pl==="object") n=pl.fullName||pl.name||((pl.firstName||"")+" "+(pl.lastName||"")).trim();
  n=p.playerName||p.fullName||n||"";
  if(/^ESPN\s+-?\d+$/i.test(n)) n="";
  var id=pid(p);
  if(!n&&id&&names[id]) n=names[id];
  return n;
}
function takePicks(json){
  json=unwrap(json); if(!json) return [];
  var names=nameMap(json);
  var raw=(json.draftDetail&&json.draftDetail.picks)||json.picks||(json.draft&&json.draft.picks)||(json.draftBoard&&json.draftBoard.picks)||[];
  if(!Array.isArray(raw)||!raw.length){
    var bag=[],seen={};
    function walk(node,depth){
      if(!node||depth>5||bag.length>250) return;
      if(Array.isArray(node)){ for(var i=0;i<node.length;i++) walk(node[i],depth+1); return; }
      if(typeof node!=="object") return;
      if(node.overallPickNumber&&(node.playerId||node.player||node.athleteId)){
        var k=String(node.overallPickNumber)+":"+(node.playerId||"");
        if(!seen[k]){ seen[k]=1; bag.push(node); }
      }
      var ks=["draftDetail","draft","picks","draftPicks","draftBoard","selection"];
      for(var j=0;j<ks.length;j++) if(node[ks[j]]) walk(node[ks[j]],depth+1);
    }
    walk(json,0);
    if(bag.length) raw=bag;
  }
  var out=[],i,p,overall,playerId,name,team;
  if(Array.isArray(raw)){
    for(i=0;i<raw.length;i++){
      p=raw[i]; if(!p||typeof p!=="object") continue;
      overall=Number(p.overallPickNumber||p.overall||p.pickNumber||0);
      playerId=pid(p);
      name=pname(p,names);
      if(!overall||(!playerId&&!name)) continue;
      team=p.team&&typeof p.team==="object"?p.team.id:p.teamId;
      out.push({overallPickNumber:overall,playerId:playerId,teamId:Number(team||0),playerName:name});
    }
  }
  if(out.length){ out.sort(function(a,b){return a.overallPickNumber-b.overallPickNumber;}); return out; }
  if(Array.isArray(json.teams)){
    for(i=0;i<json.teams.length;i++){
      team=json.teams[i]; if(!team) continue;
      var entries=team.roster&&team.roster.entries; if(!Array.isArray(entries)) continue;
      for(var j=0;j<entries.length;j++){
        p=entries[j]; if(!p||typeof p!=="object") continue;
        var ppe=p.playerPoolEntry||p;
        playerId=pid({playerId:p.playerId||ppe.playerId,player:ppe.player||p.player,athleteId:ppe.athleteId});
        name=pname({player:ppe.player||p.player,playerName:p.playerName,playerId:playerId},names);
        if(!playerId&&!name) continue;
        out.push({overallPickNumber:out.length+1,playerId:playerId,teamId:Number(team.id||0),playerName:name});
      }
    }
  }
  if(!out.length&&Array.isArray(json.players)){
    for(i=0;i<json.players.length;i++){
      p=json.players[i]; if(!p||typeof p!=="object") continue;
      var on=Number(p.onTeamId||0); if(!(on>0)) continue;
      playerId=pid(p);
      name=pname(p,names);
      if(!playerId&&!name) continue;
      out.push({overallPickNumber:out.length+1,playerId:playerId,teamId:on,playerName:name});
    }
  }
  return out;
}
function isLeaguePayload(json){
  json=unwrap(json);
  return !!(json&&typeof json==="object"&&(json.draftDetail||json.draft||(json.settings&&json.teams)||(Array.isArray(json.picks)&&json.picks[0]&&(json.picks[0].overallPickNumber||json.picks[0].player||json.picks[0].playerId))));
}
function emptyWhy(meta,err){
  if(err) return String(err);
  if(!meta||!meta.leagueId) return "no leagueId in this URL";
  return "0 filled slots";
}
function badge(n,meta,err){
  var b=document.getElementById("draft-room-sync");
  if(!b){
    b=document.createElement("div");
    b.id="draft-room-sync";
    b.style.cssText="position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#1f6a45;color:#fff;padding:10px 14px;border-radius:12px;font:13px/1.35 system-ui,sans-serif;box-shadow:0 8px 24px #0005;max-width:360px";
    document.body.appendChild(b);
  }
  var why=err?String(err):"";
  var label=(meta&&meta.leagueName)?meta.leagueName:(meta&&meta.leagueId)?("League "+meta.leagueId):"this ESPN draft";
  var clock=new Date().toLocaleTimeString();
  var waiting=!n&&!!(meta&&(meta.leagueName||meta.leagueId));
  b.style.background=n||waiting?"#1f6a45":"#9b1c1c";
  if(n){
    b.textContent="Draft Room is syncing "+n+" picks from "+label+" · "+clock;
    return;
  }
  if(waiting){
    b.textContent="Draft Room connected to "+label+" · 0 picks · waiting · "+clock;
    return;
  }
  b.textContent="Draft Room · 0 picks — "+(why||emptyWhy(meta))+" · "+clock;
}
function idle(fn){
  if(typeof requestIdleCallback==="function") requestIdleCallback(function(){fn();},{timeout:1500});
  else setTimeout(fn,0);
}
var sending=false,lastSig="",lastMeta=urlMeta(),pending=null;
function flushPending(){
  if(!pending) return;
  var n=pending; pending=null;
  post(n.picks,n.meta);
}
function pack(picks,meta){
  var rows=[],i,p;
  for(i=0;i<picks.length;i++){
    p=picks[i];
    rows.push([p.overallPickNumber,p.playerId||0,p.teamId||0,p.playerName||""]);
  }
  var packed=JSON.stringify({v:1,p:rows,m:meta||{},h:location.href,t:Date.now()});
  if(packed.length>3500){
    rows=rows.map(function(r){return [r[0],r[1],r[2]];});
    packed=JSON.stringify({v:1,p:rows,m:meta||{},h:location.href,t:Date.now()});
  }
  return packed;
}
function postRelay(picks,meta){
  if(!RELAY||!picks||!picks.length) return;
  try{fetch(RELAY,{method:"POST",headers:{"Content-Type":"text/plain"},body:pack(picks,meta),mode:"cors",keepalive:true}).catch(function(){});}catch(e){}
}
function post(picks,meta,err){
  lastMeta=meta;
  if(!picks||!picks.length){
    var why=emptyWhy(meta,err);
    var hmeta={};
    for(var k in (meta||{})) hmeta[k]=meta[k];
    hmeta.reason=why;
    badge(0,hmeta,why);
    var hsig="0:"+why+":"+(meta&&meta.leagueId||"");
    if(hsig===lastSig){ badge(0,hmeta,why); return; }
    lastSig=hsig;
    fetch(O+"/api/espn/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({picks:[],href:location.href,title:document.title,ts:Date.now(),meta:hmeta}),mode:"cors",keepalive:true}).catch(function(){});
    return;
  }
  var sig=picks.length+":"+picks[picks.length-1].overallPickNumber+":"+picks[picks.length-1].playerId+":"+(meta.teams||"")+":"+(meta.leagueId||"");
  if(sig===lastSig){ badge(picks.length,meta); return; }
  postRelay(picks,meta);
  if(sending){ pending={picks:picks,meta:meta}; return; }
  sending=true;
  lastSig=sig;
  var body=JSON.stringify({picks:picks,href:location.href,title:document.title,ts:Date.now(),meta:meta});
  fetch(O+"/api/espn/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:body,mode:"cors",keepalive:true}).then(function(r){
    sending=false;
    if(!r.ok) throw new Error("HTTP "+r.status);
    badge(picks.length,meta);
    flushPending();
  }).catch(function(e){
    sending=false;
    badge(picks.length,meta);
    flushPending();
  });
}
function ingestJson(json){
  json=unwrap(json);
  if(!json||typeof json!=="object") return;
  if(json.draftPick&&typeof json.draftPick==="object") json={picks:[json.draftPick]};
  var got=takePicks(json);
  if(!got.length&&!isLeaguePayload(json)) return;
  var meta=applyLeague(json,lastMeta||urlMeta());
  post(got,meta);
}
function draftUrl(u){
  u=String(u||"");
  if(/\\/players\\?|view=players_wl/i.test(u)) return false;
  return /mDraftDetail|mDraft(?:[^A-Za-z]|$)|draftDetail|draftRecap|draftStatus|mRoster|\\/leagues\\/-?\\d+|leagueHistory|\\/drafts\\/\\d+|gambit-api|livedraft|recentActivity/i.test(u);
}
function hookWs(){
  var WS=window.WebSocket;
  if(typeof WS!=="function"||WS.__draftRoomEspn) return;
  function Wrapped(url,proto){
    var ws=proto!==undefined?new WS(url,proto):new WS(url);
    try{
      ws.addEventListener("message",function(ev){
        idle(function(){
          try{
            var raw=ev&&ev.data;
            if(typeof raw!=="string"||raw.length>2000000) return;
            var json=JSON.parse(raw);
            ingestJson(json);
          }catch(e){}
        });
      });
    }catch(e){}
    return ws;
  }
  Wrapped.prototype=WS.prototype;
  Wrapped.__draftRoomEspn=1;
  window.WebSocket=Wrapped;
}
function hookNet(){
  if(window.__draftRoomEspnHooked) return;
  window.__draftRoomEspnHooked=1;
  hookWs();
  var ofetch=window.fetch;
  if(typeof ofetch==="function"){
    window.fetch=function(){
      var req=arguments[0];
      var url=typeof req==="string"?req:(req&&req.url)||"";
      var p=ofetch.apply(this,arguments);
      if(draftUrl(url)){
        p.then(function(res){
          try{if(res&&res.ok) res.clone().json().then(ingestJson).catch(function(){});}catch(e){}
          return res;
        }).catch(function(){});
      }
      return p;
    };
  }
  var XO=XMLHttpRequest.prototype.open, XS=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__drUrl=u;return XO.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(){
    var xhr=this;
    xhr.addEventListener("load",function(){
      try{
        if(xhr.status>=200&&xhr.status<300&&draftUrl(xhr.__drUrl)&&xhr.responseText&&xhr.responseText.length<2000000){
          idle(function(){try{ingestJson(JSON.parse(xhr.responseText));}catch(e){}});
        }
      }catch(e){}
    });
    return XS.apply(this,arguments);
  };
}
function pullApi(){
  var meta=urlMeta();
  if(!meta.leagueId){ post([],lastMeta||meta,"no leagueId in this URL"); return; }
  var views="view=mDraftDetail&view=mRoster&view=mSettings&view=mTeam&view=draftRecap";
  var season=meta.season||2026;
  var path="/apis/v3/games/ffl/seasons/"+season+"/segments/0/leagues/"+meta.leagueId+"?"+views;
  var urls=[location.origin+path,"https://fantasy.espn.com"+path,"https://gambit-api.fantasy.espn.com"+path,API+"/seasons/"+season+"/segments/0/leagues/"+meta.leagueId+"?"+views];
  if(meta.draftId){
    urls.unshift(location.origin+"/apis/v3/games/ffl/seasons/"+season+"/drafts/"+meta.draftId);
    urls.unshift("https://gambit-api.fantasy.espn.com/apis/v1/games/ffl/seasons/"+season+"/drafts/"+meta.draftId);
  }
  var i=0,lastErr="";
  function tryNext(){
    if(i>=urls.length){
      var n=(lastSig&&lastSig.charAt(0)!=="0"&&Number(lastSig.split(":")[0]))||0;
      if(n){ badge(n,lastMeta||meta); return; }
      post([],lastMeta||meta,lastErr||"0 filled slots");
      return;
    }
    var url=urls[i++];
    var ctrl=typeof AbortController==="function"?new AbortController():null;
    var t=setTimeout(function(){try{ctrl&&ctrl.abort();}catch(e){}},8000);
    fetch(url,{credentials:"include",cache:"no-store",signal:ctrl?ctrl.signal:undefined}).then(function(r){
      clearTimeout(t);
      if(!r.ok) throw new Error("ESPN "+r.status);
      return r.json();
    }).then(function(json){ ingestJson(json); }).catch(function(e){
      clearTimeout(t);
      lastErr=String((e&&e.message)||e||"ESPN failed");
      tryNext();
    });
  }
  tryNext();
}
function kick(){ idle(pullApi); }
if(window.__draftRoomEspn&&window.__draftRoomEspn.kick){
  window.__draftRoomEspn.kick();
  badge(0,lastMeta);
  return;
}
hookNet();
badge(0,lastMeta);
window.__draftRoomEspn={kick:kick,timer:setInterval(kick,POLL)};
kick();
})();`;
  return `javascript:${code.replace(/\n/g, "")}`;
}
