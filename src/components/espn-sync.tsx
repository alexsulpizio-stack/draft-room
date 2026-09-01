"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Copy, Radio, Unplug } from "lucide-react";
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
import { pickOwner } from "@/lib/draft";
import {
  buildBookmarklet,
  ESPN_FANTASY_ORIGIN,
  extrasFromMapped,
  matchByName,
  parseEspnPickLog,
  stubFromEspn,
  type EspnLeagueInfo,
  type MappedEspnPick,
} from "@/lib/espn";
import type { DraftPick, LeagueSettings, Player } from "@/lib/types";
import { cn } from "@/lib/utils";

const AUTH_KEY = "draft-room-espn-auth";
const CONN_KEY = "draft-room-espn-conn";

type Auth = { swid: string; espnS2: string };
type Conn = {
  leagueId: string;
  season: number;
  leagueName: string;
  live: boolean;
};

function readAuth(): Auth {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTH_KEY) ?? "{}") as Partial<Auth>;
    return { swid: parsed.swid ?? "", espnS2: parsed.espnS2 ?? "" };
  } catch {
    return { swid: "", espnS2: "" };
  }
}

function readConn(): Conn | null {
  try {
    const raw = localStorage.getItem(CONN_KEY);
    return raw ? (JSON.parse(raw) as Conn) : null;
  } catch {
    return null;
  }
}

function getConnSnap() {
  try {
    return localStorage.getItem(CONN_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribeConn(cb: () => void) {
  const on = () => cb();
  window.addEventListener("storage", on);
  window.addEventListener("espn-conn", on);
  return () => {
    window.removeEventListener("storage", on);
    window.removeEventListener("espn-conn", on);
  };
}

function writeConn(next: Conn | null) {
  if (!next) localStorage.removeItem(CONN_KEY);
  else localStorage.setItem(CONN_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("espn-conn"));
}

function mappedToDraft(mapped: MappedEspnPick[]): DraftPick[] {
  return mapped.map((p) => ({
    overall: p.overall,
    team: p.team,
    playerId: p.playerId,
  }));
}

export type EspnLiveStatus = {
  live: boolean;
  source: string;
  pickCount: number;
  warning?: string;
  leagueName?: string;
};

export function EspnSync({
  settings,
  setSettings,
  onPicksFromEspn,
  status,
  setStatus,
}: {
  settings: LeagueSettings;
  setSettings: (s: LeagueSettings) => void;
  onPicksFromEspn: (picks: DraftPick[], extras: Player[]) => void;
  status: EspnLiveStatus;
  setStatus: (s: EspnLiveStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [league, setLeague] = useState("1361349772");
  const [season, setSeason] = useState(2026);
  const [swid, setSwid] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [info, setInfo] = useState<EspnLeagueInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasteLog, setPasteLog] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [ingestHint, setIngestHint] = useState<string | null>(null);

  const connRaw = useSyncExternalStore(subscribeConn, getConnSnap, () => "");
  const conn = useMemo(() => {
    if (!connRaw) return null;
    try {
      return JSON.parse(connRaw) as Conn;
    } catch {
      return null;
    }
  }, [connRaw]);

  const statusRef = useRef(status);
  const onPicksRef = useRef(onPicksFromEspn);
  const settingsRef = useRef(settings);
  const listenSig = useRef("");
  useEffect(() => {
    statusRef.current = status;
    onPicksRef.current = onPicksFromEspn;
    settingsRef.current = settings;
  });

  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const bookmarkHref = origin ? buildBookmarklet(origin, settings.teams) : "javascript:void(0)";

  const persistAuth = (next: Auth) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(next));
  };

  const openSheet = () => {
    const auth = readAuth();
    setSwid(auth.swid);
    setEspnS2(auth.espnS2);
    const saved = readConn();
    setLeague(saved?.leagueId || settings.espnLeagueId || "1361349772");
    setSeason(saved?.season || 2026);
    setOpen(true);
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      persistAuth({ swid, espnS2 });
      const res = await fetch("/api/espn/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league,
          season,
          swid,
          espnS2,
          dsWeight: settings.dsWeight,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        needAuth?: boolean;
        warning?: string;
        league?: EspnLeagueInfo;
      };
      if (!json.ok || !json.league) {
        setError(json.error ?? "Could not connect to that ESPN league.");
        setStatus({ live: false, source: "empty", pickCount: 0 });
        writeConn(null);
        return;
      }
      setInfo(json.league);
      setSettings({
        ...json.league.settings,
        dsWeight: settings.dsWeight,
        slot: json.league.suggestedSlot,
      });
      writeConn({
        leagueId: json.league.leagueId,
        season: json.league.season,
        leagueName: json.league.name,
        live: true,
      });
      setStatus({
        live: true,
        source: json.league.apiPickCount ? "espn-api" : "empty",
        pickCount: json.league.apiPickCount,
        warning: json.warning,
        leagueName: json.league.name,
      });
    } catch {
      setError("Network error talking to the ESPN proxy.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    writeConn(null);
    setInfo(null);
    listenSig.current = "";
    setStatus({ live: false, source: "empty", pickCount: 0 });
  };

  const inflight = useRef(false);
  const pollDraft = useCallback(async () => {
    const liveConn = readConn();
    if (!liveConn?.live || !liveConn.leagueId) return;
    if (inflight.current) return;
    inflight.current = true;
    const auth = readAuth();
    try {
      const res = await fetch("/api/espn/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: liveConn.leagueId,
          season: liveConn.season,
          swid: auth.swid,
          espnS2: auth.espnS2,
          dsWeight: settingsRef.current.dsWeight,
          teams: settingsRef.current.teams,
          draftType: settingsRef.current.draftType,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        source?: string;
        warning?: string;
        picks?: MappedEspnPick[];
        extras?: Player[];
      };
      if (!json.ok || !json.picks) {
        setStatus({
          live: true,
          source: "empty",
          pickCount: statusRef.current.pickCount,
          warning: json.error,
          leagueName: liveConn.leagueName,
        });
        return;
      }
      if (json.picks.length === 0) {
        setStatus({
          live: true,
          source: json.source ?? "empty",
          pickCount: statusRef.current.pickCount,
          warning: json.warning,
          leagueName: liveConn.leagueName,
        });
        return;
      }
      const picks = mappedToDraft(json.picks);
      onPicksRef.current(picks, json.extras ?? extrasFromMapped(json.picks));
      setStatus({
        live: true,
        source: json.source ?? "espn-api",
        pickCount: picks.length,
        warning: json.warning,
        leagueName: liveConn.leagueName,
      });
    } catch {
      setStatus({
        live: true,
        source: statusRef.current.source,
        pickCount: statusRef.current.pickCount,
        warning: "Lost contact with the ESPN proxy. Retrying…",
        leagueName: liveConn.leagueName,
      });
    } finally {
      inflight.current = false;
    }
  }, [setStatus]);

  const pollListen = useCallback(async () => {
    try {
      const res = await fetch(`/api/espn/listen?teams=${settingsRef.current.teams}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ingest?: boolean;
        count?: number;
        href?: string;
        picks?: MappedEspnPick[];
        extras?: Player[];
      };
      if (!json.ingest || !json.picks?.length) {
        if (!json.ingest) setIngestHint(null);
        return;
      }
      setIngestHint(
        `${json.count} pick${json.count === 1 ? "" : "s"} from the ESPN tab${
          json.href ? "" : ""
        }.`,
      );
      if (readConn()?.live) return;
      const sig = json.picks.map((p) => `${p.overall}:${p.playerId}`).join("|");
      if (sig === listenSig.current && statusRef.current.live) return;
      listenSig.current = sig;
      onPicksRef.current(mappedToDraft(json.picks), json.extras ?? extrasFromMapped(json.picks));
      setStatus({
        live: true,
        source: "room-capture",
        pickCount: json.picks.length,
        leagueName: "ESPN draft tab",
      });
    } catch {
      /* next tick */
    }
  }, [setStatus]);

  useEffect(() => {
    if (!conn?.live) return;
    void pollDraft();
    const t = setInterval(() => void pollDraft(), 2000);
    return () => clearInterval(t);
  }, [conn?.live, pollDraft]);

  useEffect(() => {
    const kick = window.setTimeout(() => void pollListen(), 0);
    const t = window.setInterval(() => void pollListen(), 2500);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(t);
    };
  }, [pollListen]);

  const applyPaste = () => {
    const raw = parseEspnPickLog(pasteLog, settings.teams);
    if (!raw.length) {
      setError(
        "Could not read that pick log. Use lines like 1.01 Jahmyr Gibbs or 2. Ja'Marr Chase, WR, CIN.",
      );
      return;
    }
    const extras: Player[] = [];
    const picks: DraftPick[] = raw.map((p) => {
      const ours = p.playerName ? matchByName(p.playerName) : undefined;
      const playerId = ours?.id ?? `espn-log-${p.overallPickNumber}`;
      if (!ours && p.playerName) {
        extras.push(
          stubFromEspn({
            espnId: p.overallPickNumber,
            name: p.playerName,
            pos: "WR",
            team: "FA",
          }),
        );
      }
      return {
        overall: p.overallPickNumber,
        team: pickOwner(p.overallPickNumber, settings.teams, settings.draftType ?? "snake"),
        playerId,
      };
    });
    onPicksFromEspn(picks, extras);
    void fetch("/api/espn/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: raw, href: "paste", ts: Date.now() }),
    });
    setPasteLog("");
    setError(null);
    setIngestHint(`Imported ${picks.length} picks from pasted log.`);
    if (!status.live) {
      setStatus({
        live: true,
        source: "room-capture",
        pickCount: picks.length,
        warning: undefined,
        leagueName: "Pasted pick log",
      });
    }
  };

  const copyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkHref);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard blocked. Drag the Sync ESPN chip to your bookmarks bar instead.");
    }
  };

  return (
    <>
      <a
        href={bookmarkHref}
        draggable
        title="Drag this onto the bookmarks bar, then click it on the ESPN draft tab. Click here for the two-step setup."
        onClick={(e) => {
          e.preventDefault();
          openSheet();
        }}
        className={cn(
          "inline-flex h-8 cursor-grab items-center gap-1.5 rounded-full px-3 text-xs font-semibold no-underline shadow-sm active:cursor-grabbing",
          status.live
            ? "bg-primary text-primary-foreground"
            : "border border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        <Radio className={cn("size-3.5", status.live && "animate-live-pulse")} />
        {status.live ? `Sync ESPN · ${status.pickCount}` : "Sync ESPN"}
      </a>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (typeof next === "boolean") setOpen(next);
        }}
      >
        <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>Two steps to live ESPN</SheetTitle>
            <SheetDescription>
              No cookies. Drag the chip to your bookmarks bar, then click it on the ESPN draft tab.
              Draft Room listens automatically.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4 pb-10">
            {status.live ? (
              <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{status.leagueName ?? "Connected"}</span>
                  <Badge variant="outline">
                    {status.source === "room-capture"
                      ? "Room capture"
                      : status.source === "espn-api"
                        ? "ESPN API"
                        : "Waiting"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status.pickCount} picks synced
                  {status.warning ? ` · ${status.warning}` : ""}
                </p>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <ol className="grid gap-3">
              <li className="rounded-xl border border-border bg-card p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  1 · Save this
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Drag the green chip onto the bookmarks bar. Press Ctrl+Shift+B if the bar is hidden.
                </p>
                <a
                  href={bookmarkHref}
                  draggable
                  onClick={(e) => e.preventDefault()}
                  className="mt-3 inline-flex cursor-grab items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground no-underline shadow-sm active:cursor-grabbing"
                >
                  <Radio className="size-4" />
                  Sync ESPN
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 px-2 text-[11px]"
                  onClick={() => void copyBookmarklet()}
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy instead"}
                </Button>
              </li>
              <li className="rounded-xl border border-border bg-card p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  2 · Click it on ESPN
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Open{" "}
                  <a
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    href={`${ESPN_FANTASY_ORIGIN}/football/draft?leagueId=1361349772`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    your JFL 28 draft tab
                  </a>
                  , then click <span className="font-medium text-foreground">Sync ESPN</span>. A
                  green badge appears on that page. Leave the tab open — Draft Room pulls picks every
                  few seconds after the first send.
                </p>
                {ingestHint ? (
                  <p className="mt-2 text-xs font-medium text-primary">{ingestHint}</p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">Waiting for the first sync…</p>
                )}
              </li>
            </ol>

            <div>
              <button
                type="button"
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                onClick={() => setAdvanced((v) => !v)}
              >
                {advanced ? "Hide" : "Show"} cookies & paste (optional)
              </button>
              {advanced ? (
                <div className="mt-3 grid gap-4">
                  <p className="text-xs text-muted-foreground">
                    Cookies let Draft Room poll ESPN without clicking the bookmark. Only needed if
                    the bookmark is blocked. They stay in this browser and are only forwarded to ESPN.
                  </p>
                  <label className="grid gap-1 text-sm">
                    <span>League URL or ID</span>
                    <Input
                      value={league}
                      onChange={(e) => setLeague(e.target.value)}
                      placeholder="1361349772"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>Season</span>
                    <Input
                      type="number"
                      value={season}
                      onChange={(e) => setSeason(Number(e.target.value) || 2026)}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>SWID</span>
                    <Input
                      value={swid}
                      onChange={(e) => setSwid(e.target.value)}
                      placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                      autoComplete="off"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>espn_s2</span>
                    <Input
                      type="password"
                      value={espnS2}
                      onChange={(e) => setEspnS2(e.target.value)}
                      placeholder="AEF…"
                      autoComplete="off"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void connect()} disabled={busy || !league.trim()}>
                      {busy ? "Connecting…" : status.source === "espn-api" ? "Reconnect" : "Connect API"}
                    </Button>
                    {conn?.live ? (
                      <Button variant="outline" onClick={disconnect}>
                        <Unplug /> Disconnect
                      </Button>
                    ) : null}
                  </div>
                  {info || settings.teamNames.length ? (
                    <label className="grid gap-1 text-sm">
                      <Label>Your ESPN team</Label>
                      <select
                        className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                        value={settings.slot}
                        onChange={(e) => setSettings({ ...settings, slot: Number(e.target.value) })}
                      >
                        {info
                          ? info.teams.map((t) => (
                              <option key={t.id} value={t.slot}>
                                {t.slot}. {t.name}
                              </option>
                            ))
                          : settings.teamNames.map((name, i) => (
                              <option key={name + i} value={i + 1}>
                                {i + 1}. {name}
                              </option>
                            ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="grid gap-2">
                    <Label>Or paste ESPN pick history</Label>
                    <textarea
                      value={pasteLog}
                      onChange={(e) => setPasteLog(e.target.value)}
                      placeholder={"1.01 Jahmyr Gibbs\n1.02 Puka Nacua\n2. Ja'Marr Chase, WR, CIN"}
                      className="min-h-28 w-full rounded-xl border border-input bg-background p-3 font-mono text-xs"
                    />
                    <Button variant="outline" onClick={applyPaste} disabled={!pasteLog.trim()}>
                      Ingest pick log
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
