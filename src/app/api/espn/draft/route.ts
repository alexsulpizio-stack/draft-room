import { NextResponse } from "next/server";
import {
  extrasFromMapped,
  fetchEspnLeague,
  loadEspnPlayers,
  mapEspnPicks,
  mergeEspnPicks,
  normalizeCookies,
  parseEspnLeague,
  parseLeagueId,
  rawPicksFromDetail,
} from "@/lib/espn";
import { getIngest } from "@/lib/espn-ingest";

export const dynamic = "force-dynamic";

type Body = {
  leagueId?: string;
  season?: number;
  swid?: string;
  espnS2?: string;
  dsWeight?: number;
  teams?: number;
  draftType?: "snake" | "linear";
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  }
  const leagueId = parseLeagueId(body.leagueId || "");
  if (!leagueId) {
    return NextResponse.json({ ok: false, error: "Missing leagueId." }, { status: 400 });
  }
  const season = Number(body.season) || 2026;
  const cookie = normalizeCookies(body.swid, body.espnS2);

  const fetched = await fetchEspnLeague({ leagueId, season, cookie });
  const ingest = getIngest();
  const players = await loadEspnPlayers(season, cookie);

  if (!fetched.ok || !fetched.payload) {
    if (ingest?.picks.length) {
      const mapped = mapEspnPicks({
        picks: ingest.picks,
        pickOrder: [],
        teamsCount: ingest.meta?.teams || Number(body.teams) || 12,
        players,
        draftType:
          ingest.meta?.draftType === "linear" || body.draftType === "linear" ? "linear" : "snake",
      });
      return NextResponse.json({
        ok: true,
        inProgress: true,
        drafted: false,
        apiPickCount: 0,
        ingestPickCount: ingest.picks.length,
        ingestAgeMs: Date.now() - ingest.ts,
        source: "room-capture",
        picks: mapped,
        extras: extrasFromMapped(mapped),
        warning: fetched.needAuth
          ? "ESPN league API needs cookies. Room capture is still flowing."
          : "League API failed. Using room capture.",
      });
    }
    return NextResponse.json(
      {
        ok: false,
        needAuth: fetched.needAuth,
        error: fetched.error ?? "ESPN poll failed.",
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
  const apiPicks = rawPicksFromDetail(fetched.payload);
  const merged = mergeEspnPicks(apiPicks, ingest?.picks ?? []);
  const mapped = mapEspnPicks({
    picks: merged,
    pickOrder: info.pickOrder,
    teamsCount: info.settings.teams,
    players,
    draftType: info.draftType,
  });

  const source =
    apiPicks.length >= merged.length && apiPicks.length > 0
      ? "espn-api"
      : ingest && ingest.picks.length > apiPicks.length
        ? "room-capture"
        : apiPicks.length
          ? "espn-api"
          : ingest?.picks.length
            ? "room-capture"
            : "empty";

  return NextResponse.json({
    ok: true,
    inProgress: info.inProgress,
    drafted: info.drafted,
    apiPickCount: apiPicks.length,
    ingestPickCount: ingest?.picks.length ?? 0,
    ingestAgeMs: ingest ? Date.now() - ingest.ts : null,
    source,
    picks: mapped,
    extras: extrasFromMapped(mapped),
    warning:
      info.inProgress && source === "empty"
        ? "No picks from ESPN yet. Open the live draft tab and run the bookmarklet."
        : source === "room-capture" && apiPicks.length === 0
          ? "Using the ESPN room capture. The official league API is still empty — that is normal mid-draft."
          : undefined,
  });
}
