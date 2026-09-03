import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EspnIngestMeta, EspnRawPick } from "./espn";
import { setIngest, getIngest } from "./espn-ingest";

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

export function unpackRelayMessage(raw: string): { picks: EspnRawPick[]; meta?: EspnIngestMeta; href?: string; ts: number } | null {
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

export async function pullRelayIntoIngest(): Promise<boolean> {
  const topic = getRelayTopic();
  const url = `${NTFY_HOST}/${topic}/json?poll=1&since=2h`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text.trim()) return false;
    let best: { picks: EspnRawPick[]; meta?: EspnIngestMeta; href?: string; ts: number } | null = null;
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
      if (!unpacked?.picks.length) continue;
      if (!unpacked.href || !/espn\.com/i.test(unpacked.href)) continue;
      if (!best || unpacked.ts >= best.ts) best = unpacked;
    }
    if (!best) return false;
    const current = getIngest();
    if (current && current.picks.length >= best.picks.length && current.ts >= best.ts) return false;
    setIngest({
      picks: best.picks,
      href: best.href,
      ts: best.ts,
      meta: best.meta,
    });
    return true;
  } catch {
    return false;
  }
}
