import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isAllowedEspnIngestHref, mergeEspnPicks, type EspnIngestMeta, type EspnRawPick } from "./espn";
import { setIngest, getIngest, type IngestPayload } from "./espn-ingest";

const TOPIC_PATHS = [
  `${process.cwd()}/.data/espn-relay-topic`,
  "/tmp/draft-room-espn-relay-topic",
] as const;

export const NTFY_HOST = "https://ntfy.sh";
/** Fixed so the bookmarklet is valid on first paint — never javascript:void(0). */
export const STABLE_RELAY_TOPIC = "drjfl28jackal";

function writeTopic(topic: string) {
  for (const file of TOPIC_PATHS) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, topic);
    } catch {
      /* next */
    }
  }
}

export function getRelayTopic(): string {
  writeTopic(STABLE_RELAY_TOPIC);
  return STABLE_RELAY_TOPIC;
}

export function rotateRelayTopic(): string {
  return getRelayTopic();
}

export function relayUrl(topic = getRelayTopic()): string {
  return `${NTFY_HOST}/${topic}`;
}

export type RelayPacked = {
  v: 1;
  p: Array<[number, number, number, string?]>;
  m?: EspnIngestMeta;
  h?: string;
  t?: number;
};

export type UnpackedRelay = {
  picks: EspnRawPick[];
  meta?: EspnIngestMeta;
  href?: string;
  ts: number;
};

export function unpackRelayMessage(raw: string): UnpackedRelay | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v && v.v === 1 && Array.isArray(v.p)) {
      const picks: EspnRawPick[] = (v.p as Array<[number, number, number, string?]>)
        .map((row) => ({
          overallPickNumber: Number(row[0] || 0),
          playerId: Number(row[1] || 0),
          teamId: Number(row[2] || 0),
          playerName: typeof row[3] === "string" && row[3] ? row[3] : undefined,
        }))
        .filter((p) => p.overallPickNumber > 0 && (p.playerId > 0 || Boolean(p.playerName)));
      return {
        picks,
        meta: v.m as EspnIngestMeta | undefined,
        href: typeof v.h === "string" ? v.h : undefined,
        ts: Number(v.t) || Date.now(),
      };
    }
    if (Array.isArray(v.picks)) {
      return {
        picks: v.picks as EspnRawPick[],
        meta: v.meta as EspnIngestMeta | undefined,
        href: typeof v.href === "string" ? v.href : undefined,
        ts: Number(v.ts) || Date.now(),
      };
    }
  } catch {
    return null;
  }
  return null;
}

type NtfyLine = { event?: string; message?: string; time?: number };

/** Merge a polled ntfy snapshot into ingest. Never apply older messages after a clear. Never shrink picks. */
export function applyRelayToIngest(
  current: IngestPayload | null,
  best: UnpackedRelay | null,
  heartbeat: UnpackedRelay | null,
): IngestPayload | null {
  let next = current;
  const currentTs = current?.ts ?? 0;
  if (best) {
    const stale = currentTs > 0 && best.ts < currentTs;
    if (!stale) {
      const merged = mergeEspnPicks(current?.picks ?? [], best.picks);
      const grew = merged.length > (current?.picks.length ?? 0);
      const sameOrNewer = best.ts >= currentTs && merged.length >= (current?.picks.length ?? 0);
      if (grew || sameOrNewer) {
        next = {
          picks: merged,
          href: best.href || current?.href,
          title: current?.title,
          ts: Math.max(best.ts, currentTs),
          meta: { ...current?.meta, ...best.meta },
        };
      }
    }
  }
  if (!heartbeat) return next ?? null;
  if (next?.picks.length) {
    if (heartbeat.ts <= (next.ts ?? 0)) return next;
    return {
      picks: next.picks,
      href: next.href || heartbeat.href,
      title: next.title,
      ts: heartbeat.ts,
      meta: { ...heartbeat.meta, ...next.meta },
    };
  }
  if (next && next.ts >= heartbeat.ts) return next;
  return {
    picks: [],
    href: heartbeat.href,
    ts: heartbeat.ts,
    meta: heartbeat.meta,
  };
}

export async function pullRelayIntoIngest(): Promise<boolean> {
  const topic = getRelayTopic();
  const url = `${NTFY_HOST}/${topic}/json?poll=1&since=2h`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text.trim()) return false;
    let best: UnpackedRelay | null = null;
    let heartbeat: UnpackedRelay | null = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let msg: NtfyLine;
      try {
        msg = JSON.parse(line) as NtfyLine;
      } catch {
        continue;
      }
      if (msg.event && msg.event !== "message") continue;
      if (!msg.message) continue;
      const unpacked = unpackRelayMessage(msg.message);
      if (!unpacked) continue;
      if (!unpacked.href || !isAllowedEspnIngestHref(unpacked.href)) continue;
      if (unpacked.picks.length) {
        if (!best || unpacked.ts >= best.ts) best = unpacked;
      } else if (unpacked.meta || unpacked.href) {
        if (!heartbeat || unpacked.ts >= heartbeat.ts) heartbeat = unpacked;
      }
    }
    const raw = getIngest();
    // Ignore in-memory foreign scrapes so relay cannot merge ESPN picks onto them.
    const current =
      raw && raw.href && raw.href !== "paste" && !isAllowedEspnIngestHref(raw.href) ? null : raw;
    const next = applyRelayToIngest(current, best, heartbeat);
    if (!next) return false;
    const same =
      current &&
      current.ts === next.ts &&
      current.picks.length === next.picks.length &&
      current.href === next.href;
    if (same) return false;
    setIngest(next);
    return true;
  } catch {
    return false;
  }
}
