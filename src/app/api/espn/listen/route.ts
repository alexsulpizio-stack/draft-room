import { NextResponse } from "next/server";
import {
  clampEspnPickOrder,
  extrasFromMapped,
  isAllowedEspnIngestHref,
  loadEspnPlayers,
  mapEspnPicks,
  mergeIngestMeta,
  originDiagnostics,
  remapMappedPicks,
  requestPublicOrigin,
} from "@/lib/espn";
import { clearIngest, getIngest } from "@/lib/espn-ingest";
import { getRelayTopic, pullRelayIntoIngest, relayUrl } from "@/lib/espn-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STALE_MS = 12 * 60 * 1000;

function listenMeta(req: Request) {
  const publicOrigin = requestPublicOrigin(req);
  const ingestUrl = publicOrigin ? `${publicOrigin}/api/espn/ingest` : "";
  const topic = getRelayTopic();
  const ntfy = relayUrl(topic);
  const origin = originDiagnostics(req);
  return {
    publicOrigin,
    ingestUrl,
    relayTopic: topic,
    relayUrl: ntfy,
    configuredOrigin: origin.configuredOrigin,
    requestHostOrigin: origin.requestHostOrigin,
    loopback: origin.loopback,
    loopbackRisk: origin.loopbackRisk,
    loopbackHostMismatch: origin.loopbackHostMismatch,
  };
}

async function mappedPayload(last: NonNullable<ReturnType<typeof getIngest>>, fallbackTeams: number) {
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
  return { mapped, meta: { ...meta, teams: teamsCount } };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fallbackTeams = Number(url.searchParams.get("teams")) || 12;
  // Drop foreign scrapes before relay merge so FP/DS pollution cannot be blended
  // into a later ESPN ntfy snapshot (mergeEspnPicks would otherwise keep bad rows).
  {
    const prior = getIngest();
    const priorHref = prior?.href ?? "";
    if (prior && priorHref && priorHref !== "paste" && !isAllowedEspnIngestHref(priorHref)) {
      clearIngest("allow-replay");
    }
  }
  await pullRelayIntoIngest();
  let last = getIngest();
  const href = last?.href ?? "";
  if (last && href && href !== "paste" && !isAllowedEspnIngestHref(href)) {
    clearIngest("allow-replay");
    last = null;
  }
  const base = listenMeta(req);
  if (!last) {
    return NextResponse.json({
      ok: true,
      ingest: false,
      stale: false,
      source: "empty",
      picks: [],
      extras: [],
      count: 0,
      ...base,
    });
  }
  const age = Date.now() - last.ts;
  const stale = last.ts > 0 && age > STALE_MS;
  if (!last.picks.length) {
    const connected = Boolean(last.href && isAllowedEspnIngestHref(last.href));
    return NextResponse.json({
      ok: true,
      ingest: false,
      connected,
      stale,
      source: "empty",
      picks: [],
      extras: [],
      count: 0,
      ts: last.ts,
      href: last.href,
      meta: last.meta,
      reason: last.meta?.reason,
      ...base,
    });
  }

  const { mapped, meta } = await mappedPayload(last, fallbackTeams);
  return NextResponse.json({
    ok: true,
    // Keep serving picks when the room capture goes quiet — UI shows stale warning instead of wiping.
    ingest: true,
    stale,
    source: "room-capture",
    picks: mapped,
    extras: extrasFromMapped(mapped),
    count: mapped.length,
    href: last.href,
    ts: last.ts,
    meta,
    ...base,
  });
}
