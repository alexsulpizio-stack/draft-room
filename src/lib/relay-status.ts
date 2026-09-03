import { ESPN_RELAY_TOPIC, NTFY_HOST, RANKS_RELAY_TOPIC } from "./relay-urls";
import { unpackRelayMessage } from "./espn-relay";
import {
  isLeftoverAgentRankSnapshot,
  isLeftoverEspnTestPicks,
  isLeftoverTestNtfyTitle,
  type RelayKind,
} from "./leftover-tests";
import { unpackRanksRelayMessage } from "./ranks-relay";

export type { RelayKind };

export type RelayPeek = {
  espnLastAt: number | null;
  espnLastKind: RelayKind;
  espnPickCount: number;
  ranksLastAt: number | null;
  ranksLastKind: RelayKind;
  ranksCount: number;
};

type NtfyLine = {
  event?: string;
  message?: string;
  title?: string;
  time?: number;
};

function parseLines(text: string): NtfyLine[] {
  const out: NtfyLine[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as NtfyLine);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function pollTopic(topic: string, since = "12h"): Promise<NtfyLine[]> {
  const url = `${NTFY_HOST}/${topic}/json?poll=1&since=${since}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    return parseLines(await res.text());
  } catch {
    return [];
  }
}

export async function peekRelay(): Promise<RelayPeek> {
  const [espnLines, rankLines] = await Promise.all([
    pollTopic(ESPN_RELAY_TOPIC),
    pollTopic(RANKS_RELAY_TOPIC),
  ]);

  let espnLastAt: number | null = null;
  let espnLastKind: RelayKind = "none";
  let espnPickCount = 0;
  for (const msg of espnLines) {
    if (msg.event && msg.event !== "message") continue;
    if (!msg.message) continue;
    const at = (Number(msg.time) || 0) * 1000 || Date.now();
    if (isLeftoverTestNtfyTitle(msg.title)) {
      if (!espnLastAt || at >= espnLastAt) {
        espnLastAt = at;
        espnLastKind = "leftover-test";
        espnPickCount = 0;
      }
      continue;
    }
    const unpacked = unpackRelayMessage(msg.message);
    if (!unpacked) continue;
    if (
      isLeftoverEspnTestPicks({
        picks: unpacked.picks,
        leagueId: unpacked.meta?.leagueId,
      })
    ) {
      if (!espnLastAt || at >= espnLastAt) {
        espnLastAt = unpacked.ts || at;
        espnLastKind = "leftover-test";
        espnPickCount = 0;
      }
      continue;
    }
    const ts = unpacked.ts || at;
    if (!espnLastAt || ts >= espnLastAt) {
      espnLastAt = ts;
      espnPickCount = unpacked.picks.length;
      espnLastKind = unpacked.picks.length
        ? "picks"
        : unpacked.meta?.reason === "relay-test"
          ? "ping"
          : "heartbeat";
    }
  }

  let ranksLastAt: number | null = null;
  let ranksLastKind: RelayKind = "none";
  let ranksCount = 0;
  for (const msg of rankLines) {
    if (msg.event && msg.event !== "message") continue;
    if (!msg.message) continue;
    const at = (Number(msg.time) || 0) * 1000 || Date.now();
    if (isLeftoverTestNtfyTitle(msg.title)) {
      if (!ranksLastAt || at >= ranksLastAt) {
        ranksLastAt = at;
        ranksLastKind = "leftover-test";
        ranksCount = 0;
      }
      continue;
    }
    try {
      const raw = JSON.parse(msg.message) as { ping?: unknown; v?: unknown; s?: unknown };
      if (raw && raw.ping && (raw.s === "fp" || raw.s === "ds")) {
        const unpacked = unpackRanksRelayMessage(msg.message);
        const ts = unpacked?.ts || at;
        if (!ranksLastAt || ts >= ranksLastAt) {
          ranksLastAt = ts;
          ranksLastKind = "ping";
          ranksCount = 0;
        }
        continue;
      }
    } catch {
      /* fall through */
    }
    const unpacked = unpackRanksRelayMessage(msg.message);
    if (!unpacked) continue;
    if (
      isLeftoverAgentRankSnapshot({
        matched: unpacked.rows.length,
        ts: unpacked.ts,
        rows: unpacked.rows,
      })
    ) {
      if (!ranksLastAt || unpacked.ts >= ranksLastAt) {
        ranksLastAt = unpacked.ts || at;
        ranksLastKind = "leftover-test";
        ranksCount = 0;
      }
      continue;
    }
    if (!unpacked.rows.length) {
      if (unpacked.ts && (!ranksLastAt || unpacked.ts >= ranksLastAt)) {
        ranksLastAt = unpacked.ts;
        ranksLastKind = "ping";
        ranksCount = 0;
      }
      continue;
    }
    if (!ranksLastAt || unpacked.ts >= ranksLastAt) {
      ranksLastAt = unpacked.ts;
      ranksLastKind = unpacked.source;
      ranksCount = unpacked.rows.length;
    }
  }

  return {
    espnLastAt,
    espnLastKind,
    espnPickCount,
    ranksLastAt,
    ranksLastKind,
    ranksCount,
  };
}

export async function postRelayTest(): Promise<{
  espnPosted: boolean;
  ranksPosted: boolean;
}> {
  const now = Date.now();
  const espnBody = JSON.stringify({
    v: 1,
    p: [],
    m: { reason: "relay-test" },
    h: "https://fantasy.espn.com/football/draft",
    t: now,
  });
  const ranksBody = JSON.stringify({
    v: 2,
    s: "fp",
    t: now,
    h: "https://draftwizard.fantasypros.com/",
    i: 0,
    n: 0,
    r: [],
    ping: 1,
  });
  const post = async (topic: string, body: string) => {
    try {
      const res = await fetch(`${NTFY_HOST}/${topic}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  const [espnPosted, ranksPosted] = await Promise.all([
    post(ESPN_RELAY_TOPIC, espnBody),
    post(RANKS_RELAY_TOPIC, ranksBody),
  ]);
  return { espnPosted, ranksPosted };
}
