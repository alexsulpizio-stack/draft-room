"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RelayKind } from "@/lib/leftover-tests";

type Peek = {
  espnLastAt: number | null;
  espnLastKind: RelayKind;
  espnPickCount: number;
  ranksLastAt: number | null;
  ranksLastKind: RelayKind;
  ranksCount: number;
};

function ago(ts: number | null): string {
  if (!ts) return "none";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

function label(kind: RelayKind, count: number): string {
  if (kind === "leftover-test") return "leftover ignored";
  if (kind === "ping" || kind === "heartbeat") return "ping";
  if (kind === "picks") return `${count} picks`;
  if (kind === "fp" || kind === "ds") return `${kind.toUpperCase()} ${count}`;
  return "none";
}

export function RelayPulse() {
  const [peek, setPeek] = useState<Peek | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/relay/status", { cache: "no-store" });
      const json = (await res.json()) as Peek & { ok?: boolean };
      if (json && (json.espnLastAt !== undefined || json.ranksLastAt !== undefined)) {
        setPeek(json);
        setErr(null);
      }
    } catch {
      /* next tick */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(t);
  }, [load]);

  const test = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/relay/status", { method: "POST" });
      const json = (await res.json()) as Peek & {
        ok?: boolean;
        espnPosted?: boolean;
        ranksPosted?: boolean;
      };
      setPeek(json);
      if (!json.espnPosted && !json.ranksPosted) {
        setErr("ntfy busy (rate limit) — wait ~1 min");
      }
    } catch {
      setErr("relay test failed");
    } finally {
      setBusy(false);
    }
  };

  const espn = peek
    ? `ESPN ${label(peek.espnLastKind, peek.espnPickCount)} · ${ago(peek.espnLastAt)}`
    : "ESPN …";
  const ranks = peek
    ? `FP/DS ${label(peek.ranksLastKind, peek.ranksCount)} · ${ago(peek.ranksLastAt)}`
    : "FP/DS …";

  return (
    <span className="hidden items-center gap-1 sm:inline-flex">
      <span
        className="rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
        title="Last ntfy message Draft Room saw. Leftover agent test posts are ignored and never mark players taken. Click Test to ping ntfy from this VM (0 picks)."
      >
        Relay · {espn} · {ranks}
        {err ? ` · ${err}` : ""}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[10px]"
        disabled={busy}
        onClick={() => void test()}
        title="Post a 0-pick ping to ntfy and confirm Draft Room receives it. Does not mark anyone taken."
      >
        {busy ? "Testing…" : "Test relay"}
      </Button>
    </span>
  );
}
