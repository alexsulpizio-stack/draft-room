import { getYahooIngest, setYahooIngest, type YahooIngestPayload } from "./yahoo-ingest";
import { NTFY_HOST, YAHOO_RELAY_TOPIC } from "./relay-urls";
import { pollNtfyJson } from "./ntfy-cache";
import { isAllowedYahooHref, normalizeYahooPicks } from "./yahoo";

export const YAHOO_RELAY_URL = `${NTFY_HOST}/${YAHOO_RELAY_TOPIC}`;

type RelayMessage = {
  v: 1;
  picks: YahooIngestPayload["picks"];
  href?: string;
  title?: string;
  ts: number;
  meta?: YahooIngestPayload["meta"];
};

type NtfyLine = { event?: string; message?: string; title?: string };

function unpack(raw: string): YahooIngestPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<RelayMessage>;
    if (value.v !== 1 || !Array.isArray(value.picks)) return null;
    const picks = normalizeYahooPicks(value.picks);
    if (!picks.length && !value.href) return null;
    return {
      picks,
      href: typeof value.href === "string" ? value.href : undefined,
      title: typeof value.title === "string" ? value.title : undefined,
      ts: Number(value.ts) || Date.now(),
      meta: value.meta,
    };
  } catch {
    return null;
  }
}

export function packYahooRelay(payload: YahooIngestPayload): string {
  return JSON.stringify({
    v: 1,
    picks: normalizeYahooPicks(payload.picks),
    href: payload.href,
    title: payload.title,
    ts: payload.ts,
    meta: payload.meta,
  } satisfies RelayMessage);
}

export async function pullYahooRelayIntoIngest(): Promise<boolean> {
  const url = `${YAHOO_RELAY_URL}/json?poll=1&since=2h`;
  try {
    const text = await pollNtfyJson(url);
    let best: YahooIngestPayload | null = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let message: NtfyLine;
      try {
        message = JSON.parse(line) as NtfyLine;
      } catch {
        continue;
      }
      if (message.event && message.event !== "message") continue;
      if (!message.message) continue;
      const payload = unpack(message.message);
      if (!payload || (payload.href && !isAllowedYahooHref(payload.href))) continue;
      if (!best || payload.ts > best.ts) best = payload;
    }
    if (!best) return false;
    const current = getYahooIngest();
    if (current && current.ts >= best.ts) return false;
    setYahooIngest(best);
    return true;
  } catch {
    return false;
  }
}
