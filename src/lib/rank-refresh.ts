import { matchByName, matchOurPlayer } from "./espn";
import type { Injury, Player, Position, Scoring } from "./types";

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
  injuries: Record<string, Injury>;
  injuryMatched: number;
  injuryTotal: number;
  injuriesLive: boolean;
  injuriesComplete: boolean;
  warnings: string[];
  error?: string;
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const INJURY_SEVERITY: Record<Injury, number> = { watch: 1, questionable: 2, out: 3 };

const ESPN_INJURIES_URL = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/injuries";
const FP_NEWS_URL = "https://www.fantasypros.com/nfl/player-news.php";
const FP_INJURY_PAGES = 7;

function fpInjuryNewsUrl(page: number) {
  if (page <= 1) return "https://www.fantasypros.com/nfl/injury-news.php";
  return `https://www.fantasypros.com/nfl/injury-news.php?page=${page}`;
}

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

function isSkillPos(raw?: string): boolean {
  if (!raw) return false;
  const p = raw.toUpperCase().replace(/[^A-Z]/g, "");
  return p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K" || p === "DST" || p === "DEF" || p === "D";
}

function idFor(name: string, pos?: string, team?: string): string | null {
  if (pos && isSkillPos(pos) && team && team !== "FA") {
    const matched = matchOurPlayer(name, posOf(pos), team);
    if (matched) return matched;
  }
  return matchByName(name)?.id ?? null;
}

function idForInjury(name: string): string | null {
  // Full-name match only. Last-name fallback would map Jayden Higgins → Tee Higgins.
  return matchByName(name)?.id ?? null;
}

function worseInjury(a: Injury | undefined, b: Injury | undefined): Injury | undefined {
  if (!a) return b;
  if (!b) return a;
  return INJURY_SEVERITY[b] > INJURY_SEVERITY[a] ? b : a;
}

function decodeHtml(raw: string) {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugToName(slug: string) {
  return slug.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function lastToken(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function commentAboutPlayer(name: string, comment: string) {
  const c = comment.trim().toLowerCase();
  if (!c) return false;
  const last = lastToken(name);
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return Boolean(last && (c.startsWith(last) || c.startsWith(first) || c.includes(`${first} ${last}`)));
}

/**
 * Map a compact status label (not a free-form news blurb) onto Out / Q / Watch.
 * Long ESPN recaps mention other players' IR stints — do not pass those here.
 */
export function classifyInjury(status: string, note = ""): Injury | null {
  const s = status.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const n = note.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s && !n) return null;

  if (
    /^(out|o|ir|ir r|injured reserve|injury reserve|pup|pup r|nfi|sus|susp|suspended|suspension|inactive|reserve cel)$/.test(
      s,
    )
  ) {
    return "out";
  }
  if (/^(questionable|q|doubtful|d)$/.test(s)) return "questionable";
  if (/^(watch|dtd|day to day|probable|p|limited)$/.test(s)) return "watch";
  if (/^(active|healthy|a|normal|ok)$/.test(s)) return null;

  const blob = `${s} ${n}`.trim();
  if (
    /\binjured reserve\b/.test(blob) ||
    /\breserve\/(?:pup|ir)\b/.test(blob) ||
    /\bpup list\b/.test(blob) ||
    /\bout for (the )?season\b/.test(blob) ||
    /\bseason[- ]ending\b/.test(blob) ||
    /\bplaced (?:on|in) (?:the )?(?:ir|injured reserve|pup)\b/.test(blob)
  ) {
    return "out";
  }
  if (
    /\bquestionable\b/.test(blob) ||
    /\bdoubtful\b/.test(blob) ||
    /\bgame[- ]time decision\b/.test(blob) ||
    /\buncertain for\b/.test(blob) ||
    /\bup in (the )?air\b/.test(blob)
  ) {
    return "questionable";
  }
  if (
    /\b(misses practice|missed practice|not seen at practice|did not practice|\bdnp\b|day to day|week to week|positive update|expected to play|expects to play|could miss)\b/.test(
      blob,
    )
  ) {
    return "watch";
  }
  return null;
}

function classifyEspnStatus(
  status: string,
  fantasyAbbr: string,
  hasDetails: boolean,
  shortComment: string,
  name: string,
): Injury | null {
  let injury = classifyInjury(status) ?? classifyInjury(fantasyAbbr);
  if (!injury && hasDetails && !/^(active|a|healthy|normal)$/i.test(status.trim())) {
    injury = "watch";
  }

  // Only upgrade a milder official tag when the player's own note says IR/PUP.
  if (injury !== "out" && commentAboutPlayer(name, shortComment)) {
    const c = shortComment.toLowerCase();
    if (
      /\bout for at least\b/.test(c) ||
      /\bwill miss at least\b/.test(c) ||
      /\bplaced on (the )?(injured reserve|ir|pup)\b/.test(c) ||
      /\breserve\/pup\b/.test(c) ||
      (/\binjured reserve\b/.test(c) && /\bplaced\b/.test(c))
    ) {
      injury = "out";
    }
  }
  return injury;
}

type InjuryHit = { name: string; pos?: string; team?: string; injury: Injury | null; seen?: boolean };

function ecrInjuryFields(p: Record<string, unknown>): string {
  const keys = [
    "injury",
    "injury_status",
    "player_injury",
    "player_injury_status",
    "injuryStatus",
    "player_status",
    "injury_status_id",
  ];
  return keys
    .map((k) => p[k])
    .filter((v) => v != null && v !== "" && typeof v !== "object")
    .map((v) => String(v))
    .join(" ");
}

export function parseFantasyProsEcr(html: string): {
  players: Array<{ name: string; rank: number; team: string; pos: string; injury?: Injury }>;
  updated?: string;
} {
  const m = html.match(/var ecrData\s*=\s*(\{[\s\S]*?\});/);
  if (!m) throw new Error("FantasyPros page did not include ecrData.");
  const data = JSON.parse(m[1]) as {
    last_updated?: string;
    players?: Array<Record<string, unknown>>;
  };
  const players = (data.players ?? [])
    .map((p) => {
      const name = String(p.player_name ?? "");
      const rank = Number(p.rank_ecr);
      const team = String(p.player_team_id ?? "FA");
      const pos = String(p.player_position_id ?? "");
      const injury = classifyInjury(ecrInjuryFields(p));
      return { name, rank, team, pos, ...(injury ? { injury } : {}) };
    })
    .filter((p) => p.name && Number.isFinite(p.rank) && p.rank > 0);
  return { players, updated: data.last_updated };
}

export function parseFantasyProsInjuryNews(html: string): InjuryHit[] {
  const hits: InjuryHit[] = [];
  const parts = html.split(/class="player-news-item"/).slice(1);
  const seen = new Set<string>();
  for (const part of parts) {
    const chunk = part.slice(0, 4000);
    const slug = chunk.match(/\/nfl\/players\/([^"/]+)\.php/)?.[1];
    const alt = chunk.match(/alt="([^"]+)"/)?.[1];
    const posTeam = chunk.match(/>([A-Z]{1,3})\s*-\s*([A-Z]{2,3})</);
    const titleRaw =
      chunk.match(/href="\/nfl\/news\/\d+\/[^"]+"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
    const title = decodeHtml(titleRaw);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Titles like "works out for" / "practice squad" are transactions, not designations.
    if (/\b(works out|workout|practice squad|signs with|released by|waived)\b/i.test(title)) continue;
    const injury = classifyInjury(title);
    if (!injury) continue;
    const name = decodeHtml(alt || "") || (slug ? slugToName(slug) : "");
    if (!name || /more news/i.test(name)) continue;
    hits.push({ name, pos: posTeam?.[1], team: posTeam?.[2], injury });
  }
  return hits;
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
    if (!name || !Number.isFinite(rank) || rank <= 0) continue;
    out.push({ name, rank, pos: m[1] });
  }
  return out;
}

export function parseDraftSharksInjuries(html: string): InjuryHit[] {
  const hits: InjuryHit[] = [];
  const re =
    /data-fantasy-position="([^"]+)"[\s\S]{0,400}?data-player-name="([^"]+)"[\s\S]{0,2500}?(?=data-fantasy-position="|data-player-name="|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const chunk = m[0];
    const extra =
      chunk.match(/player-details-group__extra-container[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const labeled = [
      ...chunk.matchAll(/data-(?:injury|injury-status|player-injury-status)="([^"]+)"/gi),
    ]
      .map((x) => x[1])
      .join(" ");
    const paren = chunk.match(/\((IR|PUP|NFI|SUS|OUT|DTD|Q|D|O)\)/i)?.[1] ?? "";
    const badge = decodeHtml(extra);
    const text = `${labeled} ${badge} ${paren}`.trim();
    if (!text) continue;
    const injury = classifyInjury(text);
    if (!injury) continue;
    hits.push({ name: m[2].replace(/\s+/g, " ").trim(), pos: m[1], injury });
  }
  return hits;
}

type EspnInjuryJson = {
  injuries?: Array<{
    displayName?: string;
    injuries?: Array<{
      status?: string;
      shortComment?: string;
      longComment?: string;
      type?: { description?: string; abbreviation?: string };
      details?: {
        type?: string;
        fantasyStatus?: { description?: string; abbreviation?: string };
      } | null;
      athlete?: {
        displayName?: string;
        position?: { abbreviation?: string };
        team?: { abbreviation?: string };
      };
    }>;
  }>;
};

export function parseEspnInjuries(raw: unknown): InjuryHit[] {
  const data = raw as EspnInjuryJson;
  const hits: InjuryHit[] = [];
  for (const team of data.injuries ?? []) {
    for (const inj of team.injuries ?? []) {
      const name = inj.athlete?.displayName?.trim();
      if (!name) continue;
      const details = inj.details;
      const status = inj.status || inj.type?.description || inj.type?.abbreviation || "";
      const fantasy = details?.fantasyStatus?.abbreviation || details?.fantasyStatus?.description || "";
      const injury = classifyEspnStatus(
        status,
        fantasy,
        Boolean(details?.type),
        inj.shortComment ?? "",
        name,
      );
      hits.push({
        name,
        pos: inj.athlete?.position?.abbreviation,
        team: inj.athlete?.team?.abbreviation,
        injury,
        seen: true,
      });
    }
  }
  return hits;
}

function absorbHits(
  into: Map<string, Injury>,
  hits: InjuryHit[],
  seen: Set<string>,
  opts: { skipSeen?: boolean; overwrite?: boolean },
) {
  let total = 0;
  for (const hit of hits) {
    total += 1;
    const id = idForInjury(hit.name);
    if (!id) continue;
    if (hit.seen) seen.add(id);
    if (opts.skipSeen && seen.has(id) && !hit.seen) continue;
    if (hit.injury == null) {
      if (opts.overwrite) into.delete(id);
      continue;
    }
    if (opts.overwrite) {
      into.set(id, hit.injury);
      continue;
    }
    const next = worseInjury(into.get(id), hit.injury);
    if (next) into.set(id, next);
  }
  return total;
}

export async function refreshLiveRankings(scoring: Scoring): Promise<RankRefreshResult> {
  const warnings: string[] = [];
  const patches = new Map<string, RankPatch>();
  const injuries = new Map<string, Injury>();
  const espnSeen = new Set<string>();
  let fpUpdated: string | undefined;
  let fpTotal = 0;
  let dsTotal = 0;
  let fpMatched = 0;
  let dsMatched = 0;
  let injuryTotal = 0;
  let injuriesComplete = false;

  const fpJob = fetchText(fpUrl(scoring)).then(parseFantasyProsEcr);
  const fpNewsJob = fetchText(FP_NEWS_URL).then(parseFantasyProsInjuryNews);
  const injJobs = Array.from({ length: FP_INJURY_PAGES }, (_, i) =>
    fetchText(fpInjuryNewsUrl(i + 1)).then(parseFantasyProsInjuryNews),
  );
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
  }).then((html) => ({
    ranks: parseDraftSharksTable(html),
    injuries: parseDraftSharksInjuries(html),
  }));
  const espnJob = fetchText(ESPN_INJURIES_URL).then((text) => parseEspnInjuries(JSON.parse(text)));

  const [fpRes, fpNewsRes, dsRes, espnRes, ...injRes] = await Promise.allSettled([
    fpJob,
    fpNewsJob,
    dsJob,
    espnJob,
    ...injJobs,
  ]);

  if (fpRes.status === "fulfilled") {
    fpUpdated = fpRes.value.updated;
    fpTotal = fpRes.value.players.length;
    for (const p of fpRes.value.players) {
      const id = idFor(p.name, p.pos, p.team);
      if (!id) continue;
      const cur = patches.get(id) ?? {};
      if (p.rank > 0) {
        cur.fpRank = p.rank;
        patches.set(id, cur);
        fpMatched += 1;
      }
    }
    injuryTotal += absorbHits(
      injuries,
      fpRes.value.players
        .filter((p) => p.injury)
        .map((p) => ({ name: p.name, pos: p.pos, team: p.team, injury: p.injury! })),
      espnSeen,
      {},
    );
  } else {
    warnings.push(`FantasyPros: ${fpRes.reason instanceof Error ? fpRes.reason.message : "failed"}`);
  }

  for (const res of [fpNewsRes, ...injRes]) {
    if (res.status === "fulfilled") {
      injuryTotal += absorbHits(injuries, res.value, espnSeen, {});
    }
  }

  if (dsRes.status === "fulfilled") {
    dsTotal = dsRes.value.ranks.length;
    for (const p of dsRes.value.ranks) {
      const id = idFor(p.name, p.pos);
      if (!id) continue;
      const cur = patches.get(id) ?? {};
      if (p.rank > 0) {
        cur.dsRank = p.rank;
        patches.set(id, cur);
        dsMatched += 1;
      }
    }
    injuryTotal += absorbHits(injuries, dsRes.value.injuries, espnSeen, {});
  } else {
    warnings.push(`DraftSharks: ${dsRes.reason instanceof Error ? dsRes.reason.message : "failed"}`);
  }

  if (espnRes.status === "fulfilled") {
    injuriesComplete = espnRes.value.length > 0;
    injuryTotal += absorbHits(injuries, espnRes.value, espnSeen, { overwrite: true });
  } else {
    warnings.push(
      `ESPN injuries: ${espnRes.reason instanceof Error ? espnRes.reason.message : "failed"}`,
    );
  }

  const injuryMatched = injuries.size;
  const injuriesLive = injuryMatched > 0;
  if (!injuriesLive) {
    warnings.push("Injuries: no current flags matched; snapshot injuries kept.");
  }

  const ranksOk = fpMatched > 0 || dsMatched > 0;
  if (!ranksOk && !injuriesLive) {
    return {
      ok: false,
      scoring,
      fetchedAt: Date.now(),
      fpMatched: 0,
      dsMatched: 0,
      fpTotal,
      dsTotal,
      patches: {},
      injuries: {},
      injuryMatched: 0,
      injuryTotal,
      injuriesLive: false,
      injuriesComplete: false,
      warnings,
      error: warnings.join(" · ") || "Could not refresh ranks or injuries.",
    };
  }

  if (!ranksOk) {
    warnings.push("Ranks failed; live injury flags applied on the snapshot board.");
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
    injuries: Object.fromEntries(injuries),
    injuryMatched,
    injuryTotal,
    injuriesLive,
    injuriesComplete,
    warnings,
  };
}

function keepRank(next: number | undefined, prev: number) {
  return typeof next === "number" && Number.isFinite(next) && next > 0 ? next : prev;
}

export function applyRankPatches(players: Player[], patches: Record<string, RankPatch> | undefined) {
  if (!patches || Object.keys(patches).length === 0) return players;
  return players.map((p) => {
    const u = patches[p.id];
    if (!u) return p;
    return {
      ...p,
      fpRank: keepRank(u.fpRank, p.fpRank),
      dsRank: keepRank(u.dsRank, p.dsRank),
      adp: keepRank(u.adp, p.adp),
    };
  });
}

/**
 * Overlay live injury flags. When `complete` is true (full ESPN report),
 * players missing from the map are treated as healthy. Otherwise unmatched
 * players keep their snapshot flag.
 */
export function applyInjuryOverlay(
  players: Player[],
  injuries: Record<string, Injury> | undefined,
  live?: boolean,
  complete?: boolean,
) {
  if (!live || !injuries) return players;
  return players.map((p) => {
    const inj = injuries[p.id];
    if (inj) return p.injury === inj ? p : { ...p, injury: inj };
    if (!complete) return p;
    if (!p.injury) return p;
    return { ...p, injury: undefined };
  });
}

export function scoringLabel(scoring: Scoring) {
  if (scoring === "ppr") return "PPR";
  if (scoring === "half") return "Half PPR";
  return "Standard";
}
