"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check, Copy, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookmarkletOrigin, isLoopbackOrigin } from "@/lib/espn";
import { buildRanksBookmarklet } from "@/lib/ranks-bookmarklet";
import type { RankImportSource } from "@/lib/parse-import";
import { cn } from "@/lib/utils";

function BookmarkletAnchor({
  bookmarklet,
  className,
  title,
  dragLabel,
  onClick,
  children,
}: {
  bookmarklet: string;
  className?: string;
  title?: string;
  dragLabel: string;
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
        e.dataTransfer.setData("text/x-moz-url", `${bookmarklet}\n${dragLabel}`);
      }}
      onClick={onClick}
      className={className}
    >
      {children}
    </a>
  );
}

export function RanksLiveSyncPanel({
  source,
  liveMatched,
  liveAt,
}: {
  source: RankImportSource;
  liveMatched?: number;
  liveAt?: number;
}) {
  const [pageOrigin, setPageOrigin] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPageOrigin(window.location.origin);
    void fetch("/api/ranks/ingest", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ publicOrigin?: string }>)
      .then((json) => {
        if (typeof json.publicOrigin === "string" && json.publicOrigin) {
          setPublicOrigin(json.publicOrigin);
        }
      })
      .catch(() => {});
  }, []);

  const origin =
    bookmarkletOrigin(pageOrigin, publicOrigin) ||
    pageOrigin ||
    "http://127.0.0.1:43173";
  const bookmarkHref = useMemo(
    () => buildRanksBookmarklet(origin, source),
    [origin, source],
  );
  const loopback = isLoopbackOrigin(origin);
  const label = source === "ds" ? "Sync DS ranks" : "Sync FP ranks";
  const hostHint =
    source === "ds"
      ? "draftsharks.com Draft War Room (or league rankings with your synced league selected)"
      : "FantasyPros Draft Assistant / Draft Wizard / cheat sheet for your synced league";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkHref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* user can select textarea */
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Live sync (bookmarklet)
        </p>
        {liveMatched ? (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
            Live · {liveMatched}
            {liveAt
              ? ` · ${new Date(liveAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : ""}
          </span>
        ) : null}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Chrome extensions (FP Side Assistant / DS Sync sidebar on ESPN) stay private to those
        plugins — Draft Room cannot read them. Keep the full {hostHint} open in another tab and
        click this bookmark there. It scrapes the visible remaining board and posts ranks here
        every few seconds.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <BookmarkletAnchor
          bookmarklet={bookmarkHref}
          dragLabel={label}
          title={`Drag to bookmarks bar, then click on ${source === "ds" ? "DraftSharks" : "FantasyPros"}`}
          onClick={(e) => e.preventDefault()}
          className={cn(
            "inline-flex cursor-grab items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground no-underline shadow-sm active:cursor-grabbing",
          )}
        >
          <Radio className="size-3.5" />
          {label}
        </BookmarkletAnchor>
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy script"}
        </Button>
      </div>
      <textarea
        readOnly
        value={bookmarkHref}
        className="h-14 w-full resize-none rounded-lg border border-border bg-background p-2 font-mono text-[10px] leading-relaxed"
        onFocus={(e) => e.currentTarget.select()}
      />
      <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
        <li>
          Chrome → Ctrl+Shift+B → Add page → Name: <span className="font-medium text-foreground">{label}</span>{" "}
          → URL: paste the script → Save.
        </li>
        <li>
          Open your synced {source === "ds" ? "Draft War Room" : "Draft Assistant / cheat sheet"}{" "}
          (logged in). Prefer the full site tab over the ESPN sidebar.
        </li>
        <li>
          Click <span className="font-medium text-foreground">{label}</span> on that tab. A teal badge
          should show rank count. Leave it open — Draft Room applies updates automatically.
        </li>
      </ol>
      {loopback ? (
        <p className="text-[11px] text-destructive">
          Ingest points at localhost. If {source === "ds" ? "DraftSharks" : "FantasyPros"} runs on
          another machine than this Draft Room, re-copy after opening Draft Room on a public
          preview URL so the bookmark can reach it.
        </p>
      ) : null}
    </div>
  );
}
