import { NextResponse } from "next/server";
import { refreshLiveRankings } from "@/lib/rank-refresh";
import type { Scoring } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseScoring(raw: string | null): Scoring {
  if (raw === "ppr" || raw === "standard" || raw === "half") return raw;
  return "half";
}

export async function GET(req: Request) {
  const scoring = parseScoring(new URL(req.url).searchParams.get("scoring"));
  try {
    const result = await refreshLiveRankings(scoring);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        scoring,
        error: e instanceof Error ? e.message : "Rankings refresh failed.",
      },
      { status: 502 },
    );
  }
}
