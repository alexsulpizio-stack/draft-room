import { NTFY_HOST, RANKS_RELAY_TOPIC } from "./relay-urls";
import { commitRankScrape } from "./ranks-apply";
import type { RankIngestRow } from "./ranks-ingest";
import type { RankImportSource } from "./parse-import";

export { RANKS_RELAY_TOPIC };
export const STABLE_RANKS_RELAY_TOPIC = RANKS_RELAY_TOPIC;

export function ranksRelayUrl(topic = RANKS_RELAY_TOPIC): string {
  return `${NTFY_HOST}/${topic}`;
}

export type UnpackedRanks = {
  source: RankImportSource;
  rows: RankIngestRow[];
  href?: string;
  ts: number;
};

type PackedChunk = {
  v?: unknown;
  s?: unknown;
  t?: unknown;
  h?: unknown;
  i?: unknown;
  n?: unknown;
  r?: unknown;
};

function isSource(v: unknown): v is RankImportSource {
  return v === "fp" || v === "ds";
}

function rowFromTuple(raw: unknown): RankIngestRow | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const rank = Number(raw[0]);
  const name = typeof raw[1] === "string" ? raw[1].trim() : "";
  if (!name || !Number.isFinite(rank) || rank <= 0) return null;
  const pos = typeof raw[2] === "string" && raw[2] ? raw[2] : undefined;
  const team = typeof raw[3] === "string" && raw[3] ? raw[3] : undefined;
  return { rank, name, pos, team };
}

/** Decode one bookmarklet ntfy body (single chunk or legacy full JSON). */
export function unpackRanksRelayMessage(raw: string): {
  source: RankImportSource;
  ts: number;
  href?: string;
  index: number;
  total: number;
  rows: RankIngestRow[];
} | null {
  try {
    const v = JSON.parse(raw) as PackedChunk & {
      source?: unknown;
      rows?: unknown;
      href?: unknown;
      ts?: unknown;
    };
    if (v && v.v === 2 && isSource(v.s) && Array.isArray(v.r)) {
      const rows = v.r.map(rowFromTuple).filter((r): r is RankIngestRow => Boolean(r));
      return {
        source: v.s,
        ts: Number(v.t) || Date.now(),
        href: typeof v.h === "string" ? v.h : undefined,
        index: Number(v.i) || 0,
        total: Number(v.n) || 1,
        rows,
      };
    }
    if (isSource(v.source) && Array.isArray(v.rows)) {
      const rows: RankIngestRow[] = [];
      for (const item of v.rows) {
        if (!item || typeof item !== "object") continue;
        const row = item as Partial<RankIngestRow>;
        const name = typeof row.name === "string" ? row.name.trim() : "";
        const rank = Number(row.rank);
        if (!name || !Number.isFinite(rank) || rank <= 0) continue;
        rows.push({
          rank,
          name,
          pos: typeof row.pos === "string" ? row.pos : undefined,
          team: typeof row.team === "string" ? row.team : undefined,
        });
      }
      return {
        source: v.source,
        ts: Number(v.ts) || Date.now(),
        href: typeof v.href === "string" ? v.href : undefined,
        index: 0,
        total: 1,
        rows,
      };
    }
  } catch {
    return null;
  }
  return null;
}

type Group = {
  source: RankImportSource;
  ts: number;
  href?: string;
  total: number;
  chunks: Map<number, RankIngestRow[]>;
};

function groupKey(source: RankImportSource, ts: number) {
  return `${source}:${ts}`;
}

/** Merge chunked ntfy bodies into the newest usable FP and DS snapshots. */
export function selectBestRankSnapshots(bodies: string[]): {
  fp?: UnpackedRanks;
  ds?: UnpackedRanks;
} {
  const groups = new Map<string, Group>();
  for (const raw of bodies) {
    if (!raw.trim()) continue;
    const unpacked = unpackRanksRelayMessage(raw);
    if (!unpacked || unpacked.rows.length === 0) continue;
    const key = groupKey(unpacked.source, unpacked.ts);
    let g = groups.get(key);
    if (!g) {
      g = {
        source: unpacked.source,
        ts: unpacked.ts,
        href: unpacked.href,
        total: unpacked.total,
        chunks: new Map(),
      };
      groups.set(key, g);
    }
    if (unpacked.href) g.href = unpacked.href;
    g.total = Math.max(g.total, unpacked.total);
    g.chunks.set(unpacked.index, unpacked.rows);
  }

  const best: { fp?: UnpackedRanks; ds?: UnpackedRanks } = {};
  for (const g of groups.values()) {
    const rows: RankIngestRow[] = [];
    const seen = new Set<string>();
    const indexes = [...g.chunks.keys()].sort((a, b) => a - b);
    for (const i of indexes) {
      for (const row of g.chunks.get(i) ?? []) {
        const k = row.name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push(row);
      }
    }
    if (rows.length < 5) continue;
    const snap: UnpackedRanks = { source: g.source, rows, href: g.href, ts: g.ts };
    const cur = best[g.source];
    if (!cur || snap.ts > cur.ts || (snap.ts === cur.ts && snap.rows.length > cur.rows.length)) {
      best[g.source] = snap;
    }
  }
  return best;
}

type NtfyLine = { event?: string; message?: string };

export async function pullRanksRelayIntoIngest(): Promise<boolean> {
  const url = `${NTFY_HOST}/${RANKS_RELAY_TOPIC}/json?poll=1&since=2h`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text.trim()) return false;
    const bodies: string[] = [];
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
      bodies.push(msg.message);
    }
    const best = selectBestRankSnapshots(bodies);
    let changed = false;
    for (const snap of [best.fp, best.ds]) {
      if (!snap) continue;
      const result = commitRankScrape({
        source: snap.source,
        rows: snap.rows,
        href: snap.href,
        ts: snap.ts,
      });
      if (result.applied) changed = true;
    }
    return changed;
  } catch {
    return false;
  }
}
