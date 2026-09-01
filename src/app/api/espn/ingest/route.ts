import { NextResponse } from "next/server";
import { ingestCorsHeaders, type EspnRawPick } from "@/lib/espn";
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
        playerId: Number(row.playerId ?? 0),
        teamId: Number(row.teamId ?? 0),
        playerName: typeof row.playerName === "string" ? row.playerName : undefined,
      };
    })
    .filter((p) => p.overallPickNumber > 0 && (p.playerId !== 0 || p.playerName));
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
  });
}

export async function POST(req: Request) {
  let body: { picks?: unknown; href?: string; title?: string; ts?: number } = {};
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
  const picks = normalizePicks(body.picks);
  setIngest({
    picks,
    href: typeof body.href === "string" ? body.href : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    ts: Number(body.ts) || Date.now(),
  });
  return cors(req, { ok: true, count: picks.length });
}
