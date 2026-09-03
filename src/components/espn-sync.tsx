"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Radio, Unplug } from "lucide-react";
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
  bookmarkletOrigin,
  buildBookmarklet,
  espnDraftRoomUrl,
  ESPN_LIVE_LOBBY,
  ESPN_MOCK_LOBBY,
  extrasFromMapped,
  isLoopbackOrigin,
  matchByName,
  parseEspnPickLog,
  patchSettingsFromEspnMeta,
  remapMappedPicks,
  stubFromEspn,
  type EspnIngestMeta,
  type EspnLeagueInfo,
  type MappedEspnPick,
} from "@/lib/espn";
import type { DraftPick, LeagueSettings, Player } from "@/lib/types";
import { cn } from "@/lib/utils";

const AUTH_KEY = "draft-room-espn-auth";
const CONN_KEY = "draft-room-espn-conn";
const RELAY_URL = "https://ntfy.sh/drjfl28jackal";

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
  return remapMappedPicks(mapped).map((p) => ({
    overall: p.overall,
    team: p.team,
    playerId: p.playerId,
  }));
}

/** React 19 strips javascript: hrefs. Put the script on the drag payload, not only the href. */
function BookmarkletAnchor({
  bookmarklet,
  className,
  title,
  onClick,
  children,
}: {
  bookmarklet: string;
  className?: string;
  title?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const pinHref = () => {
    const el = ref.current;
    if (!el || !bookmarklet.startsWith("javascript:")) return;
    el.setAttribute("href", bookmarklet);
  };
  useLayoutEffect(() => {
    pinHref();
  }, [bookmarklet]);
  return (
    <a
      ref={ref}
      href="#"
      draggable
      title={title}
      onMouseDown={pinHref}
      onDragStart={(e) => {
        pinHref();
        e.dataTransfer.setData("text/uri-list", bookmarklet);
        e.dataTransfer.setData("text/plain", bookmarklet);
        e.dataTransfer.setData("text/x-moz-url", `${bookmarklet}\nSync ESPN`);
      }}
      onClick={onClick}
      className={className}
    >
      {children}
    </a>
  );
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
  onPicksFromEspn: (picks: DraftPick[], extras: Player[], settingsPatch?: LeagueSettings) => void;
  status: EspnLiveStatus;
  setStatus: (s: EspnLiveStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [league, setLeague] = useState("");
  const [season, setSeason] = useState(2026);
  const [swid, setSwid] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [info, setInfo] = useState<EspnLeagueInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"bookmark" | null>(null);
  const [pasteLog, setPasteLog] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [ingestHint, setIngestHint] = useState<string | null>(null);
  const [publicOrigin, setPublicOrigin] = useState("");
  const [relayUrl, setRelayUrl] = useState("");

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

  const pageOrigin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const origin = bookmarkletOrigin(pageOrigin, publicOrigin) || pageOrigin || "http://127.0.0.1:43173";
  const bookmarkHref = buildBookmarklet(origin, RELAY_URL);
  const ingestUrl = origin ? `${origin}/api/espn/ingest` : "";
  const ingestIsLocal = origin ? isLoopbackOrigin(origin) : false;
  const draftRoomUrl = settings.espnLeagueId
    ? espnDraftRoomUrl(settings.espnLeagueId, season)
    : "";

  const persistAuth = (next: Auth) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(next));
  };

  const openSheet = () => {
    const auth = readAuth();
    setSwid(auth.swid);
    setEspnS2(auth.espnS2);
    const saved = readConn();
    setLeague(saved?.leagueId || settings.espnLeagueId || "");
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
      const remapped = remapMappedPicks(json.picks);
      const picks = mappedToDraft(remapped);
      onPicksRef.current(picks, json.extras ?? extrasFromMapped(remapped));
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
        meta?: EspnIngestMeta;
        reason?: string;
        publicOrigin?: string;
        ingestUrl?: string;
        relayUrl?: string;
        connected?: boolean;
      };
      if (typeof json.publicOrigin === "string" && json.publicOrigin) {
        setPublicOrigin(json.publicOrigin);
      }
      if (typeof json.relayUrl === "string" && json.relayUrl) {
        setRelayUrl(json.relayUrl);
      }
      if (!json.ingest || !json.picks?.length) {
        const meta = json.meta ?? {};
        if (json.connected || meta.leagueName || meta.leagueId) {
          const label = meta.leagueName || `League ${meta.leagueId}`;
          const nextSettings = patchSettingsFromEspnMeta(settingsRef.current, meta);
          const waitSig = `wait:${meta.leagueId ?? ""}:${meta.slot ?? ""}:${meta.teams ?? ""}`;
          if (listenSig.current !== waitSig) {
            listenSig.current = waitSig;
            onPicksRef.current([], [], nextSettings);
          }
          setIngestHint(`Connected to ${label}. ESPN has not filled a pick yet.`);
          setStatus({
            live: true,
            source: "room-capture",
            pickCount: 0,
            leagueName: label,
          });
          return;
        }
        const why = json.reason || meta.reason;
        if (why) setIngestHint(why);
        else setIngestHint(null);
        if (listenSig.current || statusRef.current.source === "room-capture") {
          listenSig.current = "";
          onPicksRef.current([], [], settingsRef.current);
          setStatus({ live: false, source: "empty", pickCount: 0 });
        }
        return;
      }
      const meta = json.meta ?? {};
      const label =
        meta.leagueName ||
        (meta.leagueId ? `League ${meta.leagueId}` : "this ESPN draft");
      setIngestHint(
        `${json.count} pick${json.count === 1 ? "" : "s"} from ${label}${
          meta.teams ? ` · ${meta.teams} teams` : ""
        }.`,
      );
      const sig = [
        json.picks.map((p) => `${p.overall}:${p.playerId}`).join("|"),
        meta.leagueId ?? "",
        String(meta.teams ?? ""),
        String(meta.slot ?? meta.teamId ?? ""),
      ].join("#");
      if (sig === listenSig.current && statusRef.current.live) return;
      listenSig.current = sig;
      const remapped = remapMappedPicks(json.picks);
      const nextSettings = patchSettingsFromEspnMeta(settingsRef.current, meta);
      onPicksRef.current(
        mappedToDraft(remapped),
        json.extras ?? extrasFromMapped(remapped),
        nextSettings,
      );
      setStatus({
        live: true,
        source: "room-capture",
        pickCount: json.picks.length,
        leagueName: label,
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

  useEffect(() => {
    void fetch("/api/espn/ingest", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ publicOrigin?: string; relayUrl?: string }>)
      .then((json) => {
        if (typeof json.publicOrigin === "string" && json.publicOrigin) {
          setPublicOrigin(json.publicOrigin);
        }
        if (typeof json.relayUrl === "string" && json.relayUrl) {
          setRelayUrl(json.relayUrl);
        }
      })
      .catch(() => {
        /* listen poll will retry */
      });
  }, []);

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
            id: playerId,
            espnId: 0,
            name: p.playerName,
            pos: "WR",
            team: "FA",
            overall: p.overallPickNumber,
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

  const copyText = async (value: string, which: "bookmark") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Clipboard blocked. Select the URL and copy it yourself.");
    }
  };

  return (
    <>
      <BookmarkletAnchor
        bookmarklet={bookmarkHref}
        title={
          ingestUrl
            ? `Drag onto the bookmarks bar, then click it on ESPN. Posts to ${ingestUrl}`
            : "Drag this onto the bookmarks bar, then click it on the ESPN draft tab."
        }
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
      </BookmarkletAnchor>
      <a
        href={ESPN_MOCK_LOBBY}
        target="_blank"
        rel="noopener noreferrer"
        title="Open ESPN mock draft lobby"
        className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground no-underline hover:bg-accent"
      >
        <ExternalLink className="size-3.5" />
        ESPN drafts
      </a>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (typeof next === "boolean") setOpen(next);
        }}
      >
        <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>Sync any ESPN draft</SheetTitle>
            <SheetDescription>
              Clicking Sync ESPN in Draft Room only opens this help. Sync runs when you click the
              bookmark on the ESPN draft tab. No green badge on ESPN means that bookmark did not
              run — delete it, drag this chip to the bookmarks bar, then click it on ESPN.
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
                  Chrome often saves a drag as <span className="font-mono">#</span>, which does
                  nothing on ESPN (no green badge). Copy the script, then add a bookmark whose URL
                  is the paste. Or drag after this page has fully loaded.
                </p>
                <BookmarkletAnchor
                  bookmarklet={bookmarkHref}
                  onClick={(e) => e.preventDefault()}
                  title={ingestUrl ? `Posts to ${ingestUrl}` : undefined}
                  className="mt-3 inline-flex cursor-grab items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground no-underline shadow-sm active:cursor-grabbing"
                >
                  <Radio className="size-4" />
                  Sync ESPN
                </BookmarkletAnchor>
                {ingestUrl ? (
                  <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                    Ingest URL: {ingestUrl}
                  </p>
                ) : null}
                {relayUrl ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Live picks also go through a public relay so ESPN on your PC can reach this board.
                  </p>
                ) : null}
                {ingestIsLocal ? (
                  <p className="mt-1 text-xs text-destructive">
                    Direct ingest is localhost. Re-drag this chip so the bookmark includes the relay
                    — otherwise ESPN on your PC cannot reach Draft Room.
                  </p>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  onClick={() => void copyText(bookmarkHref, "bookmark")}
                >
                  {copied === "bookmark" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied === "bookmark" ? "Copied — paste as the bookmark URL" : "Copy Sync ESPN script"}
                </Button>
                <textarea
                  readOnly
                  value={bookmarkHref}
                  className="mt-2 h-16 w-full resize-none rounded-lg border border-border bg-muted/40 p-2 font-mono text-[10px] leading-relaxed"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Chrome → Ctrl+Shift+B → right-click the bar → Add page → Name: Sync ESPN → URL:
                  paste the script → Save. Then click that bookmark on the ESPN draft tab.
                </p>
              </li>
              <li className="rounded-xl border border-border bg-card p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  2 · Click it on the live ESPN tab
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Stay on the ESPN draft or mock tab (any league size). Click{" "}
                  <span className="font-medium text-foreground">Sync ESPN</span> in your bookmarks
                  bar. A green badge appears on that page. Leave it open — Draft Room follows that
                  room, including league ID, team count, and your slot when the URL has teamId.
                </p>
                <div className="mt-3 grid gap-2">
                  <a
                    href={ESPN_MOCK_LOBBY}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground no-underline"
                  >
                    <ExternalLink className="size-4" />
                    ESPN mock lobby
                  </a>
                  <a
                    href={ESPN_LIVE_LOBBY}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground no-underline hover:bg-accent"
                  >
                    <ExternalLink className="size-4" />
                    ESPN live draft lobby
                  </a>
                  {settings.espnLeagueId ? (
                    <a
                      href={draftRoomUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Open current league draft room
                    </a>
                  ) : null}
                </div>
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
