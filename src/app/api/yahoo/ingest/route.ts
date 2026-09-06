import { NextResponse } from "next/server";
import { ingestCorsHeaders, requestPublicOrigin, originDiagnostics } from "@/lib/espn";
import { getYahooIngest, setYahooIngest, clearYahooIngest, type YahooIngestPayload } from "@/lib/yahoo-ingest";
import { isAllowedYahooHref, normalizeYahooPicks } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cors(req: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: ingestCorsHeaders(req) });
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: ingestCorsHeaders(req) });
}

export async function GET(req: Request) {
  const current = getYahooIngest();
  const publicOrigin = requestPublicOrigin(req);
  const diag = originDiagnostics(req);
  return cors(req, {
    ok: true,
    picks: current?.picks ?? [],
    count: current?.picks.length ?? 0,
    ts: current?.ts ?? null,
    href: current?.href,
    title: current?.title,
    meta: current?.meta,
    publicOrigin,
    ingestUrl: `${publicOrigin}/api/yahoo/ingest`,
    connected: Boolean(current && current.href !== "cleared" && Date.now() - current.ts < 180000),
    configuredOrigin: diag.configuredOrigin,
    requestHostOrigin: diag.requestHostOrigin,
    loopbackRisk: diag.loopbackRisk,
  });
}

export async function POST(req: Request) {
  let body: {
    picks?: unknown;
    href?: unknown;
    title?: unknown;
    ts?: unknown;
    meta?: YahooIngestPayload["meta"];
  } = {};

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return cors(req, { ok: false, error: "Invalid JSON." }, 400);
  }

  const href = typeof body.href === "string" ? body.href : undefined;
  if (href && href !== "paste" && !isAllowedYahooHref(href)) {
    const previous = getYahooIngest();
    return cors(req, {
      ok: true,
      ignoredForeign: true,
      count: previous?.picks.length ?? 0,
      error: "Yahoo ingest only accepts yahoo.com pages or manual paste.",
    });
  }

  const picks = normalizeYahooPicks(body.picks);
  const previous = getYahooIngest();

  if (!picks.length && previous?.picks.length && href !== "cleared") {
    setYahooIngest({
      ...previous,
      href: href || previous.href,
      title: typeof body.title === "string" ? body.title : previous.title,
      ts: Date.now(),
      meta: { ...previous.meta, ...body.meta },
    });
    return cors(req, { ok: true, heartbeat: true, count: previous.picks.length });
  }

  if (href === "cleared") clearYahooIngest();
  else {
    setYahooIngest({
      picks,
      href,
      title: typeof body.title === "string" ? body.title : undefined,
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
      meta: body.meta,
    });
  }

  const current = getYahooIngest();
  return cors(req, { ok: true, count: current?.picks.length ?? 0, ts: current?.ts ?? null });
}
