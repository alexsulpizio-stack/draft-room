import { NextResponse } from "next/server";
import {
  bookmarkletOrigin,
  ingestCorsHeaders,
  isLoopbackOrigin,
  requestPublicOrigin,
} from "@/lib/espn";
import {
  clearRanksIngest,
  getRanksIngest,
  isAllowedRanksIngestHref,
  setRanksIngestSource,
  type RankIngestRow,
} from "@/lib/ranks-ingest";
import {
  parseRankingPaste,
  updatesToPatches,
  type RankImportSource,
} from "@/lib/parse-import";
import { buildRanksBookmarklet } from "@/lib/ranks-bookmarklet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cors(req: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: ingestCorsHeaders(req) });
}

function isRankSource(v: unknown): v is RankImportSource {
  return v === "fp" || v === "ds";
}

function normalizeRows(raw: unknown): RankIngestRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RankIngestRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<RankIngestRow>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const rank = Number(row.rank);
    if (!name || !Number.isFinite(rank) || rank <= 0) continue;
    out.push({
      rank,
      name,
      pos: typeof row.pos === "string" ? row.pos : undefined,
      team: typeof row.team === "string" ? row.team : undefined,
    });
  }
  return out;
}

function rowsToText(rows: RankIngestRow[]): string {
  const lines = ["RK,PLAYER,POS,TEAM"];
  for (const r of rows) {
    lines.push([r.rank, r.name, r.pos ?? "", r.team ?? ""].join(","));
  }
  return lines.join("\n");
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: ingestCorsHeaders(req) });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clear = url.searchParams.get("clear");
  if (clear === "fp" || clear === "ds") {
    clearRanksIngest(clear);
  } else if (clear === "1" || clear === "all") {
    clearRanksIngest();
  }
  const store = getRanksIngest();
  const publicOrigin = requestPublicOrigin(req);
  const pageOrigin = url.searchParams.get("origin") || publicOrigin;
  const origin = bookmarkletOrigin(pageOrigin, publicOrigin) || publicOrigin;
  return cors(req, {
    ok: true,
    fp: store.fp
      ? {
          matched: store.fp.matched ?? 0,
          ts: store.fp.ts,
          href: store.fp.href,
          label: store.fp.label,
          patches: store.fp.patches ?? {},
          unmatched: store.fp.unmatched ?? [],
        }
      : null,
    ds: store.ds
      ? {
          matched: store.ds.matched ?? 0,
          ts: store.ds.ts,
          href: store.ds.href,
          label: store.ds.label,
          patches: store.ds.patches ?? {},
          unmatched: store.ds.unmatched ?? [],
        }
      : null,
    publicOrigin,
    ingestUrl: `${publicOrigin}/api/ranks/ingest`,
    bookmarklets: {
      fp: buildRanksBookmarklet(origin, "fp"),
      ds: buildRanksBookmarklet(origin, "ds"),
    },
    loopback: isLoopbackOrigin(origin),
  });
}

export async function POST(req: Request) {
  let body: {
    source?: unknown;
    rows?: unknown;
    text?: unknown;
    href?: unknown;
    title?: unknown;
    ts?: unknown;
  } = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      body = (await req.json()) as typeof body;
    } else {
      const text = await req.text();
      if (text) body = JSON.parse(text) as typeof body;
    }
  } catch {
    return cors(req, { ok: false, error: "Invalid JSON." }, 400);
  }

  if (!isRankSource(body.source)) {
    return cors(req, { ok: false, error: "source must be fp or ds." }, 400);
  }
  const source = body.source;
  const href = typeof body.href === "string" ? body.href : undefined;
  const previous = getRanksIngest()[source];
  // Keep FP and DS channels distinct from each other and from ESPN scrapes.
  if (href && !isAllowedRanksIngestHref(source, href)) {
    return cors(req, {
      ok: true,
      ignoredForeign: true,
      source,
      matched: previous?.matched ?? 0,
      error:
        source === "ds"
          ? "DS ranks ingest only accepts draftsharks.com. Use Sync ESPN / Sync FP ranks on those sites."
          : "FP ranks ingest only accepts fantasypros.com. Use Sync ESPN / Sync DS ranks on those sites.",
      ts: previous?.ts,
    });
  }
  const rows = normalizeRows(body.rows);
  const text =
    typeof body.text === "string" && body.text.trim()
      ? body.text
      : rows.length
        ? rowsToText(rows)
        : "";
  if (!text.trim()) {
    return cors(req, { ok: false, error: "No ranking rows." }, 400);
  }

  const parsed = parseRankingPaste(text, source);
  if (parsed.matched < 5) {
    return cors(
      req,
      {
        ok: false,
        error: `Only matched ${parsed.matched} players — open the live remaining board and try again.`,
        matched: parsed.matched,
        unmatched: parsed.unmatched,
      },
      422,
    );
  }

  const label =
    source === "ds"
      ? "Live DraftSharks War Room sync"
      : "Live FantasyPros Draft Assistant sync";
  const payload = {
    source,
    rows,
    text,
    href,
    title: typeof body.title === "string" ? body.title : undefined,
    ts: Date.now(),
    matched: parsed.matched,
    patches: updatesToPatches(parsed.updates),
    unmatched: parsed.unmatched,
    label,
  };
  setRanksIngestSource(payload);
  return cors(req, {
    ok: true,
    source,
    matched: parsed.matched,
    unmatched: parsed.unmatched,
    ts: payload.ts,
  });
}
