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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isLoopbackOrigin, resolveEspnBookmarkOrigin } from "@/lib/espn";
import {
  envPublicOrigin,
  readStoredPublicOrigin,
  writeStoredPublicOrigin,
} from "@/lib/public-origin";
import { buildRanksBookmarklet } from "@/lib/ranks-bookmarklet";
import { RANKS_RELAY_URL } from "@/lib/relay-urls";
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
  const [storedPublicOrigin, setStoredPublicOrigin] = useState("");
  const [publicOriginDraft, setPublicOriginDraft] = useState("");
  const [loopbackHostMismatch, setLoopbackHostMismatch] = useState(false);
  const [relayUrl, setRelayUrl] = useState(RANKS_RELAY_URL);
  const [copied, setCopied] = useState(false);
  const [serverBookmarklet, setServerBookmarklet] = useState("");

  useEffect(() => {
    setPageOrigin(window.location.origin);
    const stored = readStoredPublicOrigin();
    if (stored) {
      setStoredPublicOrigin(stored);
      setPublicOriginDraft(stored);
    } else {
      const env = envPublicOrigin();
      if (env) setPublicOriginDraft(env);
    }
    void fetch("/api/ranks/ingest", { cache: "no-store" })
      .then(
        (r) =>
          r.json() as Promise<{
            publicOrigin?: string;
            relayUrl?: string;
            loopbackHostMismatch?: boolean;
            bookmarklets?: { fp?: string; ds?: string };
          }>,
      )
      .then((json) => {
        if (typeof json.publicOrigin === "string" && json.publicOrigin) {
          setPublicOrigin(json.publicOrigin);
        }
        if (typeof json.relayUrl === "string" && json.relayUrl) {
          setRelayUrl(json.relayUrl);
        }
        if (typeof json.loopbackHostMismatch === "boolean") {
          setLoopbackHostMismatch(json.loopbackHostMismatch);
        }
        const packed = json.bookmarklets?.[source];
        if (typeof packed === "string" && packed.startsWith("javascript:")) {
          setServerBookmarklet(packed);
        }
      })
      .catch(() => {});
  }, [source]);

  const reachablePublic =
    storedPublicOrigin ||
    envPublicOrigin() ||
    (publicOrigin && !isLoopbackOrigin(publicOrigin) ? publicOrigin : "") ||
    "";
  const origin =
    resolveEspnBookmarkOrigin(pageOrigin, reachablePublic || publicOrigin) ||
    pageOrigin ||
    "http://127.0.0.1:43173";
  const localBookmarkHref = useMemo(
    () => buildRanksBookmarklet(origin, source, relayUrl || RANKS_RELAY_URL),
    [origin, source, relayUrl],
  );
  const bookmarkHref = serverBookmarklet || localBookmarkHref;
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

  const savePublicOrigin = () => {
    const next = publicOriginDraft.trim().replace(/\/$/, "");
    writeStoredPublicOrigin(next);
    setStoredPublicOrigin(next);
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
        The Sync {source === "ds" ? "DS" : "FP"} chip in the header only opens this help. A teal
        badge appears on {source === "ds" ? "DraftSharks" : "FantasyPros"}, not here. Keep the full{" "}
        {hostHint} open and click the <span className="font-medium text-foreground">{label}</span>{" "}
        bookmark there (not on ESPN / Draft Room). Posts go through ntfy{" "}
        <span className="font-mono">{(relayUrl || RANKS_RELAY_URL).replace("https://", "")}</span>
        . Chrome extensions on ESPN cannot be read.
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
      {loopback || loopbackHostMismatch ? (
        <div className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold leading-snug">
            Direct POST is localhost — {label} still syncs through the relay.
          </p>
          <p className="text-xs leading-relaxed opacity-90">
            FantasyPros / DraftSharks tabs on your PC cannot reach{" "}
            <span className="font-mono">127.0.0.1:43173</span> on the Cursor VM. The new script
            posts ranks to ntfy the same way Sync ESPN does. Click {label} on the full{" "}
            {source === "ds" ? "DraftSharks" : "FantasyPros"} tab, wait for the teal badge (it may
            say “via relay”), and this column updates. You do not need a public / share URL.
          </p>
          <p className="text-xs leading-relaxed opacity-90">
            Delete the old {label} bookmark and paste the script above as the new URL after this
            update.
          </p>
          <details className="rounded-lg border border-amber-500/30 bg-background/60 p-2">
            <summary className="cursor-pointer text-xs font-medium">
              Optional: bake a public Draft Room URL
            </summary>
            <div className="mt-2 space-y-1">
              <Label htmlFor={`ranks-public-url-${source}`} className="text-xs">
                Public Draft Room URL
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id={`ranks-public-url-${source}`}
                  value={publicOriginDraft}
                  onChange={(e) => setPublicOriginDraft(e.target.value)}
                  placeholder="https://your-cursor-preview-host"
                  className="h-8 flex-1 font-mono text-xs"
                />
                <Button type="button" size="sm" variant="secondary" onClick={savePublicOrigin}>
                  Save
                </Button>
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
