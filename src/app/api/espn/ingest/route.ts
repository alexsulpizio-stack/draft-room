import { NextResponse } from "next/server";
import { espnPlayerIdOrZero, ingestCorsHeaders, isPlaceholderEspnName, isValidEspnPlayerId, mergeIngestMeta, parseEspnPickLog, type EspnIngestMeta, type EspnRawPick } from "@/lib/espn";
import { getIngest, setIngest } from "@/lib/espn-ingest";

export const dynamic = "force-dynamic";

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
  return cors(req, {
    ok: true,
    picks: last?.picks ?? [],
    count: last?.picks.length ?? 0,
    ts: last?.ts ?? null,
    href: last?.href,
    meta: last?.meta,
  });
}

export async function POST(req: Request) {
  let body: {
    picks?: unknown;
    href?: string;
    title?: string;
    ts?: number;
    text?: string;
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
  const meta = mergeIngestMeta(
    body.meta,
    typeof body.href === "string" ? body.href : undefined,
    typeof body.title === "string" ? body.title : undefined,
  );
  let picks = normalizePicks(body.picks);
  if (!picks.length && typeof body.text === "string" && body.text.trim()) {
    picks = parseEspnPickLog(body.text, meta.teams || 12);
  }
  const previous = getIngest();
  if (!picks.length && previous?.picks.length) {
    return cors(req, { ok: true, count: previous.picks.length, ignoredEmpty: true, meta: previous.meta });
  }
  setIngest({
    picks,
    href: typeof body.href === "string" ? body.href : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    ts: Number(body.ts) || Date.now(),
    meta,
  });
  return cors(req, { ok: true, count: picks.length, meta });
}
