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
  warnings: string[];
  error?: string;
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const INJURY_SEVERITY: Record<Injury, number> = { watch: 1, questionable: 2, out: 3 };

const ESPN_INJURIES_URL = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/injuries";
const FP_NEWS_URL = "https://www.fantasypros.com/nfl/player-news.php";
const FP_INJURED_URL = "https://www.fantasypros.com/nfl/injured-players.php";

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

function worseInjury(a: Injury | undefined, b: Injury | undefined): Injury | undefined {
  if (!a) return b;
  if (!b) return a;
  return INJURY_SEVERITY[b] > INJURY_SEVERITY[a] ? b : a;
}

function slugToName(slug: string) {
  return slug.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

/** Map a source status + optional note onto Out / Q / Watch. */
export function classifyInjury(
  status: string,
  comment = "",
  hasInjuryDetails = false,
): Injury | null {
  const s = status.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const c = comment.toLowerCase();
  const blob = `${s} ${c}`;

  const commentOut =
    /\binjured reserve\b/.test(c) ||
    /\breserve\/pup\b/.test(c) ||
    /\bpup list\b/.test(c) ||
    /\bout for (the )?season\b/.test(c) ||
    /\bseason[- ]ending\b/.test(c) ||
    /\bout for (at least )?\d/.test(c) ||
    /\bwill miss (at least )?\d/.test(c) ||
    /\bplaced on (the )?(ir|injured reserve|pup)\b/.test(c) ||
    (/\bdesignation to return\b/.test(c) && /\b(ir|pup|injured reserve)\b/.test(c));

  if (
    s === "out" ||
    s === "o" ||
    s === "injured reserve" ||
    s === "injury reserve" ||
    s === "injury_reserve" ||
    s === "ir" ||
    s === "ir r" ||
    s === "suspension" ||
    s === "suspended" ||
    s === "doubtful" ||
    s === "d" ||
    s === "nfi" ||
    /\bpup\b/.test(s) ||
    commentOut
  ) {
    return "out";
  }

  if (
    s === "questionable" ||
    s === "q" ||
    /\bquestionable\b/.test(blob) ||
    /\bgame[- ]time decision\b/.test(blob)
  ) {
    return "questionable";
  }

  if (s === "active" || s === "healthy" || s === "a" || s === "normal") {
    if (
      hasInjuryDetails ||
      /\b(limited|dnp|did not practice|misses practice|day to day|injury)\b/.test(c)
    ) {
      return "watch";
    }
    return null;
  }

  if (/\b(watch|day to day|limited|dnp|misses practice|probable)\b/.test(blob)) return "watch";
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

export function parseFantasyProsInjuryHtml(html: string): InjuryHit[] {
  const hits: InjuryHit[] = [];
  const ecr = html.match(/var ecrData\s*=\s*(\{[\s\S]*?\});/);
  if (ecr) {
    try {
      for (const p of parseFantasyProsEcr(html).players) {
        if (p.injury) hits.push({ name: p.name, pos: p.pos, team: p.team, injury: p.injury });
      }
    } catch {
      /* rankings page without usable ecr injury fields */
    }
  }

  const rowRe =
    /href="\/nfl\/players\/([^"/]+)\.php"[^>]*>\s*([^<]+)<[\s\S]{0,900}?(?:injury|status|IR|Out|Questionable|Doubtful|PUP)[\s\S]{0,200}/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const snippet = row[0];
    const statusBits = snippet.match(
      /\b(Out|Questionable|Doubtful|IR(?:-R)?|PUP(?:-R)?|NFI|SUS|Suspended|Watch|Day-to-Day|DTD)\b/gi,
    );
    const injury = classifyInjury(statusBits?.join(" ") ?? snippet.replace(/<[^>]+>/g, " "));
    if (!injury) continue;
    const fromSlug = slugToName(row[1]);
    const fromText = row[2].replace(/\s+/g, " ").trim();
    hits.push({ name: fromText || fromSlug, injury });
  }

  const newsRe =
    /href="\/nfl\/players\/([^"/]+)\.php"[\s\S]{0,1200}?player-news-header[\s\S]{0,400}?<a href="\/nfl\/news\/[^"]+"[^>]*>([^<]+)/gi;
  let news: RegExpExecArray | null;
  while ((news = newsRe.exec(html))) {
    const title = news[2].replace(/\s+/g, " ").trim();
    const injury = classifyInjury(title, title, /\([^)]+\)/.test(title));
    if (!injury) continue;
    hits.push({ name: slugToName(news[1]), injury });
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
    const badge = extra.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const text = `${labeled} ${badge}`.trim();
    if (!text) continue;
    // Seasonal injury_prob % is not a current designation — skip those cells.
    if (/^\d+%$/.test(text) || /injury_prob/.test(chunk) && !badge && !labeled) continue;
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
      date?: string;
      shortComment?: string;
      longComment?: string;
      type?: { description?: string; abbreviation?: string; name?: string };
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
      const injury = classifyInjury(status, comment, Boolean(details?.type));
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

function absorbHits(into: Map<string, Injury>, hits: InjuryHit[]) {
  let total = 0;
  for (const hit of hits) {
    total += 1;
    const id = idFor(hit.name, hit.pos, hit.team);
    if (!id) continue;
    const next = worseInjury(into.get(id), hit.injury);
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

  const fpJob = fetchText(fpUrl(scoring)).then((html) => ({
    ecr: parseFantasyProsEcr(html),
    injuries: parseFantasyProsInjuryHtml(html),
  }));
  const fpNewsJob = fetchText(FP_NEWS_URL).then(parseFantasyProsInjuryHtml);
  const fpInjuredJob = fetchText(FP_INJURED_URL).then(parseFantasyProsInjuryHtml);
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

  const [fpRes, fpNewsRes, fpInjuredRes, dsRes, espnRes] = await Promise.allSettled([
    fpJob,
    fpNewsJob,
    fpInjuredJob,
    dsJob,
    espnJob,
  ]);

  if (fpRes.status === "fulfilled") {
    fpUpdated = fpRes.value.ecr.updated;
    fpTotal = fpRes.value.ecr.players.length;
    for (const p of fpRes.value.ecr.players) {
      const id = idFor(p.name, p.pos, p.team);
      if (!id) continue;
      const cur = patches.get(id) ?? {};
      cur.fpRank = p.rank;
      patches.set(id, cur);
      fpMatched += 1;
    }
    injuryTotal += absorbHits(injuries, fpRes.value.injuries);
  } else {
    warnings.push(`FantasyPros: ${fpRes.reason instanceof Error ? fpRes.reason.message : "failed"}`);
  }

  if (fpNewsRes.status === "fulfilled") {
    injuryTotal += absorbHits(injuries, fpNewsRes.value);
  }

  if (fpInjuredRes.status === "fulfilled") {
    injuryTotal += absorbHits(injuries, fpInjuredRes.value);
  }

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
    injuryTotal += absorbHits(injuries, dsRes.value.injuries);
  } else {
    warnings.push(`DraftSharks: ${dsRes.reason instanceof Error ? dsRes.reason.message : "failed"}`);
  }

  if (espnRes.status === "fulfilled") {
    injuryTotal += absorbHits(injuries, espnRes.value);
  } else {
    warnings.push(`ESPN injuries: ${espnRes.reason instanceof Error ? espnRes.reason.message : "failed"}`);
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

/** When `live` is true, overlay replaces snapshot flags (missing id = healthy). */
export function applyInjuryOverlay(
  players: Player[],
  injuries: Record<string, Injury> | undefined,
  live?: boolean,
) {
  if (!live || !injuries) return players;
  return players.map((p) => {
    const inj = injuries[p.id];
    if (inj) return p.injury === inj ? p : { ...p, injury: inj };
    if (!p.injury) return p;
    return { ...p, injury: undefined };
  });
}

export function scoringLabel(scoring: Scoring) {
  if (scoring === "ppr") return "PPR";
  if (scoring === "half") return "Half PPR";
  return "Standard";
}
