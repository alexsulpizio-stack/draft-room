"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronLeft,
  ClipboardPaste,
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
  blendedRank,
  formatPick,
  nextUserPick,
  pickOwner,
  picksUntilUser,
  recommendPicks,
  rosterFor,
  sourceGap,
  starterNeeds,
  userPickOveralls,
} from "@/lib/draft";
import { applyUpdates, parseRankingPaste } from "@/lib/parse-import";
import type { DraftPick, DraftType, LeagueSettings, Player, Position } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { GapChip, InjuryDot, PosBadge } from "@/components/player-bits";
import { EspnSync, type EspnLiveStatus } from "@/components/espn-sync";

const STORAGE_KEY = "draft-room-2026";

type Persisted = {
  settings: LeagueSettings;
  picks: DraftPick[];
  stars: string[];
  avoids: string[];
  extras?: Player[];
  importText?: string;
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

function posFilterList(): Array<Position | "ALL"> {
  return ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];
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
          teamNames: parsed.settings?.teamNames ?? [],
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
    (nextPicks: DraftPick[], extraPlayers: Player[]) => {
      writeStore({ ...data, picks: nextPicks, extras: extraPlayers });
    },
    [data]
  );

  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [showTaken, setShowTaken] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Player[] | null>(null);
  const [espn, setEspn] = useState<EspnLiveStatus>({ live: false, source: "empty", pickCount: 0 });
  const searchRef = useRef<HTMLInputElement>(null);

  const board = useMemo(() => {
    const base = overrides ?? PLAYERS;
    if (!extras.length) return base;
    const ids = new Set(base.map((p) => p.id));
    return [...base, ...extras.filter((e) => !ids.has(e.id))];
  }, [overrides, extras]);
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

  const sortedBoard = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...board]
      .filter((p) => (posFilter === "ALL" ? true : p.pos === posFilter))
      .filter((p) => (showTaken ? true : !taken.has(p.id)))
      .filter((p) =>
        q
          ? p.name.toLowerCase().includes(q) ||
            p.team.toLowerCase().includes(q) ||
            p.pos.toLowerCase() === q
          : true
      )
      .sort((a, b) => blendedRank(a, settings.dsWeight) - blendedRank(b, settings.dsWeight));
  }, [board, posFilter, showTaken, taken, query, settings.dsWeight]);

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
    setOverrides(applyUpdates(PLAYERS, parsed.updates));
    setImportMsg(
      `Updated ${parsed.matched} players from your paste${
        parsed.unmatched.length ? `. Unmatched: ${parsed.unmatched.slice(0, 6).join(", ")}` : "."
      }`
    );
    setImportOpen(false);
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
      <header className="shrink-0 border-b border-white/8 bg-[#07140e]/95">
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/15 font-display text-lg tracking-wide text-primary">
              DS
            </div>
            <div>
              <p className="font-display text-xl leading-none tracking-wide">Draft Room</p>
              <p className="text-[11px] text-muted-foreground">
                FantasyPros × DraftSharks · Sept 1, 2026 snapshot
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
        {espn.live ? (
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
        ) : importMsg ? (
          <p className="border-t border-white/5 px-4 py-1.5 text-center text-xs text-primary">{importMsg}</p>
        ) : null}
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.2fr)_400px_340px] gap-4 p-4">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/8 bg-card/60">
          <div className="flex items-center gap-3 border-b border-white/8 p-3">
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search player, team, pos…"
              className="h-9 flex-1 bg-background/40"
              onKeyDown={(e) => {
                if (e.key === "Enter" && sortedBoard[0] && !taken.has(sortedBoard[0].id)) {
                  draftPlayer(sortedBoard[0].id);
                }
              }}
            />
            <div className="flex shrink-0 gap-1">
              {posFilterList().map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosFilter(p)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide",
                    posFilter === p
                      ? "bg-primary text-primary-foreground"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              Sorted by blended rank · FP {100 - settings.dsWeight}% / DS {settings.dsWeight}%
            </span>
            <label className="flex items-center gap-2">
              <Switch checked={showTaken} onCheckedChange={setShowTaken} />
              Show taken
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#0c1c14] text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Player</th>
                  <th className="px-2 py-2 font-medium">Pos</th>
                  <th className="px-2 py-2 font-medium">FP</th>
                  <th className="px-2 py-2 font-medium">DS</th>
                  <th className="px-2 py-2 font-medium">ADP</th>
                  <th className="px-2 py-2 font-medium">Gap</th>
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sortedBoard.slice(0, 220).map((p) => {
                  const gone = taken.has(p.id);
                  const starred = stars.includes(p.id);
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-t border-white/5 hover:bg-white/4",
                        gone && "opacity-40",
                        starred && !gone && "bg-gold/8"
                      )}
                    >
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                        {Math.round(blendedRank(p, settings.dsWeight))}
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
                            <p className="text-[11px] text-muted-foreground">
                              {p.team} · Bye {p.bye || "—"}
                              {p.tags.includes("sleeper") ? " · sleeper" : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <PosBadge pos={p.pos} />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{p.fpRank}</td>
                      <td className="px-2 py-2 font-mono text-xs">{p.dsRank}</td>
                      <td className="px-2 py-2 font-mono text-xs">{p.adp.toFixed(0)}</td>
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
          <div className="rounded-2xl border border-white/8 bg-card/70 p-4">
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
                    key={rec.player.id}
                    className="rounded-xl border border-white/8 bg-background/40 p-3"
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
                            {rec.player.team} · FP {rec.player.fpRank} · DS {rec.player.dsRank} · ADP{" "}
                            {rec.player.adp.toFixed(0)}
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
      <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
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
}) {
  if (done) return <Badge>Complete</Badge>;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm",
        isUserPick
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-white/10 bg-white/5"
      )}
    >
      <span className="font-display text-lg leading-none">{formatPick(overall, teams)}</span>
      <span className="text-xs">
        {isUserPick ? "Your pick" : `${teamLabel ?? `Team ${onClock}`}'s pick`}
        {!isUserPick && nextMine ? ` · ${untilUser} until you` : ""}
        <span className="ml-1 text-muted-foreground">(you are {slot})</span>
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
    <div className="rounded-2xl border border-white/8 bg-card/70 p-4">
      <h2 className="mb-3 font-display text-lg tracking-wide">Your roster</h2>
      {roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No picks yet. Set your slot, then draft or use Jump to me to practice the turn.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((pos) => {
            const here = roster.filter((p) => p.pos === pos);
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
                    {here.map((p) => (
                      <li key={p.id} className="flex items-center justify-between text-sm">
                        <span>
                          {p.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            {p.team} · bye {p.bye}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
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
      <p className="rounded-xl border border-white/8 p-4 text-sm text-muted-foreground">
        Live mode: click Taken on whoever comes off the board. Practice mode: Jump to me auto-picks the room by ADP until your turn.
      </p>
    );
  }
  const recent = [...picks].reverse().slice(0, 18);
  return (
    <ul className="space-y-1 rounded-xl border border-white/8 p-2">
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
                {mine ? " · you" : ` · T${pk.team}`}
              </span>
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
    <div className="rounded-xl border border-white/8 p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Where your two sources disagree. DS+ means DraftSharks is higher — often the value if he lasts. FP+ means FantasyPros is higher.
      </p>
      <ul className="space-y-2">
        {gaps.map(({ player }) => (
          <li key={player.id} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{player.name}</span>
                <PosBadge pos={player.pos} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                FP {player.fpRank} · DS {player.dsRank} · ADP {player.adp.toFixed(0)}
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

  const slot = settings.slot;
  const early = slot <= 3;
  const late = slot >= settings.teams - 2;

  return (
    <div className="space-y-3 rounded-xl border border-white/8 p-3 text-sm">
      <p>
        You are pick <span className="font-semibold text-primary">{slot}</span> in a {settings.teams}-team{" "}
        {settings.scoring.toUpperCase()} {settings.superflex ? "Superflex" : "1QB"}{" "}
        {settings.draftType === "linear" ? "linear" : "snake"}.
      </p>
      <ul className="space-y-2 text-muted-foreground">
        <li>
          {early
            ? "Lock Gibbs / Bijan / Chase. Do not overthink 1.01–1.03. Nacua is the DS smash if the room panics to RB."
            : late
              ? "The 1/2 turn is the whole draft. If Nacua, JSN, or ARSB slides, take the WR. If not, Cook / Achane / Hampton, then smash Walker, AJ Brown, or London coming back."
              : "Middle slots should take the last elite WR/RB and hunt Walker, AJ Brown, London, and Nico on the 2/3 turn — that's where FP and DS both find value."}
        </li>
        <li>
          {settings.superflex
            ? "Superflex: Josh Allen is a top-8 pick. Lamar/Maye belong in the 2nd. Do not leave the 4th without two QBs."
            : "1QB: wait on quarterback unless Allen falls to the 4th. DS ranks him #24 — that's a reach over Rice/McBride."}
        </li>
        <li>
          Tight end: Bowers or McBride through round 3. After that, Loveland/Warren/Kraft and stop thinking about it.
        </li>
        <li>
          Wednesday news to confirm before you click: Jeanty&apos;s leg, Nabers&apos; workload, Egbuka&apos;s toe, Love&apos;s ankle, Kraft practicing, Kamara (out).
        </li>
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
          <SheetTitle>League setup</SheetTitle>
          <SheetDescription>
            Match your draft. Rankings stay PPR-based; scoring tilts projections for VOR.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 pb-8">
          <Field label="Teams">
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={settings.teams}
              onChange={(e) => setSettings({ ...settings, teams: Number(e.target.value) })}
            >
              {[8, 10, 12, 14].map((n) => (
                <option key={n} value={n}>
                  {n} teams
                </option>
              ))}
            </select>
          </Field>
          <Field label="Your slot">
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={settings.slot}
              onChange={(e) => setSettings({ ...settings, slot: Number(e.target.value) })}
            >
              {Array.from({ length: settings.teams }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Pick {n}
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
          <label className="flex items-center justify-between gap-3 text-sm">
            Superflex
            <Switch
              checked={settings.superflex}
              onCheckedChange={(v) => setSettings({ ...settings, superflex: v })}
            />
          </label>
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
