import { NextResponse } from "next/server";
import { fetchEspnLeague, loadEspnPlayers, normalizeCookies, parseEspnLeague, parseLeagueId, parseSeason } from "@/lib/espn";

export const dynamic = "force-dynamic";

type Body = {
  league?: string;
  leagueId?: string;
  season?: number;
  swid?: string;
  espnS2?: string;
  dsWeight?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  }

  const leagueId = parseLeagueId(body.leagueId || body.league || "");
  if (!leagueId) {
    return NextResponse.json(
      { ok: false, error: "Paste your ESPN league URL or numeric league ID." },
      { status: 400 }
    );
  }
  const season = Number(body.season) || parseSeason(body.league || "", 2026);
  const cookie = normalizeCookies(body.swid, body.espnS2);
  const fetched = await fetchEspnLeague({ leagueId, season, cookie });
  if (!fetched.ok || !fetched.payload) {
    return NextResponse.json(
      {
        ok: false,
        needAuth: fetched.needAuth,
        error: fetched.needAuth
          ? "This league is private. Paste SWID and espn_s2 from your ESPN cookies and try again."
          : fetched.error ?? "Could not reach ESPN.",
      },
      { status: fetched.status || 502 }
    );
  }

  const info = parseEspnLeague(fetched.payload, {
    leagueId,
    season,
    swid: body.swid,
    dsWeight: body.dsWeight ?? 50,
  });

  await loadEspnPlayers(season, cookie);

  return NextResponse.json({
    ok: true,
    league: info,
    warning:
      info.inProgress && info.apiPickCount === 0
        ? "ESPN's league API often stays empty during a live room. Drop the bookmarklet on the draft tab so picks still stream in."
        : undefined,
  });
}
