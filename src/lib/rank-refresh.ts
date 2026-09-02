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
const FP_INJURY_PAGES = 7;

function fpUrl(scoring: Scoring) {
  if (scoring === "ppr") return "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php";
  if (scoring === "half") {
    return "https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php";
  }
  return "https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php";
}

function fpInjuryNewsUrl(page: number) {
  if (page <= 1) return "https://www.fantasypros.com/nfl/injury-news.php";
  return `https://www.fantasypros.com/nfl/injury-news.php?page=${page}`;
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

/**
 * Map a source status + optional note onto Out / Q / Watch.
 * `null` means healthy / clear; `undefined` is unused so callers can treat
 * a missing structured field as "no info".
 */
export function classifyInjury(status: string, comment = ""): Injury | null {
  const s = status.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const c = comment.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const blob = `${s} ${c}`.trim();
  if (!blob) return null;

  const outish =
    /^(out|o|ir|ir r|injured reserve|injury reserve|pup|nfi|sus|susp|suspended|suspension|inactive)$/.test(
      s,
    ) ||
    /\binjured reserve\b/.test(blob) ||
    /\breserve\/(?:injured|ir|pup|nfi)\b/.test(blob) ||
    /\bpup list\b/.test(blob) ||
    /\bphysically unable to perform\b/.test(blob) ||
    /\bnon-football injury\b/.test(blob) ||
    /\bout for (the )?season\b/.test(blob) ||
    /\bseason[- ]ending\b/.test(blob) ||
    /\brule[ds] out\b/.test(blob) ||
    /\bwill miss at least\b/.test(blob) ||
    /\bplaced (?:on|in) (?:the )?(?:ir|injured reserve|pup|nfi)\b/.test(blob) ||
    /\b\((?:ir|pup|nfi|sus|out|o)\)\b/.test(blob) ||
    /\bsuspended\b/.test(blob) ||
    /\binactive\b/.test(blob);

  if (outish) return "out";

  const qish =
    /^(questionable|q|doubtful|d)$/.test(s) ||
    /\bquestionable\b/.test(blob) ||
    /\bdoubtful\b/.test(blob) ||
    /\bgame[- ]time decision\b/.test(blob) ||
    /\buncertain for\b/.test(blob) ||
    /\bup in (the )?air\b/.test(blob) ||
    /\bstatus in question\b/.test(blob) ||
    /\b\((?:q|d)\)\b/.test(blob);

  if (qish) return "questionable";

  if (
    /^(active|healthy|a|normal|ok)$/.test(s) &&
    !/\b(limited|dnp|did not practice|misses practice|day to day|week to week)\b/.test(c)
  ) {
    return null;
  }

  if (
    /^(watch|dtd|probable|p)$/.test(s) ||
    /\b(watch|day to day|week to week|dtd|limited|dnp|did not practice|misses practice|missed practice|not seen at practice|not seen practicing|probable|expected to play|expects to play|could miss|positive update|returns to practice|non-contact)\b/.test(
      blob,
    ) ||
    /\bpractices?\b/.test(blob) ||
    /\((?:knee|ankle|hamstring|groin|toe|foot|shoulder|back|quad|calf|wrist|hand|elbow|hip|ribs?|neck|concussion|undisclosed|mcl|acl|pec)[^)]*\)/.test(
      blob,
    )
  ) {
    return "watch";
  }

  return null;
}

type InjuryHit = { name: string; pos?: string; team?: string; injury: Injury };

function ecrInjuryFields(p: Record<string, unknown>): string {
  const keys = [
    "injury",
    "injury_status",
    "player_injury",
    "player_injury_status",
    "injuryStatus",
    "player_status",
    "tag",
    "news",
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
    const chunk = part.slice(0, 5000);
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
    const impact = chunk.match(/Fantasy Impact:<\/em><\/b>\s*([\s\S]*?)<\/p>/i)?.[1] ?? "";
    const body = decodeHtml(impact);
    const injury = classifyInjury(title, body);
    if (!injury) continue;
    const name = decodeHtml(alt || "") || (slug ? slugToName(slug) : "");
    if (!name || name.includes("More News")) continue;
    hits.push({
      name,
      pos: posTeam?.[1],
      team: posTeam?.[2],
      injury,
    });
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
    if (!name || !Number.isFinite(rank)) continue;
    out.push({ name, rank, pos: m[1] });
  }
  return out;
}

export function parseDraftSharksInjuries(html: string): InjuryHit[] {
  const hits: InjuryHit[] = [];
  const re =
    /data-fantasy-position="([^"]+)"[\s\S]{0,400}?data-player-name="([^"]+)"[\s\S]{0,3500}?(?=data-fantasy-position="|data-player-name="|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const chunk = m[0];
    const extra =
      chunk.match(/player-details-group__extra-container[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const labeled = [
      ...chunk.matchAll(/data-(?:injury|injury-status|status|player-status)="([^"]+)"/gi),
    ]
      .map((x) => x[1])
      .join(" ");
    const paren = chunk.match(/\((IR|PUP|NFI|SUS|OUT|DTD|Q|D|O)\)/i)?.[1] ?? "";
    const badge = decodeHtml(extra);
    const text = `${labeled} ${badge} ${paren}`.trim();
    if (!text) continue;
    if (/injury_prob/.test(chunk) && !badge && !labeled && !paren) continue;
    const injury = classifyInjury(text);
    if (!injury) continue;
    hits.push({ name: m[2].replace(/\s+/g, " ").trim(), pos: m[1], injury });
  }
  return hits;
}

type EspnInjuryJson = {
  injuries?: Array<{
    id?: string;
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
      const status =
        inj.status ||
        details?.fantasyStatus?.description ||
        inj.type?.description ||
        inj.type?.abbreviation ||
        "";
      const comment = [inj.shortComment, inj.longComment].filter(Boolean).join(" ");
      const injury = classifyInjury(status, comment);
      if (!injury) continue;
      hits.push({
        name,
        pos: inj.athlete?.position?.abbreviation,
        team: inj.athlete?.team?.abbreviation || team.displayName,
        injury,
      });
    }
  }
  return hits;
}

function absorbHits(
  into: Map<string, Injury>,
  hits: InjuryHit[],
  mode: "worse" | "first" | "overwrite",
) {
  let total = 0;
  for (const hit of hits) {
    total += 1;
    const id = idFor(hit.name, hit.pos, hit.team);
    if (!id) continue;
    if (mode === "first" && into.has(id)) continue;
    const next = mode === "overwrite" ? hit.injury : worseInjury(into.get(id), hit.injury);
    if (next) into.set(id, next);
  }
  return total;
}

export async function refreshLiveRankings(scoring: Scoring): Promise<RankRefreshResult> {
  const warnings: string[] = [];
  const patches = new Map<string, RankPatch>();
  const injuries = new Map<string, Injury>();
  let fpUpdated: string | undefined;
  let fpTotal = 0;
  let dsTotal = 0;
  let fpMatched = 0;
  let dsMatched = 0;
  let injuryTotal = 0;
  let injuriesComplete = false;

  const fpJob = fetchText(fpUrl(scoring)).then(parseFantasyProsEcr);
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

  const [fpRes, dsRes, espnRes, ...injRes] = await Promise.allSettled([
    fpJob,
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
      cur.fpRank = p.rank;
      patches.set(id, cur);
      fpMatched += 1;
    }
    injuryTotal += absorbHits(
      injuries,
      fpRes.value.players
        .filter((p) => p.injury)
        .map((p) => ({ name: p.name, pos: p.pos, team: p.team, injury: p.injury! })),
      "first",
    );
  } else {
    warnings.push(`FantasyPros: ${fpRes.reason instanceof Error ? fpRes.reason.message : "failed"}`);
  }

  const newsItems: InjuryHit[] = [];
  const seenTitles = new Set<string>();
  let injPagesOk = 0;
  for (const res of injRes) {
    if (res.status !== "fulfilled") {
      warnings.push(
        `FantasyPros injuries: ${res.reason instanceof Error ? res.reason.message : "failed"}`,
      );
      continue;
    }
    injPagesOk += 1;
    for (const hit of res.value) {
      const key = `${hit.name}|${hit.injury}`;
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      newsItems.push(hit);
    }
  }
  injuryTotal += absorbHits(injuries, newsItems, "first");

  if (dsRes.status === "fulfilled") {
    dsTotal = dsRes.value.ranks.length;
    for (const p of dsRes.value.ranks) {
      const id = idFor(p.name, p.pos);
      if (!id) continue;
      const cur = patches.get(id) ?? {};
      cur.dsRank = p.rank;
      patches.set(id, cur);
      dsMatched += 1;
    }
    injuryTotal += absorbHits(injuries, dsRes.value.injuries, "worse");
  } else {
    warnings.push(`DraftSharks: ${dsRes.reason instanceof Error ? dsRes.reason.message : "failed"}`);
  }

  if (espnRes.status === "fulfilled") {
    injuryTotal += absorbHits(injuries, espnRes.value, "overwrite");
    injuriesComplete = espnRes.value.length > 0;
  } else {
    warnings.push(
      `ESPN injuries: ${espnRes.reason instanceof Error ? espnRes.reason.message : "failed"}`,
    );
  }

  if (injPagesOk === 0 && injRes.length > 0 && !injuriesComplete) {
    warnings.push("FantasyPros injury news could not be loaded.");
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
