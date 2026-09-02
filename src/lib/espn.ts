import { BYE_BY_TEAM } from "./bye-weeks";
import { pickOwner } from "./draft";
import { PLAYERS } from "./players";
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
};

export type EspnPlayerMeta = {
  id: number;
  name: string;
  pos: Position;
  team: string;
  ourId: string | null;
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
  const fromQuery = trimmed.match(/[?&]leagueId=(\d+)/i);
  if (fromQuery) return fromQuery[1];
  const fromPath = trimmed.match(/leagues\/(\d+)/i);
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
}): Player {
  return {
    id: `espn-${meta.espnId}`,
    name: meta.name.replace(/\s+D\/ST$/i, ""),
    team: meta.team,
    pos: meta.pos,
    bye: BYE_BY_TEAM[meta.team] ?? 0,
    fpRank: 999,
    dsRank: 999,
    adp: 400,
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

  const apiPicks = (payload.draftDetail?.picks ?? []).filter((p) => p.playerId && p.playerId !== 0);

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

export function rawPicksFromDetail(payload: EspnLeaguePayload): EspnRawPick[] {
  const picks = payload.draftDetail?.picks ?? [];
  return picks
    .filter((p) => p.playerId != null && p.playerId !== 0)
    .map((p) => ({
      overallPickNumber: Number(p.overallPickNumber ?? 0),
      playerId: Number(p.playerId),
      teamId: Number(p.teamId ?? 0),
      roundId: p.roundId,
    }))
    .filter((p) => p.overallPickNumber > 0)
    .sort((a, b) => a.overallPickNumber - b.overallPickNumber);
}

export function mergeEspnPicks(api: EspnRawPick[], ingest: EspnRawPick[]): EspnRawPick[] {
  const byOverall = new Map<number, EspnRawPick>();
  for (const p of [...api, ...ingest]) {
    if (!p.playerId && !p.playerName) continue;
    if (p.playerId === 0 && !p.playerName) continue;
    const overall = Number(p.overallPickNumber);
    if (!overall) continue;
    const prev = byOverall.get(overall);
    if (!prev) {
      byOverall.set(overall, { ...p, overallPickNumber: overall });
      continue;
    }
    byOverall.set(overall, {
      ...prev,
      ...p,
      overallPickNumber: overall,
      playerId: p.playerId || prev.playerId,
      teamId: p.teamId || prev.teamId,
      playerName: p.playerName || prev.playerName,
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
  return picks.map((p) => {
    const meta = p.playerId ? players.get(p.playerId) : undefined;
    const name = p.playerName || meta?.name || `ESPN ${p.playerId}`;
    const pos = meta?.pos ?? "WR";
    const nflTeam = meta?.team ?? "FA";
    let ourId = meta?.ourId ?? matchOurPlayer(name, pos, nflTeam);
    if (!ourId) ourId = `espn-${p.playerId || normalizePlayerName(name).replace(/\s+/g, "-")}`;
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
      espnPlayerId: p.playerId,
      espnTeamId: p.teamId,
      name,
      pos,
      nflTeam,
    };
  });
}

export function extrasFromMapped(mapped: MappedEspnPick[]): Player[] {
  const extras: Player[] = [];
  const seen = new Set<string>();
  for (const p of mapped) {
    if (!p.playerId.startsWith("espn-")) continue;
    if (seen.has(p.playerId)) continue;
    seen.add(p.playerId);
    extras.push(
      stubFromEspn({
        espnId: p.espnPlayerId || 0,
        name: p.name,
        pos: p.pos,
        team: p.nflTeam,
      })
    );
  }
  return extras;
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
  const list = (await res.json()) as Array<{
    id: number;
    fullName?: string;
    defaultPositionId?: number;
    proTeamId?: number;
  }>;
  const byId = new Map<number, EspnPlayerMeta>();
  for (const p of list) {
    const pos = espnPos(p.defaultPositionId);
    const team = PRO_TEAM[p.proTeamId ?? 0] ?? "FA";
    const name = p.fullName ?? `Player ${p.id}`;
    byId.set(p.id, {
      id: p.id,
      name,
      pos,
      team,
      ourId: matchOurPlayer(name, pos, team),
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
  const views = ["mDraftDetail", "mSettings", "mTeam"].map((v) => `view=${v}`).join("&");
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

export function ingestCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  let host = "";
  try {
    host = origin ? new URL(origin).hostname : "";
  } catch {
    host = "";
  }
  const espn = /(^|\.)espn\.com$/i.test(host);
  return {
    "Access-Control-Allow-Origin": espn ? origin : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
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
export function buildBookmarklet(origin: string): string {
  const code = `(function(){
var O=${JSON.stringify(origin.replace(/\/$/, ""))};
var POLL=6000;
var API="https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
function takeSize(n){n=Number(n);return (n>=2&&n<=20)?n:0;}
function urlMeta(){
  var meta={leagueId:"",season:0,teamId:0,teams:0,leagueName:"",draftType:"snake",teamNames:null,slot:0};
  try{
    var sp=new URLSearchParams(location.search);
    meta.leagueId=sp.get("leagueId")||"";
    meta.season=Number(sp.get("seasonId")||0)||0;
    meta.teamId=Number(sp.get("teamId")||0)||0;
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
function takePicks(json){
  var raw=(json&&json.draftDetail&&json.draftDetail.picks)||(json&&json.picks)||[];
  if(!Array.isArray(raw)) return [];
  var out=[],i,p,overall,playerId,name;
  for(i=0;i<raw.length;i++){
    p=raw[i];
    if(!p||typeof p!=="object") continue;
    overall=Number(p.overallPickNumber||p.overall||0);
    playerId=Number(p.playerId||0);
    name=p.playerName||p.fullName||"";
    if(!overall||(!playerId&&!name)) continue;
    out.push({overallPickNumber:overall,playerId:playerId,teamId:Number(p.teamId||0),playerName:name});
  }
  out.sort(function(a,b){return a.overallPickNumber-b.overallPickNumber;});
  return out;
}
function isLeaguePayload(json){
  return !!(json&&typeof json==="object"&&(json.draftDetail||(json.settings&&json.teams)||(Array.isArray(json.picks)&&json.picks[0]&&json.picks[0].overallPickNumber)));
}
function badge(n,meta,err){
  var b=document.getElementById("draft-room-sync");
  if(!b){
    b=document.createElement("div");
    b.id="draft-room-sync";
    b.style.cssText="position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#1f6a45;color:#fff;padding:10px 14px;border-radius:12px;font:13px/1.35 system-ui,sans-serif;box-shadow:0 8px 24px #0005;max-width:280px";
    document.body.appendChild(b);
  }
  b.style.background=err?"#9b1c1c":"#1f6a45";
  var label=(meta&&meta.leagueName)?meta.leagueName:(meta&&meta.leagueId)?("League "+meta.leagueId):"this ESPN draft";
  b.textContent=err?("Draft Room · "+err):("Draft Room is syncing "+n+" picks from "+label+". Leave this tab open.");
}
function idle(fn){
  if(typeof requestIdleCallback==="function") requestIdleCallback(function(){fn();},{timeout:1500});
  else setTimeout(fn,0);
}
var sending=false,lastSig="",lastMeta=urlMeta();
function post(picks,meta){
  lastMeta=meta;
  if(!picks||!picks.length){ badge(0,meta); return; }
  var sig=picks.length+":"+picks[picks.length-1].overallPickNumber+":"+picks[picks.length-1].playerId+":"+(meta.teams||"")+":"+(meta.leagueId||"");
  if(sig===lastSig){ badge(picks.length,meta); return; }
  if(sending) return;
  sending=true;
  lastSig=sig;
  var body=JSON.stringify({picks:picks,href:location.href,title:document.title,ts:Date.now(),meta:meta});
  fetch(O+"/api/espn/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:body,mode:"cors",keepalive:true}).then(function(r){
    sending=false;
    if(!r.ok) throw new Error("HTTP "+r.status);
    badge(picks.length,meta);
  }).catch(function(e){
    sending=false;
    lastSig="";
    try{navigator.sendBeacon(O+"/api/espn/ingest",new Blob([body],{type:"application/json"}));}catch(e2){}
    badge(picks.length,meta,String(e.message||e));
  });
}
function ingestJson(json){
  if(!isLeaguePayload(json)) return;
  var meta=applyLeague(json,urlMeta());
  post(takePicks(json),meta);
}
function draftUrl(u){
  return /mDraftDetail|segments\\/0\\/leagues\\/\\d+/.test(String(u||""));
}
function hookNet(){
  if(window.__draftRoomEspnHooked) return;
  window.__draftRoomEspnHooked=1;
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
  if(!meta.leagueId){ badge(0,lastMeta||meta); return; }
  var q="/seasons/"+(meta.season||2026)+"/segments/0/leagues/"+meta.leagueId+"?view=mDraftDetail&view=mSettings&view=mTeam";
  var ctrl=typeof AbortController==="function"?new AbortController():null;
  var t=setTimeout(function(){try{ctrl&&ctrl.abort();}catch(e){}},8000);
  fetch(API+q,{credentials:"include",cache:"no-store",signal:ctrl?ctrl.signal:undefined}).then(function(r){
    clearTimeout(t);
    if(!r.ok) throw new Error("ESPN "+r.status);
    return r.json();
  }).then(ingestJson).catch(function(){
    clearTimeout(t);
    badge((lastSig&&Number(lastSig.split(":")[0]))||0,lastMeta||meta);
  });
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
