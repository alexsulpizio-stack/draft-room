import { NextResponse } from "next/server";
import {
  clampEspnPickOrder,
  extrasFromMapped,
  isAllowedEspnIngestHref,
  isLiveEspnCaptureHref,
  loadEspnPlayers,
  mapEspnPicks,
  mergeIngestMeta,
  originDiagnostics,
  remapMappedPicks,
  requestPublicOrigin,
} from "@/lib/espn";
import { clearIngest, getIngest } from "@/lib/espn-ingest";
import { getRelayTopic, pullRelayIntoIngest, relayUrl } from "@/lib/espn-relay";
import { buildCompressedEspnBookmarklet } from "@/lib/bookmarklet-compress";
import { ESPN_RELAY_URL } from "@/lib/relay-urls";

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
    bookmarklet: buildCompressedEspnBookmarklet(
      publicOrigin || "http://127.0.0.1:43173",
      ntfy || ESPN_RELAY_URL,
    ),
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
  // Drop leftover / foreign scrapes BEFORE relay merge so they cannot blend into
  // a later ESPN ntfy snapshot (mergeEspnPicks would otherwise keep bad rows).
  // Use allow-replay — block-relay after a test leftover would stamp ts=now and
  // swallow the user's still-live ntfy messages even when a newer post arrives
  // with a slightly older packed `t` (or the leftover clear ran after their last click).
  {
    const prior = getIngest();
    const priorHref = prior?.href ?? "";
    const leftoverOrForeign =
      Boolean(prior?.picks.length) && !isLiveEspnCaptureHref(prior?.href);
    const foreignHref =
      Boolean(priorHref) &&
      priorHref !== "paste" &&
      priorHref !== "cleared" &&
      !isAllowedEspnIngestHref(priorHref);
    if (leftoverOrForeign || foreignHref) {
      clearIngest("allow-replay");
    }
  }
  await pullRelayIntoIngest();
  let last = getIngest();
  const href = last?.href ?? "";
  if (last && href && href !== "paste" && href !== "cleared" && !isAllowedEspnIngestHref(href)) {
    clearIngest("allow-replay");
    last = null;
  }
  // Href-less test writes (e.g. check scripts) must not mark players taken.
  // allow-replay so a NEWER bookmarklet/ntfy post still applies on the next pull.
  if (last && last.picks.length && !isLiveEspnCaptureHref(last.href)) {
    clearIngest("allow-replay");
    last = getIngest();
  }
  const base = listenMeta(req);
  if (last?.href === "cleared") {
    return NextResponse.json({
      ok: true,
      ingest: false,
      cleared: true,
      connected: false,
      stale: false,
      source: "empty",
      picks: [],
      extras: [],
      count: 0,
      ts: last.ts,
      href: last.href,
      ...base,
    });
  }
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
