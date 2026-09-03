import { NextResponse } from "next/server";
import { espnPlayerIdOrZero, extractEspnDraftPicks, ingestCorsHeaders, isAllowedEspnIngestHref, isPlaceholderEspnName, isValidEspnPlayerId, mergeIngestMeta, parseEspnPickLog, requestPublicOrigin, type EspnIngestMeta, type EspnRawPick } from "@/lib/espn";
import { getIngest, setIngest } from "@/lib/espn-ingest";
import { getRelayTopic, relayUrl } from "@/lib/espn-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cors(req: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: ingestCorsHeaders(req) });
}

function normalizePicks(raw: unknown): EspnRawPick[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const row = p as Partial<EspnRawPick>;
      return {
        overallPickNumber: Number(row.overallPickNumber ?? 0),
        playerId: espnPlayerIdOrZero(Number(row.playerId ?? 0)),
        teamId: Number(row.teamId ?? 0),
        playerName: typeof row.playerName === "string" && !isPlaceholderEspnName(row.playerName) ? row.playerName : undefined,
      };
    })
    .filter((p) => p.overallPickNumber > 0 && (isValidEspnPlayerId(p.playerId) || Boolean(p.playerName)));
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: ingestCorsHeaders(req) });
}

export async function GET(req: Request) {
  const last = getIngest();
  const topic = getRelayTopic();
  return cors(req, {
    ok: true,
    picks: last?.picks ?? [],
    count: last?.picks.length ?? 0,
    ts: last?.ts ?? null,
    href: last?.href,
    meta: last?.meta,
    publicOrigin: requestPublicOrigin(req),
    ingestUrl: `${requestPublicOrigin(req)}/api/espn/ingest`,
    relayTopic: topic,
    relayUrl: relayUrl(topic),
  });
}

export async function POST(req: Request) {
  let body: {
    picks?: unknown;
    href?: string;
    title?: string;
    ts?: number;
    text?: string;
    json?: unknown;
    payload?: unknown;
    meta?: EspnIngestMeta;
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
  const href = typeof body.href === "string" ? body.href : undefined;
  // Sync ESPN bookmarklet used to run on FantasyPros / DraftSharks tabs and overwrite
  // real ESPN picks; listen then cleared non-espn.com captures and the UI wiped the board.
  if (href && !isAllowedEspnIngestHref(href)) {
    const previous = getIngest();
    return cors(req, {
      ok: true,
      ignoredForeign: true,
      count: previous?.picks.length ?? 0,
      error: "ESPN ingest only accepts fantasy.espn.com (or paste). Use Sync FP/DS ranks for those sites.",
      meta: previous?.meta,
    });
  }
  const meta = mergeIngestMeta(
    body.meta,
    href,
    typeof body.title === "string" ? body.title : undefined,
  );
  let picks = normalizePicks(body.picks);
  if (!picks.length) {
    picks = extractEspnDraftPicks(body.json ?? body.payload);
  }
  if (!picks.length && typeof body.text === "string" && body.text.trim()) {
    picks = parseEspnPickLog(body.text, meta.teams || 12);
  }
  const previous = getIngest();
  // Empty body while we already have picks = keep-alive heartbeat. Refresh ts/meta; never wipe.
  if (!picks.length && previous?.picks.length) {
    const nextMeta: EspnIngestMeta = { ...previous.meta };
    for (const [k, v] of Object.entries(meta) as Array<[keyof EspnIngestMeta, EspnIngestMeta[keyof EspnIngestMeta]]>) {
      if (v !== undefined && v !== null && k !== "reason") {
        (nextMeta as Record<string, unknown>)[k] = v;
      }
    }
    delete nextMeta.reason;
    setIngest({
      picks: previous.picks,
      href: href || previous.href,
      title: typeof body.title === "string" ? body.title : previous.title,
      ts: Date.now(),
      meta: nextMeta,
    });
    return cors(req, {
      ok: true,
      count: previous.picks.length,
      heartbeat: true,
      meta: nextMeta,
    });
  }
  setIngest({
    picks,
    href,
    title: typeof body.title === "string" ? body.title : undefined,
    ts: Date.now(),
    meta,
  });
  return cors(req, { ok: true, count: picks.length, meta });
}
