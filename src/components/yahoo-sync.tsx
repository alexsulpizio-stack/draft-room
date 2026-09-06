"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DraftPick } from "@/lib/types";

type YahooStatus = {
  connected: boolean;
  count: number;
  unmatched: number;
  ts?: number | null;
  bookmarklet?: string;
  ingestUrl?: string;
  mode?: "direct";
};

export function YahooSync({
  onPicks,
}: {
  onPicks: (picks: DraftPick[]) => void;
}) {
  const [status, setStatus] = useState<YahooStatus>({
    connected: false,
    count: 0,
    unmatched: 0,
  });
  const [bookmarklet, setBookmarklet] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/yahoo/ingest", { cache: "no-store" });
      const json = (await response.json()) as YahooStatus & {
        ok?: boolean;
        draftPicks?: DraftPick[];
      };
      if (!response.ok || json.ok === false) throw new Error("Yahoo ingest unavailable");
      setStatus(json);
      if (json.bookmarklet?.startsWith("javascript:")) setBookmarklet(json.bookmarklet);
      setError("");
      if (json.connected && json.draftPicks) onPicks(json.draftPicks);
    } catch {
      setError("Yahoo ingest unavailable — retrying");
    }
  }, [onPicks]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(timer);
  }, [poll]);

  const copy = async () => {
    if (!bookmarklet) return;
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy failed — select the script manually");
    }
  };

  const age = status.ts ? Math.max(0, Math.round((Date.now() - status.ts) / 1000)) : null;
  const health = status.connected
    ? `Connected · ${status.count} picks${age == null ? "" : ` · ${age}s ago`}`
    : error || "Waiting for Yahoo";

  return (
    <div className="space-y-2 rounded-xl border border-[#5f259f]/30 bg-[#5f259f]/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Yahoo live sync
        </p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.connected ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}`}>
          {health}
        </span>
        {status.unmatched ? (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-700">
            {status.unmatched} unmatched
          </span>
        ) : null}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Direct mode: keep Draft Room and Yahoo Fantasy open on the same computer. Install the
        bookmarklet on the Yahoo tab; no public relay is used.
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={bookmarklet || "#"}
          draggable
          onClick={(event) => event.preventDefault()}
          onDragStart={(event) => {
            if (!bookmarklet) return;
            event.dataTransfer.setData("text/uri-list", bookmarklet);
            event.dataTransfer.setData("text/plain", bookmarklet);
          }}
          className="inline-flex cursor-grab items-center gap-1.5 rounded-full bg-[#5f259f] px-3 py-1.5 text-xs font-semibold text-white no-underline"
        >
          <Radio className="size-3.5" />
          Sync Yahoo
        </a>
        <Button type="button" size="sm" variant="outline" disabled={!bookmarklet} onClick={() => void copy()}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy script"}
        </Button>
      </div>
      {bookmarklet ? (
        <textarea
          readOnly
          value={bookmarklet}
          onFocus={(event) => event.currentTarget.select()}
          className="h-14 w-full resize-none rounded-lg border border-border bg-background p-2 font-mono text-[10px]"
        />
      ) : null}
    </div>
  );
}
