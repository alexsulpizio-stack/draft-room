"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardPaste,
  Loader2,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  Star,
  Undo2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BUILD_LABEL, buildTitle } from "@/lib/version";
import { PLAYERS, displayName } from "@/lib/players";
import {
  autoPickForTeam,
  compareBoard,
  formatBoardRank,
  formatPick,
  formatSourceRank,
  nextUserPick,
  pickOwner,
  picksUntilUser,
  recommendPicks,
  rosterFor,
  sourceGap,
  starterNeeds,
  userPickOveralls,
  type BoardSort,
} from "@/lib/draft";
import {
  applyLeagueRankUpdates,
  parseRankingPaste,
  updatesToPatches,
  type RankImportSource,
} from "@/lib/parse-import";
import {
  applyInjuryOverlay,
  applyRankPatches,
  LIVE_RANK_POLL_MS,
  MIN_REFRESH_INTERVAL_MS,
  scoringLabel,
  type RankPatch,
} from "@/lib/rank-refresh";
import type { DraftPick, DraftType, Injury, LeagueSettings, Player, Position } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { GapChip, InjuryDot, PlayerSubline, PosBadge } from "@/components/player-bits";
import { EspnSync, type EspnLiveStatus } from "@/components/espn-sync";
import { YahooSync } from "@/components/yahoo-sync";
import { RanksLiveSyncPanel } from "@/components/ranks-live-sync";
import { RelayPulse } from "@/components/relay-pulse";
import { isLeftoverAgentRankSnapshot } from "@/lib/leftover-tests";
import { matchByName, mergeBoardWithEspnExtras, pickLogDisplayName } from "@/lib/espn";

const STORAGE_KEY = "draft-room-jfl-28-jackal";

type LeagueSourceImport = {
  patches: Record<string, RankPatch>;
  matched: number;
  importedAt: number;
  label?: string;
  /** True when last update came from Sync FP/DS bookmarklet ingest. */
  live?: boolean;
};

type LeagueRanks = {
  fp?: LeagueSourceImport;
  ds?: LeagueSourceImport;
};

function SortTh({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  column: BoardSort;
  sortKey: BoardSort;
  sortDir: "asc" | "desc";
  onSort: (key: BoardSort) => void;
  className?: string;
}) {
  const active = sortKey === column;
  return (
    <th className={cn("px-2 py-2 font-medium", className)} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-0.5 rounded-sm uppercase tracking-wide hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )
        ) : (
          <span className="inline-block size-3" />
        )}
      </button>
    </th>
  );
}

type RankOverlay = {
  patches: Record<string, RankPatch>;
  fetchedAt: number;
  scoring: string;
  fpMatched: number;
  dsMatched: number;
  fpUpdated?: string;
  injuries?: Record<string, Injury>;
  injuryMatched?: number;
  injuriesLive?: boolean;
  injuriesComplete?: boolean;
  lastAttemptAt?: number;
  lastError?: string;
  lastSource?: "manual" | "pick" | "poll";
  cached?: boolean;
  ranksOnly?: boolean;
};

type RefreshReason = "manual" | "pick" | "poll";

type Persisted = {
  settings: LeagueSettings;
  picks: DraftPick[];
  stars: string[];
  avoids: string[];
  extras?: Player[];
  importText?: string;
  rankOverlay?: RankOverlay;
  /** League-adjusted FP/DS overlays (CSV/paste). Win over generic ECR refresh. */
  leagueRanks?: LeagueRanks;
};

const EMPTY: Persisted = {
  settings: DEFAULT_SETTINGS,
  picks: [],
  stars: [],
  avoids: [],
  extras: [],
  leagueRanks: {},
};

function readRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? JSON.stringify(EMPTY);
  } catch {
    return JSON.stringify(EMPTY);
  }
}

function subscribe(cb: () => void) {
  const onChange = () => cb();
  window.addEventListener("storage", onChange);
  window.addEventListener("draft-room", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("draft-room", onChange);
  };
}

function writeStore(next: Persisted) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("draft-room"));
}

/** Snapshot `player.id` is unique. ESPN stubs used to share `espn--1` when espnId was missing. */
function playerListKey(player: Player, index?: number) {
  if (!/^espn-(0|-\d+)$/.test(player.id)) return player.id;
  return [player.id, player.name, player.team, player.pos, index ?? ""].join(":");
}

function stripLeftoverLeagueRanks(ranks: LeagueRanks): LeagueRanks {
  const next: LeagueRanks = {};
  if (
    ranks.fp &&
    !isLeftoverAgentRankSnapshot({
      matched: ranks.fp.matched,
      ts: ranks.fp.importedAt,
      patches: ranks.fp.patches,
    })
  ) {
    next.fp = ranks.fp;
  }
  if (
    ranks.ds &&
    !isLeftoverAgentRankSnapshot({
      matched: ranks.ds.matched,
      ts: ranks.ds.importedAt,
      patches: ranks.ds.patches,
    })
  ) {
    next.ds = ranks.ds;
  }
  return next;
}

function posFilterList(settings: LeagueSettings): Array<Position | "ALL"> {
  const list: Array<Position | "ALL"> = ["ALL", "QB", "RB", "WR", "TE"];
  if (settings.roster.k > 0) list.push("K");
  if (settings.roster.dst > 0) list.push("DST");
  return list;
}

export function DraftApp() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => JSON.stringify(EMPTY));
  const data: Persisted = useMemo(() => {
    try {
      const parsed = JSON.parse(raw) as Persisted;
      return {
        ...EMPTY,
        ...parsed,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(parsed.settings ?? {}),
          roster: { ...DEFAULT_SETTINGS.roster, ...(parsed.settings?.roster ?? {}) },
          teamNames: parsed.settings?.teamNames?.length
            ? parsed.settings.teamNames
            : DEFAULT_SETTINGS.teamNames,
          draftType: parsed.settings?.draftType ?? "snake",
        },
        extras: parsed.extras ?? [],
        leagueRanks: stripLeftoverLeagueRanks(parsed.leagueRanks ?? {}),
      };
    } catch {
      return EMPTY;
    }
  }, [raw]);
  const settings = data.settings ?? DEFAULT_SETTINGS;
  const picks = data.picks ?? EMPTY.picks;
  const stars = data.stars ?? EMPTY.stars;
  const extras = useMemo(() => data.extras ?? [], [data.extras]);
  const rankOverlay = data.rankOverlay;
  const leagueRanks = data.leagueRanks ?? {};
  const dataRef = useRef(data);
  dataRef.current = data;

  const setSettings = useCallback((next: LeagueSettings) => {
    writeStore({ ...dataRef.current, settings: next });
  }, []);
  const setPicks = useCallback((next: DraftPick[] | ((prev: DraftPick[]) => DraftPick[])) => {
    const cur = dataRef.current;
    const picksNext = typeof next === "function" ? next(cur.picks ?? EMPTY.picks) : next;
    writeStore({ ...cur, picks: picksNext });
  }, []);
  const setStars = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    const cur = dataRef.current;
    const starsNext = typeof next === "function" ? next(cur.stars ?? EMPTY.stars) : next;
    writeStore({ ...cur, stars: starsNext });
  }, []);
  /** Always merge from dataRef so ESPN listens cannot clobber a concurrent FP/DS overlay write. */
  const applyEspnPicks = useCallback(
    (nextPicks: DraftPick[], extraPlayers: Player[], settingsPatch?: LeagueSettings) => {
      const cur = dataRef.current;
      writeStore({
        ...cur,
        picks: nextPicks,
        extras: extraPlayers,
        settings: settingsPatch ?? cur.settings,
      });
    },
    [],
  );

  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [showTaken, setShowTaken] = useState(false);
  const [sortKey, setSortKey] = useState<BoardSort>("blend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importSource, setImportSource] = useState<RankImportSource>("fp");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [espn, setEspn] = useState<EspnLiveStatus>({ live: false, source: "empty", pickCount: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [autoRanks, setAutoRanks] = useState(true);
  /** Hide the mid-draft league re-import banner until the next round boundary. */
  const [leagueNudgeMutedUntilPick, setLeagueNudgeMutedUntilPick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshingRef = useRef(false);
  const lastAutoPickCount = useRef(-1);
  const lastLeagueNudgeRound = useRef(-1);
  const leagueRanksRef = useRef(leagueRanks);
  leagueRanksRef.current = leagueRanks;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const openLeagueImport = useCallback((source: RankImportSource = "fp") => {
    setImportSource(source);
    setImportOpen(true);
    setImportMsg(
      source === "ds"
        ? "This chip only opens help. Copy Sync DS ranks and click that BOOKMARK on draftsharks.com — not here."
        : "This chip only opens help. Copy Sync FP ranks and click that BOOKMARK on fantasypros.com — not here.",
    );
  }, []);

  const board = useMemo(() => {
    const refreshed = applyRankPatches(PLAYERS, rankOverlay?.patches);
    const withLeague = applyLeagueRankUpdates(
      applyLeagueRankUpdates(refreshed, leagueRanks.fp?.patches),
      leagueRanks.ds?.patches,
    );
    const ranked = applyInjuryOverlay(
      withLeague,
      rankOverlay?.injuries,
      rankOverlay?.injuriesLive,
      rankOverlay?.injuriesComplete,
    );
    return mergeBoardWithEspnExtras(ranked, extras);
  }, [extras, rankOverlay, leagueRanks]);

  const leagueStatus = useMemo(() => {
    const parts: string[] = [];
    if (leagueRanks.fp?.matched) {
      parts.push(
        `FP league ${leagueRanks.fp.matched}${leagueRanks.fp.live ? " live" : ""}`,
      );
    }
    if (leagueRanks.ds?.matched) {
      parts.push(
        `DS league ${leagueRanks.ds.matched}${leagueRanks.ds.live ? " live" : ""}`,
      );
    }
    return parts;
  }, [leagueRanks]);
  const hasLeagueImport = Boolean(leagueRanks.fp?.matched || leagueRanks.ds?.matched);
  const hasLiveLeagueSync = Boolean(leagueRanks.fp?.live || leagueRanks.ds?.live);
  const lastLiveFpTs = useRef(0);
  const lastLiveDsTs = useRef(0);
  const byId = useMemo(() => new Map(board.map((p) => [p.id, p])), [board]);
  const overall = picks.length + 1;
  const totalPicks = settings.teams * settings.rounds;
  const done = picks.length >= totalPicks;
  /** Reminder each completed round while ESPN is live and league imports are pinned. */
  const draftRound = Math.floor(espn.pickCount / Math.max(1, settings.teams));
  const showLeagueReimportNudge =
    espn.live &&
    !done &&
    hasLeagueImport &&
    draftRound >= 1 &&
    espn.pickCount >= leagueNudgeMutedUntilPick;
  const onClock = done ? null : pickOwner(overall, settings.teams, settings.draftType ?? "snake");
  const isUserPick = onClock === settings.slot;
  const untilUser = picksUntilUser(overall, settings);
  const nextMine = nextUserPick(overall, settings);

  const taken = useMemo(() => {
    const ids = new Set<string>();
    for (const p of picks) {
      ids.add(p.playerId);
      if (!p.playerId.startsWith("espn-")) continue;
      const extra = extras.find((e) => e.id === p.playerId);
      const named = extra?.name ? matchByName(extra.name) : undefined;
      if (named) ids.add(named.id);
    }
    return ids;
  }, [picks, extras]);
  const available = useMemo(() => {
    return board.filter((p) => !taken.has(p.id));
  }, [board, taken]);

  const myRoster = useMemo(
    () => rosterFor(picks, settings.slot, byId),
    [picks, settings.slot, byId]
  );

  const recs = useMemo(() => {
    if (done) return [];
    return recommendPicks({
      available,
      roster: myRoster,
      settings,
      overall,
      picksUntilNext: isUserPick ? picksUntilUser(overall + 1, settings) : untilUser,
    });
  }, [available, myRoster, settings, overall, isUserPick, untilUser, done]);

  const gaps = useMemo(() => {
    return [...available]
      .filter((p) => p.pos !== "K" && p.pos !== "DST")
      .map((p) => ({ player: p, gap: sourceGap(p) }))
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, 12);
  }, [available]);

  const toggleSort = (key: BoardSort) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "gap" ? "desc" : "asc");
  };

  const sortedBoard = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...board]
      .filter((p) => (settings.roster.dst === 0 ? p.pos !== "DST" : true))
      .filter((p) => (posFilter === "ALL" ? true : p.pos === posFilter))
      .filter((p) => (showTaken ? true : !taken.has(p.id)))
      .filter((p) =>
        q
          ? p.name.toLowerCase().includes(q) ||
            p.team.toLowerCase().includes(q) ||
            p.pos.toLowerCase() === q
          : true
      )
      .sort((a, b) => compareBoard(a, b, sortKey, sortDir, settings.dsWeight));
  }, [board, posFilter, showTaken, taken, query, settings.dsWeight, settings.roster.dst, sortKey, sortDir]);

  const draftPlayer = useCallback(
    (playerId: string, team = onClock) => {
      if (!team || taken.has(playerId) || done) return;
      setPicks((prev) => [...prev, { overall: prev.length + 1, team, playerId }]);
      setQuery("");
    },
    [onClock, taken, done, setPicks]
  );

  const undo = () => setPicks((prev) => prev.slice(0, -1));

  const resetDraft = () => {
    setPicks([]);
    setQuery("");
  };

  const toggleStar = (id: string) => {
    setStars((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const jumpToMe = () => {
    setPicks((prev) => {
      const next = [...prev];
      const avail = () => {
        const ids = new Set(next.map((p) => p.playerId));
        return board.filter((p) => !ids.has(p.id));
      };
      while (next.length < totalPicks) {
        const o = next.length + 1;
        const team = pickOwner(o, settings.teams, settings.draftType ?? "snake");
        if (team === settings.slot) break;
        const roster = rosterFor(next, team, byId);
        const pick = autoPickForTeam({
          team,
          roster,
          available: avail(),
          settings,
          overall: o,
        });
        if (!pick) break;
        next.push({ overall: o, team, playerId: pick.id });
      }
      return next;
    });
  };

  const applyImport = (source: RankImportSource = importSource) => {
    const parsed = parseRankingPaste(importText, source);
    if (parsed.matched === 0) {
      setImportMsg(
        parsed.unmatched.length
          ? `No players matched. Check the paste format. Unmatched: ${parsed.unmatched.slice(0, 6).join(", ")}`
          : "Nothing to import — paste a CSV or Rank,Player list first.",
      );
      return;
    }
    const entry: LeagueSourceImport = {
      patches: updatesToPatches(parsed.updates),
      matched: parsed.matched,
      importedAt: Date.now(),
      label: source === "ds" ? "League-adjusted DraftSharks" : "League-adjusted FantasyPros",
      live: false,
    };
    const cur = dataRef.current;
    const nextLeague: LeagueRanks = {
      ...(cur.leagueRanks ?? {}),
      [source]: entry,
    };
    writeStore({ ...cur, leagueRanks: nextLeague, importText });
    setImportMsg(
      `Loaded ${parsed.matched} ${source === "ds" ? "DraftSharks" : "FantasyPros"} league ranks${
        parsed.unmatched.length ? `. Unmatched: ${parsed.unmatched.slice(0, 6).join(", ")}` : "."
      } Blend / # / suggestions now use ${source === "ds" ? "these DS ranks" : "these FP ranks"} instead of generic ECR.`,
    );
    setImportOpen(false);
    setLeagueNudgeMutedUntilPick(espn.pickCount + Math.max(1, settings.teams));
  };

  const clearLeagueSource = (source: RankImportSource) => {
    const cur = dataRef.current;
    const next = { ...(cur.leagueRanks ?? {}) };
    delete next[source];
    writeStore({ ...cur, leagueRanks: next });
    setImportMsg(
      source === "ds"
        ? "Cleared league DraftSharks ranks — board falls back to refreshed / snapshot DS."
        : "Cleared league FantasyPros ranks — board falls back to refreshed / snapshot FP.",
    );
  };

  const refreshRankings = useCallback(async (reason: RefreshReason = "manual") => {
    if (refreshingRef.current && reason !== "manual") return;
    const scoring = settingsRef.current.scoring;
    const ranksOnly = reason !== "manual";
    const force = reason === "manual";
    refreshingRef.current = true;
    setRefreshing(true);
    if (reason === "manual") setImportMsg(null);
    try {
      const qs = new URLSearchParams({ scoring });
      if (ranksOnly) qs.set("ranksOnly", "1");
      if (force) qs.set("force", "1");
      const res = await fetch(`/api/rankings/refresh?${qs}`, { cache: "no-store" });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        warnings?: string[];
        patches?: Record<string, RankPatch>;
        injuries?: Record<string, Injury>;
        injuryMatched?: number;
        injuriesLive?: boolean;
        injuriesComplete?: boolean;
        fetchedAt?: number;
        scoring?: string;
        fpMatched?: number;
        dsMatched?: number;
        fpUpdated?: string;
        cached?: boolean;
        ranksOnly?: boolean;
      };
      const attemptAt = Date.now();
      if (!json.ok) {
        const err = json.error ?? "Could not refresh FantasyPros / DraftSharks ranks.";
        const prev = dataRef.current.rankOverlay;
        writeStore({
          ...dataRef.current,
          rankOverlay: {
            ...(prev ?? {
              patches: {},
              fetchedAt: 0,
              scoring,
              fpMatched: 0,
              dsMatched: 0,
            }),
            lastAttemptAt: attemptAt,
            lastError: err,
            lastSource: reason,
          },
        });
        if (reason === "manual") setImportMsg(err);
        return;
      }
      const prev = dataRef.current.rankOverlay;
      const patches =
        json.patches && Object.keys(json.patches).length > 0 ? json.patches : prev?.patches;
      const injuriesLive = ranksOnly
        ? Boolean(prev?.injuriesLive && prev?.injuries)
        : Boolean(json.injuriesLive && json.injuries);
      const injuriesComplete = ranksOnly
        ? Boolean(prev?.injuriesComplete)
        : Boolean(injuriesLive && json.injuriesComplete);
      const kept: string[] = [];
      const lr = leagueRanksRef.current;
      if (lr.fp?.matched) kept.push("FP league import");
      if (lr.ds?.matched) kept.push("DS league import");
      writeStore({
        ...dataRef.current,
        rankOverlay: {
          patches: patches ?? {},
          fetchedAt: json.cached && prev?.fetchedAt ? prev.fetchedAt : (json.fetchedAt ?? attemptAt),
          scoring: json.scoring ?? scoring,
          fpMatched: json.fpMatched ?? prev?.fpMatched ?? 0,
          dsMatched: json.dsMatched ?? prev?.dsMatched ?? 0,
          fpUpdated: json.fpUpdated ?? prev?.fpUpdated,
          injuries: ranksOnly
            ? prev?.injuries
            : injuriesLive
              ? json.injuries
              : prev?.injuries,
          injuryMatched: ranksOnly
            ? prev?.injuryMatched
            : injuriesLive
              ? json.injuryMatched
              : prev?.injuryMatched,
          injuriesLive: ranksOnly ? prev?.injuriesLive : injuriesLive || prev?.injuriesLive,
          injuriesComplete: ranksOnly
            ? prev?.injuriesComplete
            : injuriesLive
              ? injuriesComplete
              : prev?.injuriesComplete,
          lastAttemptAt: attemptAt,
          lastError: undefined,
          lastSource: reason,
          cached: Boolean(json.cached),
          ranksOnly: Boolean(json.ranksOnly ?? ranksOnly),
        },
      });
      if (reason === "manual") {
        const baseMsg = [
          json.fpMatched ? `FP ${json.fpMatched}` : null,
          json.dsMatched ? `DS ${json.dsMatched}` : null,
          !ranksOnly && injuriesLive ? `injuries ${json.injuryMatched ?? 0}` : null,
          json.cached ? "cached" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const keepNote = kept.length
          ? ` League-specific ${kept.join(" + ")} still override generic ECR.`
          : " Tip: Import synced FP/DS cheat sheets for league-adjusted ranks.";
        setImportMsg(
          `Refreshed public ${scoringLabel((json.scoring as LeagueSettings["scoring"]) ?? scoring)} ranks${
            baseMsg ? ` (${baseMsg})` : ""
          }.${keepNote}${json.warnings?.length ? ` · ${json.warnings[0]}` : ""}`,
        );
      }
    } catch (e) {
      const err =
        e instanceof Error ? e.message : "Network error refreshing ranks. The snapshot board is unchanged.";
      const prev = dataRef.current.rankOverlay;
      if (prev) {
        writeStore({
          ...dataRef.current,
          rankOverlay: {
            ...prev,
            lastAttemptAt: Date.now(),
            lastError: err,
            lastSource: reason,
          },
        });
      }
      if (reason === "manual") setImportMsg(err);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!autoRanks || !espn.live || done) return;
    if (espn.pickCount === lastAutoPickCount.current) return;
    const prev = lastAutoPickCount.current;
    lastAutoPickCount.current = espn.pickCount;
    if (prev < 0 && espn.pickCount === 0) return;
    if (prev >= 0 && espn.pickCount <= prev) return;
    const t = window.setTimeout(() => void refreshRankings("pick"), 400);
    return () => window.clearTimeout(t);
  }, [autoRanks, espn.live, espn.pickCount, done, refreshRankings]);

  useEffect(() => {
    if (!autoRanks || !espn.live || done) return;
    const id = window.setInterval(() => {
      void refreshRankings("poll");
    }, LIVE_RANK_POLL_MS);
    return () => window.clearInterval(id);
  }, [autoRanks, espn.live, done, refreshRankings]);

  useEffect(() => {
    if (!espn.live) lastAutoPickCount.current = -1;
  }, [espn.live]);

  useEffect(() => {
    if (!espn.live || done || !hasLeagueImport) {
      lastLeagueNudgeRound.current = -1;
      return;
    }
    if (draftRound < 1) return;
    if (draftRound === lastLeagueNudgeRound.current) return;
    lastLeagueNudgeRound.current = draftRound;
    if (espn.pickCount < leagueNudgeMutedUntilPick) return;
    if (hasLiveLeagueSync) return;
    const parts: string[] = [];
    if (leagueRanks.fp?.matched) parts.push("FP");
    if (leagueRanks.ds?.matched) parts.push("DS");
    setImportMsg(
      `Round ${draftRound} done — public FP/DS auto-refresh; league ${parts.join("+")} stays frozen until you Sync FP/DS ranks (bookmarklet on War Room / Draft Assistant) or re-paste.`,
    );
  }, [
    espn.live,
    espn.pickCount,
    done,
    hasLeagueImport,
    hasLiveLeagueSync,
    draftRound,
    leagueNudgeMutedUntilPick,
    leagueRanks.fp?.matched,
    leagueRanks.ds?.matched,
  ]);

  /** Pull league ranks posted by Sync FP / Sync DS bookmarklets. */
  useEffect(() => {
    let cancelled = false;
    const applyLive = (
      source: RankImportSource,
      payload: {
        matched?: number;
        ts?: number;
        label?: string;
        patches?: Record<string, RankPatch>;
      } | null,
      lastTs: { current: number },
    ) => {
      if (!payload?.matched || !payload.ts || !payload.patches) return;
      if (isLeftoverAgentRankSnapshot(payload)) return;
      if (payload.ts <= lastTs.current) return;
      if (Object.keys(payload.patches).length === 0) return;
      const cur = dataRef.current;
      const prev = cur.leagueRanks?.[source];
      if (
        prev?.live &&
        prev.importedAt === payload.ts &&
        prev.matched === payload.matched
      ) {
        lastTs.current = payload.ts;
        return;
      }
      // Remaining boards shrink mid-draft; never apply a tiny scrape over a solid overlay.
      if (prev?.matched && payload.matched < Math.min(20, Math.floor(prev.matched * 0.35))) {
        return;
      }
      lastTs.current = payload.ts;
      const entry: LeagueSourceImport = {
        patches: payload.patches,
        matched: payload.matched,
        importedAt: payload.ts,
        label:
          payload.label ??
          (source === "ds"
            ? "Live DraftSharks War Room sync"
            : "Live FantasyPros Draft Assistant sync"),
        live: true,
      };
      writeStore({
        ...cur,
        leagueRanks: { ...(cur.leagueRanks ?? {}), [source]: entry },
      });
      setImportMsg(
        `Live ${source === "ds" ? "DraftSharks" : "FantasyPros"} ranks · ${payload.matched} players from bookmarklet sync.`,
      );
      setLeagueNudgeMutedUntilPick(
        (dataRef.current.picks?.length ?? 0) + Math.max(1, settingsRef.current.teams),
      );
    };

    const tick = async () => {
      try {
        const res = await fetch("/api/ranks/ingest", { cache: "no-store" });
        const json = (await res.json()) as {
          ok?: boolean;
          fp?: {
            matched?: number;
            ts?: number;
            label?: string;
            patches?: Record<string, RankPatch>;
          } | null;
          ds?: {
            matched?: number;
            ts?: number;
            label?: string;
            patches?: Record<string, RankPatch>;
          } | null;
        };
        if (cancelled || !json.ok) return;
        applyLive("fp", json.fp ?? null, lastLiveFpTs);
        applyLive("ds", json.ds ?? null, lastLiveDsTs);
      } catch {
        /* ignore transient poll errors */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const myPicks = userPickOveralls(
    settings.slot,
    settings.teams,
    settings.rounds,
    settings.draftType ?? "snake"
  );
  const needs = starterNeeds(myRoster, settings);

  return (
    <div className="flex h-dvh min-w-[1280px] flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/15 font-display text-lg tracking-wide text-primary">
              DS
            </div>
            <div>
              <p className="font-display text-xl leading-none tracking-wide">
                {settings.leagueName || "Draft Room"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {settings.teamNames[settings.slot - 1] ?? `Pick ${settings.slot}`} · pick{" "}
                {settings.slot} · {settings.teams} teams ·{" "}
                {settings.scoring === "half" ? "Half PPR" : settings.scoring === "ppr" ? "PPR" : "Std"} ·{" "}
                {settings.draftType === "linear" ? "linear" : "snake"}
              </p>
            </div>
            <span
              className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={buildTitle()}
            >
              v{BUILD_LABEL}
            </span>
            <RelayPulse />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ClockBadge
              done={done}
              overall={overall}
              teams={settings.teams}
              onClock={onClock}
              isUserPick={isUserPick}
              slot={settings.slot}
              untilUser={untilUser}
              nextMine={nextMine}
              youLabel={settings.teamNames[settings.slot - 1] ?? `Pick ${settings.slot}`}
              teamLabel={
                onClock && settings.teamNames?.[onClock - 1]
                  ? settings.teamNames[onClock - 1]
                  : undefined
              }
            />
            <Button variant="outline" size="sm" onClick={undo} disabled={picks.length === 0}>
              <Undo2 /> Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={jumpToMe}
              disabled={done || isUserPick || espn.live}
              title={espn.live ? "Jump to me is off while ESPN is the source of truth" : undefined}
            >
              <Zap /> Jump to me
            </Button>
            <Button variant="ghost" size="sm" onClick={resetDraft} disabled={picks.length === 0}>
              <RotateCcw /> Reset
            </Button>
            <EspnSync
              settings={settings}
              setSettings={setSettings}
              onPicksFromEspn={applyEspnPicks}
              status={espn}
              setStatus={setEspn}
            />
            <YahooSync
              onPicks={(nextPicks) => applyEspnPicks(nextPicks, dataRef.current.extras ?? [])}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full bg-teal-700 px-3 text-xs font-semibold text-white hover:bg-teal-700/90"
              title="Opens Import → FantasyPros. Copy Sync FP ranks, then click that bookmark on draftwizard.fantasypros.com — not on ESPN."
              onClick={() => openLeagueImport("fp")}
            >
              <Radio className="size-3.5" />
              {leagueRanks.fp?.live ? `Sync FP · ${leagueRanks.fp.matched}` : "Sync FP"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full bg-teal-700 px-3 text-xs font-semibold text-white hover:bg-teal-700/90"
              title="Opens Import → DraftSharks. Copy Sync DS ranks, then click that bookmark on draftsharks.com War Room — not on ESPN."
              onClick={() => openLeagueImport("ds")}
            >
              <Radio className="size-3.5" />
              {leagueRanks.ds?.live ? `Sync DS · ${leagueRanks.ds.matched}` : "Sync DS"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshRankings("manual")}
              disabled={refreshing}
              title="Pull public FantasyPros ECR + DraftSharks 3D for your scoring, plus injury flags. Mid-draft auto uses a lighter ranks-only path. Does not replace league-specific imports — use Re-import for those."
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {refreshing ? "Refreshing…" : "Refresh ranks"}
            </Button>
            <ImportDialog
              open={importOpen}
              onOpenChange={setImportOpen}
              text={importText}
              setText={setImportText}
              source={importSource}
              setSource={setImportSource}
              leagueRanks={leagueRanks}
              onApply={applyImport}
              onClear={clearLeagueSource}
              midDraft={espn.live && !done}
            />
            <SettingsSheet settings={settings} setSettings={setSettings} />
          </div>
        </div>
        {importMsg ? (
          <p className="border-t border-border px-4 py-1.5 text-center text-xs text-primary">
            {importMsg}
            {showLeagueReimportNudge && /re-import|frozen/i.test(importMsg) ? (
              <>
                {" · "}
                {leagueRanks.fp?.matched ? (
                  <button
                    type="button"
                    className="font-medium underline-offset-2 hover:underline"
                    onClick={() => openLeagueImport("fp")}
                  >
                    Re-import FP
                  </button>
                ) : null}
                {leagueRanks.fp?.matched && leagueRanks.ds?.matched ? " · " : null}
                {leagueRanks.ds?.matched ? (
                  <button
                    type="button"
                    className="font-medium underline-offset-2 hover:underline"
                    onClick={() => openLeagueImport("ds")}
                  >
                    Re-import DS
                  </button>
                ) : null}
                {" · "}
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setImportMsg(null);
                    setLeagueNudgeMutedUntilPick(
                      espn.pickCount + Math.max(1, settings.teams),
                    );
                  }}
                >
                  dismiss
                </button>
              </>
            ) : null}
          </p>
        ) : rankOverlay?.lastError ? (
          <p className="border-t border-destructive/30 bg-destructive/5 px-4 py-1.5 text-center text-xs text-destructive">
            Rank refresh failed
            {rankOverlay.lastAttemptAt
              ? ` · ${new Date(rankOverlay.lastAttemptAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : ""}
            {" · "}
            {rankOverlay.lastError}
          </p>
        ) : leagueStatus.length > 0 || espn.live || rankOverlay ? (
          <p className="border-t border-border px-4 py-1.5 text-center text-xs text-muted-foreground">
            {espn.live ? (
              <>
                <span className="font-medium text-primary">ESPN live</span>
                <span>
                  {" "}
                  · {espn.pickCount} picks
                  {espn.pickCount === 0
                    ? " · waiting for pick 1"
                    : espn.source === "room-capture"
                      ? " · room capture"
                      : espn.source === "espn-api"
                        ? " · league API"
                        : ""}
                  {espn.leagueName ? ` · ${espn.leagueName}` : ""}
                  {espn.warning ? ` · ${espn.warning}` : ""}
                </span>
                <span>
                  {" · "}
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => setAutoRanks((v) => !v)}
                    title={`Auto-refresh public FP ECR + DS 3D every ~${Math.round(LIVE_RANK_POLL_MS / 1000)}s and after new picks (throttled ${Math.round(MIN_REFRESH_INTERVAL_MS / 1000)}s). Not league War Room / supply-demand boards.`}
                  >
                    {autoRanks ? "auto public ranks on" : "auto public ranks off"}
                  </button>
                </span>
              </>
            ) : null}
            {espn.live && (leagueStatus.length > 0 || rankOverlay) ? " · " : null}
            {leagueStatus.length > 0 ? (
              <>
                <span className="font-medium text-foreground">League ranks</span>
                {" · "}
                {leagueStatus.join(" · ")}
                <span className="text-muted-foreground">
                  {" "}
                  ({hasLiveLeagueSync ? "live bookmarklet sync" : "pinned until re-import / Sync FP·DS"})
                </span>
                {espn.live ? (
                  <>
                    {" · "}
                    {leagueRanks.fp?.matched ? (
                      <button
                        type="button"
                        className="underline-offset-2 hover:underline"
                        onClick={() => openLeagueImport("fp")}
                        title="Re-paste or install Sync FP ranks bookmarklet on your FantasyPros Draft Assistant tab"
                      >
                        {leagueRanks.fp.live ? "FP live" : "Re-import FP"}
                      </button>
                    ) : null}
                    {leagueRanks.fp?.matched && leagueRanks.ds?.matched ? " · " : null}
                    {leagueRanks.ds?.matched ? (
                      <button
                        type="button"
                        className="underline-offset-2 hover:underline"
                        onClick={() => openLeagueImport("ds")}
                        title="Re-paste or install Sync DS ranks bookmarklet on your DraftSharks War Room tab"
                      >
                        {leagueRanks.ds.live ? "DS live" : "Re-import DS"}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : espn.live ? (
              <>
                <span className="font-medium text-foreground">No league import</span>
                {" · public ECR/3D only · "}
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => openLeagueImport("fp")}
                >
                  Import FP/DS
                </button>
              </>
            ) : null}
            {rankOverlay?.fetchedAt ? (
              <>
                {leagueStatus.length > 0 || espn.live ? " · " : null}
                <span className="font-medium text-foreground">Public FP/DS</span>
                {` refreshed ${new Date(rankOverlay.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                {rankOverlay.lastSource && rankOverlay.lastSource !== "manual"
                  ? ` · ${rankOverlay.lastSource}`
                  : ""}
                {rankOverlay.cached ? " · cached" : ""}
              </>
            ) : null}
          </p>
        ) : null}
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.2fr)_400px_340px] gap-4 p-4">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-3 border-b border-border p-3">
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search player, team, pos…"
              className="h-9 flex-1 bg-background"
              onKeyDown={(e) => {
                if (e.key === "Enter" && sortedBoard[0] && !taken.has(sortedBoard[0].id)) {
                  draftPlayer(sortedBoard[0].id);
                }
              }}
            />
            <div className="flex shrink-0 gap-1">
              {posFilterList(settings).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosFilter(p)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide",
                    posFilter === p
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              # mix FP {100 - settings.dsWeight}% / DS {settings.dsWeight}%
              {sortKey === "blend"
                ? ""
                : sortKey === "pos"
                  ? ` · sorted by position ${sortDir === "asc" ? "QB → DST" : "DST → QB"}`
                  : sortKey === "fp"
                    ? ` · sorted by FantasyPros ${sortDir === "asc" ? "best first" : "worst first"}`
                    : sortKey === "ds"
                      ? ` · sorted by DraftSharks ${sortDir === "asc" ? "best first" : "worst first"}`
                      : sortKey === "adp"
                        ? ` · sorted by ADP ${sortDir === "asc" ? "earliest first" : "latest first"}`
                        : ` · sorted by FP vs DS gap ${sortDir === "desc" ? "DS+ first" : "FP+ first"}`}
              {rankOverlay?.fetchedAt
                ? ` · live ${scoringLabel(settings.scoring)} ${new Date(rankOverlay.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${
                    rankOverlay.injuriesLive
                      ? ` · ${rankOverlay.injuryMatched ?? 0} injury flags`
                      : ""
                  }${espn.live && autoRanks ? " · auto" : ""}`
                : " · Sept 1 snapshot"}
              {leagueRanks.fp?.matched || leagueRanks.ds?.matched
                ? ` · league ${[
                    leagueRanks.fp?.matched ? "FP" : null,
                    leagueRanks.ds?.matched ? "DS" : null,
                  ]
                    .filter(Boolean)
                    .join("+")}`
                : ""}
            </span>
            <label className="flex items-center gap-2">
              <Switch checked={showTaken} onCheckedChange={setShowTaken} />
              Show taken
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <SortTh label="#" column="blend" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-2 py-2 font-medium">Player</th>
                  <SortTh label="Pos" column="pos" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="FP" column="fp" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="DS" column="ds" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="ADP" column="adp" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Gap" column="gap" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sortedBoard.slice(0, 220).map((p) => {
                  const gone = taken.has(p.id);
                  const starred = stars.includes(p.id);
                  return (
                    <tr
                      key={playerListKey(p)}
                      className={cn(
                        "border-t border-border hover:bg-muted/70",
                        gone && "opacity-40",
                        starred && !gone && "bg-amber-50"
                      )}
                    >
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                        {formatBoardRank(p, settings.dsWeight)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => toggleStar(p.id)} className="text-muted-foreground">
                            <Star className={cn("size-3.5", starred && "fill-gold text-gold")} />
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={cn("truncate font-medium", gone && "line-through")}>
                                {displayName(p)}
                              </span>
                              <InjuryDot injury={p.injury} />
                            </div>
                            <p>
                              <PlayerSubline player={p} sleeper={p.tags.includes("sleeper")} />
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <PosBadge pos={p.pos} />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{formatSourceRank(p.fpRank)}</td>
                      <td className="px-2 py-2 font-mono text-xs">{formatSourceRank(p.dsRank)}</td>
                      <td className="px-2 py-2 font-mono text-xs">{formatSourceRank(p.adp)}</td>
                      <td className="px-2 py-2">
                        <GapChip fp={p.fpRank} ds={p.dsRank} />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="xs"
                          variant={isUserPick ? "default" : "outline"}
                          disabled={gone || done}
                          onClick={() => draftPlayer(p.id)}
                        >
                          {gone ? "Off" : isUserPick ? "Draft" : "Taken"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sortedBoard.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No players match that filter.</p>
            ) : null}
          </div>
        </section>

        <section className="flex min-h-0 flex-col gap-4 overflow-auto">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-lg tracking-wide">
                {done ? "Draft complete" : isUserPick ? "You're on the clock" : "Suggested Next Picks"}
              </h2>
              {!done && nextMine ? (
                <Badge variant="outline">Your pick {formatPick(nextMine, settings.teams)}</Badge>
              ) : null}
            </div>
            {done ? (
              <p className="text-sm text-muted-foreground">
                Roster is locked. Scan bye weeks and late sleepers one more time before Wednesday.
              </p>
            ) : (
              <ol className="space-y-2">
                {recs.map((rec, idx) => (
                  <li
                    key={playerListKey(rec.player, idx)}
                    className="rounded-xl border border-border bg-muted/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="font-display text-xl text-primary">{idx + 1}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{rec.player.name}</span>
                            <PosBadge pos={rec.player.pos} />
                            <InjuryDot injury={rec.player.injury} />
                            <WaitChip wait={rec.wait} />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            <PlayerSubline player={rec.player} className="text-xs" />
                            {" · "}#{formatBoardRank(rec.player, settings.dsWeight)} · FP{" "}
                            {formatSourceRank(rec.player.fpRank)} · DS {formatSourceRank(rec.player.dsRank)}
                          </p>
                          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            {rec.reasons.map((r) => (
                              <li key={r}>· {r}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => draftPlayer(rec.player.id)}>
                        {isUserPick ? "Draft" : "Mark"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <RosterCard roster={myRoster} needs={needs} />
        </section>

        <section className="flex min-h-0 flex-col gap-4 overflow-auto">
          <Tabs defaultValue="log">
            <TabsList className="w-full">
              <TabsTrigger value="log">Picks</TabsTrigger>
              <TabsTrigger value="gaps">FP vs DS</TabsTrigger>
              <TabsTrigger value="plan">Plan</TabsTrigger>
            </TabsList>
            <TabsContent value="log" className="mt-3">
              <PickLog picks={picks} settings={settings} board={board} onUndo={undo} />
            </TabsContent>
            <TabsContent value="gaps" className="mt-3">
              <GapsList gaps={gaps} onDraft={draftPlayer} />
            </TabsContent>
            <TabsContent value="plan" className="mt-3">
              <PlanCard settings={settings} myPicks={myPicks} available={available} picks={picks} />
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
}

function WaitChip({ wait }: { wait: "now" | "borderline" | "can-wait" }) {
  if (wait === "now") {
    return (
      <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
        Won&apos;t last
      </span>
    );
  }
  if (wait === "can-wait") {
    return (
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
        Can wait
      </span>
    );
  }
  return (
    <span className="rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gold">
      Close
    </span>
  );
}

function ClockBadge({
  done,
  overall,
  teams,
  onClock,
  isUserPick,
  slot,
  untilUser,
  nextMine,
  teamLabel,
  youLabel,
}: {
  done: boolean;
  overall: number;
  teams: number;
  onClock: number | null;
  isUserPick: boolean;
  slot: number;
  untilUser: number;
  nextMine: number | null;
  teamLabel?: string;
  youLabel?: string;
}) {
  if (done) return <Badge>Complete</Badge>;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm",
        isUserPick
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-muted"
      )}
    >
      <span className="font-display text-lg leading-none">{formatPick(overall, teams)}</span>
      <span className="text-xs">
        {isUserPick ? "Your pick" : `${teamLabel ?? `Team ${onClock}`}'s pick`}
        {!isUserPick && nextMine ? ` · ${untilUser} until you` : ""}
        <span className="text-muted-foreground">
          {" "}
          ({youLabel ?? `you are ${slot}`})
        </span>
      </span>
    </div>
  );
}

function RosterCard({
  roster,
  needs,
}: {
  roster: Player[];
  needs: ReturnType<typeof starterNeeds>;
}) {
  const groups: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-3 font-display text-lg tracking-wide">Your roster</h2>
      {roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No picks yet. Set your slot, then draft or use Jump to me to practice the turn.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((pos) => {
            const here = roster.filter((p) => p.pos === pos);
            if (pos === "DST" && needs.holes.DST === 0 && here.length === 0) return null;
            if (here.length === 0 && needs.holes[pos] === 0 && pos !== "QB" && pos !== "RB" && pos !== "WR" && pos !== "TE") {
              return null;
            }
            return (
              <div key={pos}>
                <div className="mb-1 flex items-center gap-2">
                  <PosBadge pos={pos} />
                  {needs.holes[pos] > 0 ? (
                    <span className="text-[11px] text-gold">Need {needs.holes[pos]}</span>
                  ) : null}
                </div>
                {here.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Empty</p>
                ) : (
                  <ul className="space-y-1">
                    {here.map((p, i) => (
                      <li key={playerListKey(p, i)} className="flex items-center justify-between text-sm">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate">
                            {p.name}{" "}
                            <PlayerSubline player={p} className="text-xs" />
                          </span>
                          <InjuryDot injury={p.injury} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {needs.rbwrHole > 0 ? (
            <p className="text-xs text-gold">RB/WR slot still open.</p>
          ) : null}
          {needs.flexHole > 0 ? (
            <p className="text-xs text-gold">FLEX still open.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PickLog({
  picks,
  settings,
  board,
  onUndo,
}: {
  picks: DraftPick[];
  settings: LeagueSettings;
  board: Player[];
  onUndo: () => void;
}) {
  if (picks.length === 0) {
    return (
      <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        Waiting for names. Live mode: click Taken on whoever comes off the board. Practice mode: Jump to me auto-picks the room by ADP until your turn.
      </p>
    );
  }
  const recent = [...picks].reverse().slice(0, 18);
  return (
    <ul className="space-y-1 rounded-xl border border-border p-2">
      {recent.map((pk) => {
        const player = board.find((p) => p.id === pk.playerId);
        const mine = pk.team === settings.slot;
        const label = pickLogDisplayName(player);
        return (
          <li
            key={pk.overall}
            className={cn(
              "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm",
              mine && "bg-primary/10"
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-10 font-mono text-[11px] text-muted-foreground">
                {formatPick(pk.overall, settings.teams)}
              </span>
              <span className="truncate">
                {label}
                {mine ? " · you" : ` · ${settings.teamNames[pk.team - 1] ?? `T${pk.team}`}`}
              </span>
              <InjuryDot injury={player?.injury} />
            </span>
            {pk.overall === picks.length ? (
              <button type="button" onClick={onUndo} className="text-muted-foreground hover:text-foreground">
                <ChevronLeft className="size-4" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function GapsList({
  gaps,
  onDraft,
}: {
  gaps: { player: Player; gap: number }[];
  onDraft: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Where your two sources disagree. DS+ means DraftSharks is higher — often the value if he lasts. FP+ means FantasyPros is higher.
      </p>
      <ul className="space-y-2">
        {gaps.map(({ player }, i) => (
          <li key={playerListKey(player, i)} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{player.name}</span>
                <PosBadge pos={player.pos} />
                <InjuryDot injury={player.injury} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                FP {formatSourceRank(player.fpRank)} · DS {formatSourceRank(player.dsRank)} · ADP{" "}
                {formatSourceRank(player.adp)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <GapChip fp={player.fpRank} ds={player.dsRank} />
              <Button size="xs" variant="outline" onClick={() => onDraft(player.id)}>
                Mark
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({
  settings,
  myPicks,
  available,
  picks,
}: {
  settings: LeagueSettings;
  myPicks: number[];
  available: Player[];
  picks: DraftPick[];
}) {
  const remaining = useMemo(() => {
    return [...available]
      .filter((p) => p.pos !== "K" && p.pos !== "DST")
      .sort((a, b) => a.adp - b.adp);
  }, [available]);

  const youName = settings.teamNames[settings.slot - 1] ?? `Pick ${settings.slot}`;
  const path = myPicks.slice(0, 4).map((o) => formatPick(o, settings.teams));
  const isJfl = settings.espnLeagueId === "1361349772";
  const slot = settings.slot;
  const turn = slot === 5;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3 text-sm">
      <p>
        You are <span className="font-semibold text-primary">{youName}</span>, pick{" "}
        <span className="font-semibold text-primary">{settings.slot}</span>
        {settings.leagueName ? ` in ${settings.leagueName}` : ""}. Snake path is{" "}
        <span className="font-mono text-foreground">{path.join(" / ") || "—"}</span>.
      </p>
      <ul className="space-y-2 text-muted-foreground">
        {isJfl ? (
          <>
            <li>
              {turn
                ? "1.05: take the last of Gibbs / Bijan / Chase / Nacua / JSN. In this 3-WR league, an elite WR at 5 is not a reach. Pass on CMC unless the top five are gone — WATCH flag, and you only start one dedicated RB."
                : slot <= 3
                  ? "This is a 3-WR league. Chase / Nacua / JSN / ARSB go over a mid-RB at 1.01–1.03 unless Gibbs or Bijan is there."
                  : "Late slot: if Nacua, JSN, or ARSB slides, take the WR. You start three of them."}
            </li>
            <li>
              2.08 comes back after eight picks. If you took WR at 5, smash the best remaining RB (Cook / Achane / Hampton / Walker). If you took RB at 5, take the best WR on the board — London, AJ Brown, Nico, ARSB.
            </li>
            <li>
              RB/WR is not full FLEX — TE cannot go there. One workhorse RB is enough early; extra WRs can fill the combo. Never draft a D/ST. Kicker in round 14. Wait on QB unless Allen falls to 4.08.
            </li>
            <li>
              First downs pay 0.25. Confirm before Thursday: Jeanty&apos;s leg, Nabers&apos; workload, Egbuka&apos;s toe, Love&apos;s ankle, Kraft practicing, Kamara (out).
            </li>
          </>
        ) : (
          <li>
            Recs follow the roster in League settings. Syncing an ESPN mock or another league
            updates pick count and whose turn it is; set your slot if the URL did not include teamId.
          </li>
        )}
      </ul>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your remaining picks
        </p>
        <ol className="space-y-1 font-mono text-xs">
          {myPicks
            .filter((o) => o > picks.length)
            .slice(0, 8)
            .map((o) => {
              const targets = remaining.filter((p) => p.adp >= o - 6 && p.adp <= o + 10).slice(0, 3);
              return (
                <li key={o}>
                  {formatPick(o, settings.teams)}{" "}
                  <span className="font-sans text-muted-foreground">
                    {targets.length
                      ? targets.map((p) => p.name.split(" ").slice(-1)[0]).join(" / ")
                      : "BPA"}
                  </span>
                </li>
              );
            })}
        </ol>
      </div>
    </div>
  );
}

function SettingsSheet({
  settings,
  setSettings,
}: {
  settings: LeagueSettings;
  setSettings: (s: LeagueSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings2 /> League
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (typeof next === "boolean") setOpen(next);
        }}
      >
      <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{settings.leagueName}</SheetTitle>
          <SheetDescription>
            {settings.espnLeagueId === "1361349772"
              ? "JFL 28 defaults. You are JackAL, pick 5. Change slot, scoring, and roster for any other ESPN draft you sync."
              : `Syncing ${settings.leagueName || "this ESPN draft"}. You are pick ${settings.slot} of ${settings.teams}.`}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 pb-8">
          {settings.espnLeagueId === "1361349772" ? (
            <div className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
              <p className="font-medium">Starters (8) + 6 bench + 2 IR</p>
              <p className="mt-1 text-xs text-muted-foreground">
                QB · RB · RB/WR · WR · WR · WR · TE · K. No D/ST. RB/WR is not a full FLEX — TEs cannot
                play it. First downs are 0.25 rushing and receiving.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
              <p className="font-medium">
                {settings.teams} teams · you are pick {settings.slot}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Team count and names come from the ESPN tab you synced. Recs follow the roster
                below — edit scoring and rounds if this mock uses a different format.
              </p>
            </div>
          )}
          <Field label="Your slot">
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={settings.slot}
              onChange={(e) => setSettings({ ...settings, slot: Number(e.target.value) })}
            >
              {Array.from({ length: settings.teams }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}. {settings.teamNames[n - 1] ?? `Pick ${n}`}
                  {n === settings.slot ? " (you)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scoring">
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={settings.scoring}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scoring: e.target.value as LeagueSettings["scoring"],
                })
              }
            >
              <option value="ppr">Full PPR</option>
              <option value="half">Half PPR</option>
              <option value="standard">Standard</option>
            </select>
          </Field>
          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <Label>Trust DraftSharks</Label>
              <span className="font-mono text-xs">{settings.dsWeight}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.dsWeight}
              onChange={(e) => setSettings({ ...settings, dsWeight: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              0% = FantasyPros only. 100% = DraftSharks only. 50% is the blended board.
              League imports replace generic ECR for that source when present.
            </p>
          </div>
          <Field label="Rounds">
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={settings.rounds}
              onChange={(e) => setSettings({ ...settings, rounds: Number(e.target.value) })}
            >
              {[14, 15, 16].map((n) => (
                <option key={n} value={n}>
                  {n} rounds
                </option>
              ))}
            </select>
          </Field>
          <Field label="Draft type">
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={settings.draftType ?? "snake"}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  draftType: e.target.value as DraftType,
                })
              }
            >
              <option value="snake">Snake</option>
              <option value="linear">Linear</option>
            </select>
          </Field>
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  text,
  setText,
  source,
  setSource,
  leagueRanks,
  onApply,
  onClear,
  midDraft,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  text: string;
  setText: (v: string) => void;
  source: RankImportSource;
  setSource: (s: RankImportSource) => void;
  leagueRanks: LeagueRanks;
  onApply: (source: RankImportSource) => void;
  onClear: (source: RankImportSource) => void;
  midDraft?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const active = leagueRanks[source];
  const hasAny = Boolean(leagueRanks.fp?.matched || leagueRanks.ds?.matched);
  const placeholder =
    source === "ds"
      ? "RK,PLAYER,POS\n1,Jahmyr Gibbs,RB\n2,Bijan Robinson,RB"
      : "RK,PLAYER NAME,TEAM,POS,ADP\n1,Ja'Marr Chase,CIN,WR,3";

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const raw = await file.text();
    setText(raw);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenChange(true)}
        title={
          midDraft
            ? "Live Sync FP/DS bookmarklets on War Room / Draft Assistant, or re-paste — public Refresh cannot pull login-gated boards"
            : "Import league-specific FantasyPros / DraftSharks ranks (paste or live bookmarklet)"
        }
      >
        <ClipboardPaste /> {midDraft && hasAny ? "Re-import" : "Import FP/DS"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (typeof next === "boolean") onOpenChange(next);
        }}
      >
        <DialogContent className="max-w-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {midDraft && active ? "Re-import league rankings" : "League-specific rankings"}
            </DialogTitle>
            <DialogDescription>
              Sync your league on FantasyPros or DraftSharks first. Prefer{" "}
              <span className="font-medium text-foreground">Sync FP / Sync DS ranks</span>{" "}
              bookmarklets on the open Draft Assistant / War Room tab for live remaining ranks.
              Paste/CSV still works. Draft Room cannot read Chrome extension sidebars on ESPN —
              only pages you open and bookmarklets can scrape. Auto Refresh only updates public
              ECR / 3D.
              {midDraft ? " Mid-draft: re-run the bookmarklet or paste when War Room re-ranks." : ""}
            </DialogDescription>
          </DialogHeader>

          {midDraft ? (
            <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-foreground">
              Mid-draft: taken players are filtered from ESPN. Public FP/DS auto-update. For
              supply/demand league boards, keep FP Draft Assistant and/or DS War Room open and use
              the Sync bookmarklets below — or paste a fresh export.
            </p>
          ) : null}

          <Tabs
            value={source}
            onValueChange={(v) => setSource(v === "ds" ? "ds" : "fp")}
            className="gap-3"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="fp">FantasyPros</TabsTrigger>
              <TabsTrigger value="ds">DraftSharks</TabsTrigger>
            </TabsList>

            <TabsContent value="fp" className="space-y-3 text-xs text-muted-foreground">
              <RanksLiveSyncPanel
                source="fp"
                liveMatched={leagueRanks.fp?.live ? leagueRanks.fp.matched : undefined}
                liveAt={leagueRanks.fp?.live ? leagueRanks.fp.importedAt : undefined}
              />
              <ol className="list-decimal space-y-1 pl-4">
                <li>On FantasyPros, sync JFL 28 (or your league) under My Leagues.</li>
                <li>
                  Open{" "}
                  <a
                    className="text-primary underline-offset-2 hover:underline"
                    href="https://draftwizard.fantasypros.com/football/leagues/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Draft Wizard / Draft Assistant
                  </a>{" "}
                  or{" "}
                  <a
                    className="text-primary underline-offset-2 hover:underline"
                    href="https://www.fantasypros.com/nfl/cheat-sheet-creator.php"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Cheat Sheet Creator
                  </a>{" "}
                  with that league selected.
                </li>
                <li>
                  Best: click <span className="font-medium text-foreground">Sync FP ranks</span> on
                  that tab. Fallback: export CSV / paste Rank, Player below.
                </li>
              </ol>
            </TabsContent>

            <TabsContent value="ds" className="space-y-3 text-xs text-muted-foreground">
              <RanksLiveSyncPanel
                source="ds"
                liveMatched={leagueRanks.ds?.live ? leagueRanks.ds.matched : undefined}
                liveAt={leagueRanks.ds?.live ? leagueRanks.ds.importedAt : undefined}
              />
              <ol className="list-decimal space-y-1 pl-4">
                <li>On DraftSharks, sync the same league so 3D values match your scoring / roster.</li>
                <li>
                  Open your league-adjusted{" "}
                  <span className="font-medium text-foreground">Draft War Room</span> (full site tab,
                  not only the ESPN sidebar).
                </li>
                <li>
                  Best: click <span className="font-medium text-foreground">Sync DS ranks</span> on
                  that tab. Fallback: copy Rank + Player and paste below.
                </li>
              </ol>
            </TabsContent>
          </Tabs>

          {active ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
              <span>
                <span className="font-medium text-foreground">{active.label ?? "Imported"}</span>
                {" · "}
                {active.matched} players ·{" "}
                {new Date(active.importedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {active.live ? " · live sync" : midDraft ? " · re-sync or re-paste to update" : ""}
              </span>
              <Button variant="ghost" size="sm" onClick={() => onClear(source)}>
                Clear
              </Button>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              No {source === "ds" ? "DraftSharks" : "FantasyPros"} league import yet — board uses
              snapshot / Refresh for that column.
            </p>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button variant="outline" size="sm" type="button" onClick={() => fileRef.current?.click()}>
              Choose CSV…
            </Button>
            <span className="text-xs text-muted-foreground">or paste below</span>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            className="min-h-40 w-full rounded-xl border border-input bg-background p-3 font-mono text-xs"
          />
          <Button onClick={() => onApply(source)} disabled={!text.trim()}>
            {active
              ? source === "ds"
                ? "Re-import DraftSharks ranks"
                : "Re-import FantasyPros ranks"
              : source === "ds"
                ? "Import DraftSharks ranks"
                : "Import FantasyPros ranks"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
