import { NextResponse } from "next/server";
import {
  ingestCorsHeaders,
  isLoopbackOrigin,
  originDiagnostics,
  requestPublicOrigin,
  resolveEspnBookmarkOrigin,
} from "@/lib/espn";
import { commitRankScrape } from "@/lib/ranks-apply";
import { isLeftoverAgentRankSnapshot } from "@/lib/leftover-tests";
import {
  clearRanksIngest,
  getRanksIngest,
  isAllowedRanksIngestHref,
  type RankIngestRow,
} from "@/lib/ranks-ingest";
import { pullRanksRelayIntoIngest, ranksRelayUrl } from "@/lib/ranks-relay";
import { buildCompressedRanksBookmarklet } from "@/lib/bookmarklet-compress";
import { RANKS_RELAY_URL } from "@/lib/relay-urls";
import type { RankImportSource } from "@/lib/parse-import";

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
  await pullRanksRelayIntoIngest();
  {
    const prior = getRanksIngest();
    if (prior.fp && isLeftoverAgentRankSnapshot(prior.fp)) clearRanksIngest("fp");
    if (prior.ds && isLeftoverAgentRankSnapshot(prior.ds)) clearRanksIngest("ds");
  }
  const store = getRanksIngest();
  const publicOrigin = requestPublicOrigin(req);
  const pageOrigin = url.searchParams.get("origin") || publicOrigin;
  const origin = resolveEspnBookmarkOrigin(pageOrigin, publicOrigin) || publicOrigin;
  const diag = originDiagnostics(req, pageOrigin);
  const relay = ranksRelayUrl();
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
    relayUrl: relay,
    bookmarklets: {
      fp: buildCompressedRanksBookmarklet(origin, "fp", RANKS_RELAY_URL),
      ds: buildCompressedRanksBookmarklet(origin, "ds", RANKS_RELAY_URL),
    },
    loopback: isLoopbackOrigin(origin) || diag.loopback,
    loopbackRisk: diag.loopbackRisk || isLoopbackOrigin(origin),
    loopbackHostMismatch: diag.loopbackHostMismatch,
    configuredOrigin: diag.configuredOrigin,
    requestHostOrigin: diag.requestHostOrigin,
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
  const result = commitRankScrape({
    source,
    rows,
    text: typeof body.text === "string" ? body.text : undefined,
    href,
    title: typeof body.title === "string" ? body.title : undefined,
    ts: typeof body.ts === "number" ? body.ts : undefined,
  });
  if (!result.ok && !result.applied) {
    const status = result.error?.startsWith("Only matched") ? 422 : 400;
    return cors(
      req,
      {
        ok: false,
        error: result.error,
        matched: result.matched,
        unmatched: result.unmatched,
      },
      status,
    );
  }
  return cors(req, {
    ok: true,
    applied: result.applied,
    ignoredWeak: result.ignoredWeak,
    ignoredForeign: result.ignoredForeign,
    source,
    matched: result.matched,
    unmatched: result.unmatched,
    incoming: result.incoming,
    ts: result.ts,
    error: result.error,
  });
}
