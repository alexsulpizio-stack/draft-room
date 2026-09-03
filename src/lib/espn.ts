import { BYE_BY_TEAM } from "./bye-weeks";
import { pickOwner } from "./draft";
import { espnBookmarkletCode } from "./espn-bookmarklet";
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
  /** ESPN team ids in draft order (slot 1 = pickOrder[0]). */
  pickOrder?: number[];
  /** Bookmarklet 0-pick reason: no leagueId / 0 filled slots / ESPN 401. */
  reason?: string;
};

/** Normalize ESPN pickOrder arrays from ingest meta / league settings. */
export function clampEspnPickOrder(
  order: unknown,
  teams?: number,
): number[] | undefined {
  if (!Array.isArray(order) || order.length < 2) return undefined;
  const ids = order.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length < 2) return undefined;
  if (teams && ids.length !== teams) return undefined;
  return ids;
}

/**
 * Map an ESPN pick to a Draft Room 1-based slot.
 * Prefer pickOrder index when teamId is present; never treat raw ESPN teamId as
 * the draft slot when pickOrder is missing — fall back to overall + draft type.
 */
export function resolveEspnTeamSlot(args: {
  teamId: number;
  overall: number;
  pickOrder: number[];
  teamsCount: number;
  draftType?: DraftType;
}): number {
  const { teamId, overall, pickOrder, teamsCount, draftType = "snake" } = args;
  if (teamId > 0 && pickOrder.length > 0) {
    const orderIdx = pickOrder.indexOf(teamId);
    if (orderIdx >= 0) return orderIdx + 1;
  }
  return pickOwner(overall, teamsCount, draftType);
}

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
  const pickOrder = clampEspnPickOrder(body?.pickOrder, teams);
  const teamId = body?.teamId || fromHref.teamId;
  let slot = body?.slot && body.slot >= 1 && body.slot <= 20 ? body.slot : undefined;
  if (!slot && teamId && pickOrder?.length) {
    const ix = pickOrder.indexOf(teamId);
    if (ix >= 0) slot = ix + 1;
  }
  // Do not treat raw ESPN teamId as draft slot — ids often differ from pick order.
  // Omit undefined keys so heartbeats / partial metas cannot wipe pickOrder or teams.
  const next: EspnIngestMeta = {
    ...fromHref,
  };
  if (body) {
    for (const [k, v] of Object.entries(body) as Array<[keyof EspnIngestMeta, EspnIngestMeta[keyof EspnIngestMeta]]>) {
      if (v !== undefined && v !== null) (next as Record<string, unknown>)[k] = v;
    }
  }
  next.leagueId = body?.leagueId || fromHref.leagueId;
  next.season = body?.season || fromHref.season;
  if (teamId) next.teamId = teamId;
  if (teams) next.teams = teams;
  if (pickOrder) next.pickOrder = pickOrder;
  if (slot) next.slot = slot;
  if (leagueName) next.leagueName = leagueName;
  if (body?.draftType === "linear") next.draftType = "linear";
  else if (body?.draftType === "snake") next.draftType = "snake";
  if (body?.teamNames?.length) next.teamNames = body.teamNames;
  if (body?.reason) next.reason = body.reason;
  return next;
}

export function patchSettingsFromEspnMeta(
  current: LeagueSettings,
  meta: EspnIngestMeta,
): LeagueSettings {
  const teams = clampEspnTeams(meta.teams) ?? current.teams;
  const pickOrder = clampEspnPickOrder(meta.pickOrder, teams);
  let slot = current.slot;
  if (meta.slot && meta.slot >= 1 && meta.slot <= teams) slot = meta.slot;
  else if (meta.teamId && pickOrder?.length) {
    const ix = pickOrder.indexOf(meta.teamId);
    if (ix >= 0) slot = ix + 1;
  }
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

/**
 * ESPN player-list / projection rows stringify as space-separated ints
 * (`0 0 0 0 0 0 0 190 765 4 43 41 300 1 17 1`). Never treat those as names.
 */
export function looksLikeEspnStatDump(raw: string | undefined | null): boolean {
  const s = String(raw ?? "")
    .replace(/[,\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  if (/^0(?:\s+0){3,}/.test(s)) return true;
  const parts = s.split(" ");
  const nums = parts.filter((t) => /^-?\d+(?:\.\d+)?$/.test(t));
  if (nums.length >= 6 && nums.length >= parts.length - 1) return true;
  if (!/[A-Za-z]{2,}/.test(s) && nums.length >= 4) return true;
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (digits >= 10 && digits > letters * 2) return true;
  return false;
}

/** Real person / DST name — not a placeholder, stat line, or id dump. */
export function isDisplayablePlayerName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (isPlaceholderEspnName(trimmed)) return false;
  if (looksLikeEspnStatDump(trimmed)) return false;
  return /[A-Za-z]{2,}/.test(trimmed);
}

/** Pick log label: a real name, or a waiting placeholder — never ids / ints. */
export function pickLogDisplayName(player: { name?: unknown } | undefined): string {
  return isDisplayablePlayerName(player?.name) ? player.name.trim() : "Waiting for name";
}

/** Synthetic / sample names that must never drive board matching. */
export function isPlaceholderEspnName(name: string | undefined | null): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  // Unfilled ESPN slots: "ESPN -1", "ESPN 0"
  const espnSlot = trimmed.match(/^ESPN\s+(-?\d+)$/i);
  if (espnSlot) return Number(espnSlot[1]) <= 0;
  // Generic stubs
  if (/^player\s+-?\d+$/i.test(trimmed)) return true;
  if (/^(unknown(\s+player)?|n\/?a|null|undefined|sample|placeholder|lorem)$/i.test(trimmed)) {
    return true;
  }
  if (looksLikeEspnStatDump(trimmed)) return true;
  if (!/[A-Za-z]{2,}/.test(trimmed)) return true;
  return false;
}

/**
 * True when ESPN id metadata clearly disagrees with the scraped/pick name.
 * Practice-draft scrapes often pair a correct name with the wrong athlete id.
 */
export function espnMetaConflictsWithName(
  metaName: string | undefined,
  pickName: string | undefined,
): boolean {
  if (!metaName || !pickName) return false;
  if (isPlaceholderEspnName(metaName) || isPlaceholderEspnName(pickName)) return false;
  const a = compactPlayerName(metaName);
  const b = compactPlayerName(pickName);
  if (!a || !b || a === b) return false;
  const aLast = lastNameOf(metaName);
  const bLast = lastNameOf(pickName);
  if (aLast && aLast === bLast && firstNamesCompatible(firstNameOf(metaName), firstNameOf(pickName))) {
    return false;
  }
  return true;
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
  const rawName = meta.name.replace(/\s+D\/ST$/i, "");
  const name = isDisplayablePlayerName(rawName) ? rawName : cleanPickLogName(rawName);
  const named = name ? matchByName(name) : undefined;
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
    note: "On ESPN's board but not in this snapshot.",
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
    .filter((p) => {
      const cleaned = p.playerName ? cleanPickLogName(p.playerName) : "";
      const nameOk = Boolean(cleaned) && !isPlaceholderEspnName(cleaned);
      const idOk = isValidEspnPlayerId(p.playerId);
      if (!idOk && !nameOk) return false;
      // Text scrapes turn projected points (75.05) into huge overalls. JSON has real ids.
      if (!idOk && p.overallPickNumber > teamsCount * ESPN_PICK_LOG_MAX_ROUND) return false;
      return true;
    })
    .map((p) => {
      const espnIdRaw = espnPlayerIdOrZero(p.playerId);
      const metaRaw = espnIdRaw ? players.get(espnIdRaw) : undefined;
      const cleanedName = p.playerName ? cleanPickLogName(p.playerName) : "";
      const rawName =
        cleanedName &&
        !isPlaceholderEspnName(cleanedName) &&
        !/^player\s+\d+$/i.test(cleanedName)
          ? cleanedName
          : p.playerName &&
              !isPlaceholderEspnName(p.playerName) &&
              !looksLikeEspnStatDump(p.playerName) &&
              !/^player\s+\d+$/i.test(p.playerName.trim())
            ? p.playerName
            : undefined;
      // Prefer the pick's own name. If ESPN id metadata is a different player, drop the id —
      // practice scrapes often attach the wrong athlete id to a correct name.
      const metaConflicts = espnMetaConflictsWithName(metaRaw?.name, rawName);
      const espnId = metaConflicts ? 0 : espnIdRaw;
      const meta = metaConflicts ? undefined : metaRaw;
      const name = rawName || meta?.name || "";
      // Name match wins over id→meta. Wrong ids were flipping Gibbs to WR, Chase to RB, etc.
      const namedSnap = name ? matchByName(name) : undefined;
      const snapshot =
        namedSnap ?? (meta?.ourId ? PLAYER_BY_ID.get(meta.ourId) : undefined);
      const pos = snapshot?.pos ?? meta?.pos ?? "WR";
      const live = mergeLiveEspnFields(snapshot, {
        // Only apply ESPN team when it agrees with the named player (or we have no name match).
        team: namedSnap ? undefined : meta?.team,
        bye: snapshot?.bye ?? (meta?.team ? BYE_BY_TEAM[meta.team] ?? 0 : 0),
        adp: namedSnap?.adp ?? meta?.adp ?? snapshot?.adp,
      });
      let ourId = snapshot?.id ?? meta?.ourId ?? (name ? matchOurPlayer(name, pos, live.team) : null);
      if (!ourId) ourId = unmatchedEspnId(name, p.overallPickNumber, espnId);
      if (ourId.startsWith("espn-") && name) {
        const named = matchByName(name);
        if (named) ourId = named.id;
      }
      if (usedIds.has(ourId)) ourId = unmatchedEspnId(name, p.overallPickNumber) + `-p${p.overallPickNumber}`;
      usedIds.add(ourId);
      const team = resolveEspnTeamSlot({
        teamId: p.teamId,
        overall: p.overallPickNumber,
        pickOrder,
        teamsCount,
        draftType,
      });
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

/** Accept ESPN draft captures and manual paste logs; reject FP/DS scrapes that land on the ESPN ingest channel. */
export function isAllowedEspnIngestHref(href: unknown): boolean {
  if (typeof href !== "string" || !href.trim()) return false;
  if (href === "paste" || href === "cleared") return true;
  try {
    const host = new URL(href).hostname.toLowerCase();
    return host === "espn.com" || host.endsWith(".espn.com");
  } catch {
    return /espn\.com/i.test(href);
  }
}

/** True only for a real ESPN room or a paste log — not a clear stamp or a href-less test write. */
export function isLiveEspnCaptureHref(href: unknown): boolean {
  if (href === "cleared") return false;
  return isAllowedEspnIngestHref(href);
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Normalize an origin URL (trim trailing slash). Returns "" if empty/invalid-looking. */
export function normalizeOrigin(origin: string | undefined | null): string {
  const raw = (origin || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!u.hostname) return "";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

/**
 * Operator-configured public Draft Room URL (Cloud preview / share link).
 * Used when the request Host is loopback but ESPN/FP/DS run on another machine.
 */
export function configuredPublicOrigin(): string {
  return normalizeOrigin(
    process.env.DRAFT_ROOM_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_DRAFT_ROOM_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "",
  );
}

/**
 * Prefer a reachable (non-loopback) origin for bookmarklets.
 * Order: non-loopback page → non-loopback public → page → public.
 */
export function resolveEspnBookmarkOrigin(pageOrigin: string, publicOrigin?: string): string {
  const page = normalizeOrigin(pageOrigin);
  const pub = normalizeOrigin(publicOrigin);
  if (page && !isLoopbackOrigin(page)) return page;
  if (pub && !isLoopbackOrigin(pub)) return pub;
  return page || pub;
}

/** @deprecated Prefer resolveEspnBookmarkOrigin — kept for existing imports. */
export function bookmarkletOrigin(pageOrigin: string, publicOrigin?: string): string {
  return resolveEspnBookmarkOrigin(pageOrigin, publicOrigin);
}

/** Host as seen on the incoming request (x-forwarded-* aware), before env override. */
export function requestHostOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = (req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http")
    .split(",")[0]
    .trim();
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host)
    .split(",")[0]
    .trim();
  if (!host) return "";
  return normalizeOrigin(`${proto}://${host}`);
}

/**
 * Reachable Draft Room origin for bookmarklets / ingest URLs.
 * Prefers configured public URL when the request Host is loopback (Cloud Agent VM).
 */
export function requestPublicOrigin(req: Request): string {
  const hostOrigin = requestHostOrigin(req);
  const configured = configuredPublicOrigin();
  if (hostOrigin && !isLoopbackOrigin(hostOrigin)) return hostOrigin;
  if (configured && !isLoopbackOrigin(configured)) return configured;
  return hostOrigin || configured;
}

export type OriginDiagnostics = {
  publicOrigin: string;
  requestHostOrigin: string;
  configuredOrigin: string;
  loopback: boolean;
  /** True when Host is public/preview but we would still bake loopback without overrides. */
  loopbackHostMismatch: boolean;
  /** True when bookmarklets would POST to localhost (unreachable from ESPN/FP/DS on another machine). */
  loopbackRisk: boolean;
};

export function originDiagnostics(req: Request, pageOrigin?: string): OriginDiagnostics {
  const requestHost = requestHostOrigin(req);
  const configured = configuredPublicOrigin();
  const publicOrigin = requestPublicOrigin(req);
  const baked = resolveEspnBookmarkOrigin(pageOrigin || publicOrigin, publicOrigin);
  const loopback = isLoopbackOrigin(baked);
  const hostIsLoopback = !requestHost || isLoopbackOrigin(requestHost);
  return {
    publicOrigin,
    requestHostOrigin: requestHost,
    configuredOrigin: configured,
    loopback,
    loopbackHostMismatch: loopback && !hostIsLoopback,
    loopbackRisk: loopback,
  };
}

export function isRanksBrowserOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return (
      host === "fantasypros.com" ||
      host.endsWith(".fantasypros.com") ||
      host === "draftsharks.com" ||
      host.endsWith(".draftsharks.com")
    );
  } catch {
    return false;
  }
}

export function ingestCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const trusted =
    isEspnBrowserOrigin(origin) || isRanksBrowserOrigin(origin);
  // Echo the browser Origin so ESPN/FP/DS pages can POST ingest (ACAO cannot be * with credentials).
  const allowOrigin = origin && origin !== "null" ? origin : "*";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (trusted || (allowOrigin !== "*" && origin)) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

const PICK_LOG_UI = /^(pick|round|team|draft|start|bench|overall|player|clock|on the clock)$/i;

/** ESPN text scrape: pick numbers are 1.01–16.XX. 75.05 / 91.03 are projected points. */
export const ESPN_PICK_LOG_MAX_ROUND = 16;

/** Strip "WR CIN", "Last, First", rank prefixes, and pick-number prefixes from scraped ESPN text. */
export function cleanPickLogName(raw: string): string {
  let name = String(raw || "").replace(/\t+/g, " ").replace(/\s+/g, " ").trim();
  if (looksLikeEspnStatDump(name)) return "";
  name = name.replace(/^\d+\.\d{1,2}\s+/, "");
  name = name.replace(/^\d{1,3}\s+/, "");
  name = name.replace(/,?\s+(QB|RB|WR|TE|K|DST|D\/ST|DEF)\b.*$/i, "");
  name = name.replace(/,?\s+[A-Z]{2,3}\s*$/, "");
  name = name.replace(/\s*\(.*\)\s*$/, "");
  name = name.replace(/\s*[—–·•]\s*.*$/, "").trim();
  name = name.replace(/\s+-\s+.*$/, "").trim();
  name = name.replace(/\s+[QOP]$/i, "").trim();
  if (name.includes(",")) name = flipLastFirst(name);
  if (!name || name.length < 3 || name.length > 42) return "";
  if (isPlaceholderEspnName(name) || PICK_LOG_UI.test(name)) return "";
  if (!/[A-Za-z]{2,}/.test(name)) return "";
  if (looksLikeEspnStatDump(name)) return "";
  return name;
}

export function parseEspnPickLog(text: string, teams = 12): EspnRawPick[] {
  const size = teams >= 2 && teams <= 20 ? teams : 12;
  const maxOverall = size * ESPN_PICK_LOG_MAX_ROUND;
  const byOverall = new Map<number, EspnRawPick>();
  const push = (overall: number, rawName: string) => {
    if (!Number.isFinite(overall) || overall < 1 || overall > maxOverall) return;
    if (byOverall.has(overall)) return;
    const name = cleanPickLogName(rawName);
    if (!name) return;
    const player = matchByName(name) ?? matchByName(flipLastFirst(name));
    byOverall.set(overall, {
      overallPickNumber: overall,
      playerId: 0,
      teamId: 0,
      playerName: player?.name ?? name,
    });
  };

  const blob = String(text || "").replace(/\r/g, "\n");
  const hits: Array<{ index: number; len: number; round: number; slot: number }> = [];
  const rp = /(\d{1,2})\.(\d{1,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = rp.exec(blob))) {
    hits.push({
      index: m.index,
      len: m[0].length,
      round: Number(m[1]),
      slot: Number(m[2]),
    });
  }
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (hit.round < 1 || hit.round > ESPN_PICK_LOG_MAX_ROUND || hit.slot < 1 || hit.slot > Math.max(size, 16)) continue;
    const start = hit.index + hit.len;
    const end = i + 1 < hits.length ? hits[i + 1].index : Math.min(blob.length, start + 90);
    push((hit.round - 1) * size + hit.slot, blob.slice(start, end).replace(/[\n\t]+/g, " "));
  }

  let overall = 0;
  for (const line of blob.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const numbered = line.match(
      /^(?:(\d+)\.(\d+)\s+|(?:pick\s+)?(\d+)[\.:)\s]+)(.+)$/i,
    );
    if (!numbered) continue;
    if (numbered[1] && numbered[2]) {
      overall = (Number(numbered[1]) - 1) * size + Number(numbered[2]);
    } else if (numbered[3]) {
      overall = Number(numbered[3]);
    } else {
      overall += 1;
    }
    push(overall, numbered[4] ?? "");
  }

  return [...byOverall.values()].sort((a, b) => a.overallPickNumber - b.overallPickNumber);
}

/** Bookmarklet that runs on fantasy.espn.com. Source uses String.raw so regexes stay intact. */
export function buildBookmarklet(origin: string, relayUrl = ""): string {
  return `javascript:${espnBookmarkletCode(origin, relayUrl).replace(/\n/g, "")}`;
}
