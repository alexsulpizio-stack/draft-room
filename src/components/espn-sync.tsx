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
  useEffect(() => {
    statusRef.current = status;
    onPicksRef.current = onPicksFromEspn;
    settingsRef.current = settings;
  });

  const bookmarklet =
    open && typeof window !== "undefined" ? buildBookmarklet(window.location.origin) : "";

  const persistAuth = (next: Auth) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(next));
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
      setSettings({ ...json.league.settings, dsWeight: settings.dsWeight, slot: json.league.suggestedSlot });
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
    setStatus({ live: false, source: "empty", pickCount: 0 });
  };

  const inflight = useRef(false);
  const poll = useCallback(async () => {
    const conn = readConn();
    if (!conn?.live || !conn.leagueId) return;
    if (inflight.current) return;
    inflight.current = true;
    const auth = readAuth();
    try {
      const res = await fetch("/api/espn/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: conn.leagueId,
          season: conn.season,
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
          leagueName: conn.leagueName,
        });
        return;
      }
      if (json.picks.length === 0) {
        setStatus({
          live: true,
          source: json.source ?? "empty",
          pickCount: statusRef.current.pickCount,
          warning: json.warning,
          leagueName: conn.leagueName,
        });
        return;
      }
      const picks: DraftPick[] = json.picks.map((p) => ({
        overall: p.overall,
        team: p.team,
        playerId: p.playerId,
      }));
      onPicksRef.current(picks, json.extras ?? extrasFromMapped(json.picks));
      setStatus({
        live: true,
        source: json.source ?? "espn-api",
        pickCount: picks.length,
        warning: json.warning,
        leagueName: conn.leagueName,
      });
    } catch {
      setStatus({
        live: true,
        source: statusRef.current.source,
        pickCount: statusRef.current.pickCount,
        warning: "Lost contact with the ESPN proxy. Retrying…",
        leagueName: conn.leagueName,
      });
    } finally {
      inflight.current = false;
    }
  }, [setStatus]);

  useEffect(() => {
    if (!conn?.live) return;
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [conn?.live, poll]);

  const applyPaste = () => {
    const raw = parseEspnPickLog(pasteLog, settings.teams);
    if (!raw.length) {
      setError(
        "Could not read that pick log. Use lines like 1.01 Jahmyr Gibbs or 2. Ja'Marr Chase, WR, CIN."
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
          })
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
    if (!status.live) {
      setStatus({
        live: true,
        source: "room-capture",
        pickCount: picks.length,
        warning: "Using a pasted pick log. Connect the league so ESPN team slots stay aligned.",
      });
    }
  };

  const copyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard blocked. Select the bookmarklet link and drag it to your bookmarks bar.");
    }
  };

  return (
    <>
      <Button
        variant={status.live ? "default" : "outline"}
        size="sm"
        onClick={() => {
          const auth = readAuth();
          setSwid(auth.swid);
          setEspnS2(auth.espnS2);
          const saved = readConn();
          setLeague(saved?.leagueId || settings.espnLeagueId || "1361349772");
          setSeason(saved?.season || 2026);
          setOpen(true);
        }}
        className={cn(status.live && "bg-primary text-primary-foreground")}
      >
        <Radio className={cn(status.live && "animate-live-pulse")} />
        {status.live ? `ESPN · ${status.pickCount}` : "ESPN"}
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (typeof next === "boolean") setOpen(next);
        }}
      >
        <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>ESPN live draft</SheetTitle>
            <SheetDescription>
              JFL 28 is ESPN league 1361349772 (private). Paste SWID and espn_s2, then Connect. During
              the live room, run the bookmarklet on the ESPN draft tab — mDraftDetail often stays empty
              until the draft ends.
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
            <div className="grid gap-3 rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Private leagues need cookies from fantasy.espn.com — Application → Cookies in Chrome.
                They stay in this browser and are only forwarded to ESPN.
              </p>
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
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={connect} disabled={busy || !league.trim()}>
                {busy ? "Connecting…" : status.live ? "Reconnect" : "Connect ESPN"}
              </Button>
              {status.live ? (
                <Button variant="outline" onClick={disconnect}>
                  <Unplug /> Disconnect
                </Button>
              ) : null}
            </div>

            {info || settings.teamNames.length ? (
              <label className="grid gap-1 text-sm">
                <span>Your ESPN team</span>
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

            <div className="grid gap-2 rounded-xl border border-border p-3">
              <Label>Live room bookmarklet</Label>
              <p className="text-xs text-muted-foreground">
                ESPN often does not publish <span className="font-mono">mDraftDetail</span> until the draft
                ends. Drag this to your bookmarks bar, then click it on the ESPN draft tab. A green chip
                will sit on that page and POST every pick here.
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={bookmarklet || undefined}
                  className="inline-flex h-8 items-center rounded-lg border border-primary/40 bg-primary/10 px-3 text-sm text-primary"
                  onClick={(e) => e.preventDefault()}
                >
                  Sync Draft Room
                </a>
                <Button variant="outline" size="sm" onClick={copyBookmarklet} disabled={!bookmarklet}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy bookmarklet"}
                </Button>
              </div>
            </div>

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
        </SheetContent>
      </Sheet>
    </>
  );
}
