import { NextResponse } from "next/server";
import {
  extrasFromMapped,
  loadEspnPlayers,
  mapEspnPicks,
  mergeIngestMeta,
} from "@/lib/espn";
import { getIngest } from "@/lib/espn-ingest";

export const dynamic = "force-dynamic";

const STALE_MS = 12 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fallbackTeams = Number(url.searchParams.get("teams")) || 12;
  const last = getIngest();
  if (!last) {
    return NextResponse.json({
      ok: true,
      ingest: false,
      stale: false,
      source: "empty",
      picks: [],
      extras: [],
      count: 0,
    });
  }
  if (Date.now() - last.ts > STALE_MS) {
    return NextResponse.json({
      ok: true,
      ingest: false,
      stale: true,
      source: "empty",
      picks: [],
      extras: [],
      count: 0,
      ts: last.ts,
    });
  }
  if (!last.picks.length) {
    return NextResponse.json({
      ok: true,
      ingest: false,
      stale: false,
      source: "empty",
      picks: [],
      extras: [],
      count: 0,
      ts: last.ts,
      href: last.href,
      meta: last.meta,
    });
  }

  const meta = mergeIngestMeta(last.meta, last.href, last.title);
  const teamsCount = meta.teams || fallbackTeams;
  const season = meta.season || 2026;
  const players = await loadEspnPlayers(season);
  const mapped = mapEspnPicks({
    picks: last.picks,
    pickOrder: [],
    teamsCount,
    players,
    draftType: meta.draftType === "linear" ? "linear" : "snake",
  });
  return NextResponse.json({
    ok: true,
    ingest: true,
    stale: false,
    source: "room-capture",
    picks: mapped,
    extras: extrasFromMapped(mapped),
    count: mapped.length,
    href: last.href,
    ts: last.ts,
    meta: { ...meta, teams: teamsCount },
  });
}
