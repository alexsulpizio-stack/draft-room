"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardPaste,
  Loader2,
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
import { applyUpdates, parseRankingPaste } from "@/lib/parse-import";
import {
  applyInjuryOverlay,
  applyRankPatches,
  scoringLabel,
  type RankPatch,
} from "@/lib/rank-refresh";
import type { DraftPick, DraftType, Injury, LeagueSettings, Player, Position } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { GapChip, InjuryDot, PlayerSubline, PosBadge } from "@/components/player-bits";
import { EspnSync, type EspnLiveStatus } from "@/components/espn-sync";
import { mergeBoardWithEspnExtras } from "@/lib/espn";

const STORAGE_KEY = "draft-room-jfl-28-jackal";

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
};

type Persisted = {
  settings: LeagueSettings;
  picks: DraftPick[];
  stars: string[];
  avoids: string[];
  extras?: Player[];
  importText?: string;
  rankOverlay?: RankOverlay;
};

const EMPTY: Persisted = {
  settings: DEFAULT_SETTINGS,
  picks: [],
  stars: [],
  avoids: [],
  extras: [],
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

  const setSettings = useCallback(
    (next: LeagueSettings) => writeStore({ ...data, settings: next }),
    [data]
  );
  const setPicks = useCallback(
    (next: DraftPick[] | ((prev: DraftPick[]) => DraftPick[])) => {
      const picksNext = typeof next === "function" ? next(data.picks ?? EMPTY.picks) : next;
      writeStore({ ...data, picks: picksNext });
    },
    [data]
  );
  const setStars = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      const starsNext = typeof next === "function" ? next(data.stars ?? EMPTY.stars) : next;
      writeStore({ ...data, stars: starsNext });
    },
    [data]
  );
  const applyEspnPicks = useCallback(
    (nextPicks: DraftPick[], extraPlayers: Player[], settingsPatch?: LeagueSettings) => {
      writeStore({
        ...data,
        picks: nextPicks,
        extras: extraPlayers,
        settings: settingsPatch ?? data.settings,
      });
    },
    [data]
  );

  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [showTaken, setShowTaken] = useState(false);
  const [sortKey, setSortKey] = useState<BoardSort>("blend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Player[] | null>(null);
  const [espn, setEspn] = useState<EspnLiveStatus>({ live: false, source: "empty", pickCount: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const board = useMemo(() => {
    const ranked = applyInjuryOverlay(
      applyRankPatches(PLAYERS, rankOverlay?.patches),
      rankOverlay?.injuries,
      rankOverlay?.injuriesLive,
      rankOverlay?.injuriesComplete,
    );
    const base = overrides ?? ranked;
    return mergeBoardWithEspnExtras(base, extras);
  }, [overrides, extras, rankOverlay]);
  const byId = useMemo(() => new Map(board.map((p) => [p.id, p])), [board]);
  const overall = picks.length + 1;
  const totalPicks = settings.teams * settings.rounds;
  const done = picks.length >= totalPicks;
  const onClock = done ? null : pickOwner(overall, settings.teams, settings.draftType ?? "snake");
  const isUserPick = onClock === settings.slot;
  const untilUser = picksUntilUser(overall, settings);
  const nextMine = nextUserPick(overall, settings);

  const taken = useMemo(() => new Set(picks.map((p) => p.playerId)), [picks]);
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

  const applyImport = () => {
    const parsed = parseRankingPaste(importText);
    setOverrides(
      applyUpdates(
        applyInjuryOverlay(
          applyRankPatches(PLAYERS, rankOverlay?.patches),
          rankOverlay?.injuries,
          rankOverlay?.injuriesLive,
          rankOverlay?.injuriesComplete,
        ),
        parsed.updates,
      ),
    );
    setImportMsg(
      `Updated ${parsed.matched} players from your paste${
        parsed.unmatched.length ? `. Unmatched: ${parsed.unmatched.slice(0, 6).join(", ")}` : "."
      }`
    );
    setImportOpen(false);
  };

  const refreshRankings = async () => {
    setRefreshing(true);
    setImportMsg(null);
    try {
      const res = await fetch(`/api/rankings/refresh?scoring=${settings.scoring}`, { cache: "no-store" });
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
      };
      if (!json.ok) {
        setImportMsg(json.error ?? "Could not refresh FantasyPros / DraftSharks ranks.");
        return;
      }
      const patches =
        json.patches && Object.keys(json.patches).length > 0
          ? json.patches
          : data.rankOverlay?.patches;
      const injuriesLive = Boolean(json.injuriesLive && json.injuries);
      const injuriesComplete = Boolean(injuriesLive && json.injuriesComplete);
      setOverrides(null);
      writeStore({
        ...data,
        rankOverlay: {
          patches: patches ?? {},
          fetchedAt: json.fetchedAt ?? Date.now(),
          scoring: json.scoring ?? settings.scoring,
          fpMatched: json.fpMatched ?? 0,
          dsMatched: json.dsMatched ?? 0,
          fpUpdated: json.fpUpdated,
          injuries: injuriesLive ? json.injuries : data.rankOverlay?.injuries,
          injuryMatched: injuriesLive
            ? json.injuryMatched
            : data.rankOverlay?.injuryMatched,
          injuriesLive: injuriesLive || data.rankOverlay?.injuriesLive,
          injuriesComplete: injuriesLive
            ? injuriesComplete
            : data.rankOverlay?.injuriesComplete,
        },
      });
      const when = json.fpUpdated ? ` · FP ${json.fpUpdated}` : "";
      const inj = injuriesLive
        ? ` · ${json.injuryMatched} injury flags`
        : data.rankOverlay?.injuriesLive
          ? ` · kept ${data.rankOverlay.injuryMatched ?? 0} injury flags`
          : json.warnings?.find((w) => /injur/i.test(w))
            ? ` · ${json.warnings.find((w) => /injur/i.test(w))}`
            : " · snapshot injuries kept";
      const warn = json.warnings?.find((w) => !/injur/i.test(w));
      setImportMsg(
        `Refreshed ${scoringLabel(settings.scoring)} ranks · FP ${json.fpMatched ?? 0} · DS ${json.dsMatched ?? 0}${inj}${when}${warn ? ` · ${warn}` : ""}`,
      );
    } catch {
      setImportMsg("Network error refreshing ranks. The snapshot board is unchanged.");
    } finally {
      setRefreshing(false);
    }
  };

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
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshRankings()}
              disabled={refreshing}
              title="Pull live FantasyPros ECR, DraftSharks 3D ranks, and current Out / Q / Watch injury flags"
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {refreshing ? "Refreshing…" : "Refresh ranks"}
            </Button>
            <ImportDialog
              open={importOpen}
              onOpenChange={setImportOpen}
              text={importText}
              setText={setImportText}
              onApply={applyImport}
            />
            <SettingsSheet settings={settings} setSettings={setSettings} />
          </div>
        </div>
        {importMsg ? (
          <p className="border-t border-border px-4 py-1.5 text-center text-xs text-primary">{importMsg}</p>
        ) : espn.live ? (
          <p className="border-t border-primary/20 bg-primary/8 px-4 py-1.5 text-center text-xs">
            <span className="font-medium text-primary">ESPN live</span>
            <span className="text-muted-foreground">
              {" "}
              · {espn.pickCount} picks
              {espn.source === "room-capture"
                ? " · room capture"
                : espn.source === "espn-api"
                  ? " · league API"
                  : " · waiting for picks"}
              {espn.leagueName ? ` · ${espn.leagueName}` : ""}
              {espn.warning ? ` · ${espn.warning}` : ""}
            </span>
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
              {rankOverlay
                ? ` · live ${scoringLabel(settings.scoring)} ${new Date(rankOverlay.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${
                    rankOverlay.injuriesLive
                      ? ` · ${rankOverlay.injuryMatched ?? 0} injury flags`
                      : ""
                  }`
                : " · Sept 1 snapshot"}
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
                {done ? "Draft complete" : isUserPick ? "You're on the clock" : "What to take next"}
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
        Live mode: click Taken on whoever comes off the board. Practice mode: Jump to me auto-picks the room by ADP until your turn.
      </p>
    );
  }
  const recent = [...picks].reverse().slice(0, 18);
  return (
    <ul className="space-y-1 rounded-xl border border-border p-2">
      {recent.map((pk) => {
        const player = board.find((p) => p.id === pk.playerId);
        const mine = pk.team === settings.slot;
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
                {player?.name ?? pk.playerId}
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
              0% = FantasyPros ECR only. 100% = DraftSharks 3D only. 50% is the blended board.
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
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  text: string;
  setText: (v: string) => void;
  onApply: () => void;
}) {
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => onOpenChange(true)}>
        <ClipboardPaste /> Import
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (typeof next === "boolean") onOpenChange(next);
        }}
      >
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste FantasyPros rankings</DialogTitle>
          <DialogDescription>
            Export or copy your latest cheat sheet. We&apos;ll overlay those ranks onto this board and keep DraftSharks 3D next to them.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"RK,PLAYER NAME,TEAM,POS,ADP\n1,Ja'Marr Chase,CIN,WR,3"}
          className="min-h-40 w-full rounded-xl border border-input bg-background p-3 font-mono text-xs"
        />
        <Button onClick={onApply} disabled={!text.trim()}>
          Overlay my rankings
        </Button>
      </DialogContent>
    </Dialog>
    </>
  );
}
