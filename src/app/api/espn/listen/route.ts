import { NextResponse } from "next/server";
import {
  clampEspnPickOrder,
  extrasFromMapped,
  isAllowedEspnIngestHref,
  loadEspnPlayers,
  mapEspnPicks,
  mergeIngestMeta,
  remapMappedPicks,
  requestPublicOrigin,
} from "@/lib/espn";
import { clearIngest, getIngest } from "@/lib/espn-ingest";
import { getRelayTopic, pullRelayIntoIngest, relayUrl } from "@/lib/espn-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STALE_MS = 12 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fallbackTeams = Number(url.searchParams.get("teams")) || 12;
  await pullRelayIntoIngest();
  let last = getIngest();
  const href = last?.href ?? "";
  if (last?.picks.length && href !== "paste" && !isAllowedEspnIngestHref(href)) {
    clearIngest();
    last = null;
  }
  const publicOrigin = requestPublicOrigin(req);
  const ingestUrl = publicOrigin ? `${publicOrigin}/api/espn/ingest` : "";
  const topic = getRelayTopic();
  const ntfy = relayUrl(topic);
  if (!last) {
    return NextResponse.json({
      ok: true,
      ingest: false,
      stale: false,
      source: "empty",
      picks: [],
      extras: [],
      count: 0,
      publicOrigin,
      ingestUrl,
      relayTopic: topic,
      relayUrl: ntfy,
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
      publicOrigin,
      ingestUrl,
      relayTopic: topic,
      relayUrl: ntfy,
    });
  }
  if (!last.picks.length) {
    const connected = Boolean(last.href && /espn\.com/i.test(last.href));
    return NextResponse.json({
      ok: true,
      ingest: false,
      connected,
      stale: false,
      source: "empty",
      picks: [],
      extras: [],
      count: 0,
      ts: last.ts,
      href: last.href,
      meta: last.meta,
      reason: last.meta?.reason,
      publicOrigin,
      ingestUrl,
      relayTopic: topic,
      relayUrl: ntfy,
    });
  }

  const meta = mergeIngestMeta(last.meta, last.href, last.title);
  const teamsCount = meta.teams || fallbackTeams;
  const pickOrder = clampEspnPickOrder(meta.pickOrder, teamsCount) ?? [];
  const season = meta.season || 2026;
  const players = await loadEspnPlayers(season);
  const mapped = remapMappedPicks(
    mapEspnPicks({
      picks: last.picks,
      pickOrder,
      teamsCount,
      players,
      draftType: meta.draftType === "linear" ? "linear" : "snake",
    }),
  );
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
    publicOrigin,
    ingestUrl,
    relayTopic: topic,
    relayUrl: ntfy,
  });
}
