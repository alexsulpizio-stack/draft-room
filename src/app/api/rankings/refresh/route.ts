import { NextResponse } from "next/server";
import { refreshLiveRankings } from "@/lib/rank-refresh";
import type { Scoring } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseScoring(raw: string | null): Scoring {
  if (raw === "ppr" || raw === "standard" || raw === "half") return raw;
  return "half";
}

/** GET ?scoring=half&ranksOnly=1&force=1 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const scoring = parseScoring(url.searchParams.get("scoring"));
  const ranksOnly =
    url.searchParams.get("ranksOnly") === "1" ||
    url.searchParams.get("ranksOnly") === "true";
  const force =
    url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
  try {
    const result = await refreshLiveRankings(scoring, { ranksOnly, force });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        scoring,
        ranksOnly,
        error: e instanceof Error ? e.message : "Rankings refresh failed.",
      },
      { status: 502 },
    );
  }
}
