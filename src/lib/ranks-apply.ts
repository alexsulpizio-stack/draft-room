import {
  parseRankingPaste,
  updatesToPatches,
  type RankImportSource,
} from "./parse-import";
import {
  getRanksIngest,
  isAllowedRanksIngestHref,
  setRanksIngestSource,
  type RankIngestRow,
} from "./ranks-ingest";

export function rowsToRankText(rows: RankIngestRow[]): string {
  const lines = ["RK,PLAYER,POS,TEAM"];
  for (const r of rows) {
    lines.push([r.rank, r.name, r.pos ?? "", r.team ?? ""].join(","));
  }
  return lines.join("\n");
}

export type CommitRankResult = {
  ok: boolean;
  applied: boolean;
  ignoredForeign?: boolean;
  ignoredWeak?: boolean;
  error?: string;
  matched: number;
  unmatched?: string[];
  ts?: number;
  incoming?: number;
};

/**
 * Shared FP/DS ingest commit (direct POST and ntfy relay).
 * Never shrinks a healthy overlay with a tiny scrape. Never mixes channels.
 */
export function commitRankScrape(input: {
  source: RankImportSource;
  rows: RankIngestRow[];
  text?: string;
  href?: string;
  title?: string;
  ts?: number;
}): CommitRankResult {
  const { source, rows } = input;
  const href = input.href;
  const previous = getRanksIngest()[source];
  if (href && !isAllowedRanksIngestHref(source, href)) {
    return {
      ok: true,
      applied: false,
      ignoredForeign: true,
      matched: previous?.matched ?? 0,
      ts: previous?.ts,
      error:
        source === "ds"
          ? "DS ranks ingest only accepts draftsharks.com. Use Sync ESPN / Sync FP ranks on those sites."
          : "FP ranks ingest only accepts fantasypros.com. Use Sync ESPN / Sync DS ranks on those sites.",
    };
  }
  const text =
    typeof input.text === "string" && input.text.trim()
      ? input.text
      : rows.length
        ? rowsToRankText(rows)
        : "";
  if (!text.trim()) {
    return { ok: false, applied: false, matched: 0, error: "No ranking rows." };
  }

  const parsed = parseRankingPaste(text, source);
  if (parsed.matched < 5) {
    return {
      ok: false,
      applied: false,
      matched: parsed.matched,
      unmatched: parsed.unmatched,
      error: `Only matched ${parsed.matched} players — open the live remaining board and try again.`,
    };
  }

  if (
    previous?.matched &&
    parsed.matched < Math.min(20, Math.floor(previous.matched * 0.35))
  ) {
    return {
      ok: true,
      applied: false,
      ignoredWeak: true,
      matched: previous.matched,
      incoming: parsed.matched,
      ts: previous.ts,
      error: `Kept prior ${source.toUpperCase()} overlay (${previous.matched}) — incoming scrape only matched ${parsed.matched}.`,
    };
  }

  const ts = input.ts && input.ts > 0 ? input.ts : Date.now();
  if (previous && previous.ts === ts && (previous.matched ?? 0) >= parsed.matched) {
    return {
      ok: true,
      applied: false,
      matched: previous.matched ?? parsed.matched,
      ts: previous.ts,
    };
  }

  const label =
    source === "ds"
      ? "Live DraftSharks War Room sync"
      : "Live FantasyPros Draft Assistant sync";
  setRanksIngestSource({
    source,
    rows,
    text,
    href,
    title: input.title,
    ts,
    matched: parsed.matched,
    patches: updatesToPatches(parsed.updates),
    unmatched: parsed.unmatched,
    label,
  });
  return {
    ok: true,
    applied: true,
    matched: parsed.matched,
    unmatched: parsed.unmatched,
    ts,
  };
}
