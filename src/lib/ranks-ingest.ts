import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RankImportSource } from "./parse-import";

export type RankIngestRow = {
  rank: number;
  name: string;
  pos?: string;
  team?: string;
};

export type RankIngestPayload = {
  source: RankImportSource;
  rows: RankIngestRow[];
  text?: string;
  href?: string;
  title?: string;
  ts: number;
  matched?: number;
  patches?: Record<string, { fpRank?: number; dsRank?: number; adp?: number }>;
  unmatched?: string[];
  label?: string;
};

export type RanksIngestStore = {
  fp?: RankIngestPayload;
  ds?: RankIngestPayload;
};

const PATHS = [
  "/tmp/draft-room-ranks-ingest.json",
  `${process.cwd()}/.data/ranks-ingest.json`,
] as const;

let last: RanksIngestStore | null = null;

function parseStored(raw: string): RanksIngestStore | null {
  try {
    const v = JSON.parse(raw) as RanksIngestStore;
    if (!v || typeof v !== "object") return null;
    return v;
  } catch {
    return null;
  }
}

function readDisk(): RanksIngestStore | null {
  for (const file of PATHS) {
    try {
      const parsed = parseStored(readFileSync(file, "utf8"));
      if (parsed) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

function writeDisk(payload: RanksIngestStore) {
  const json = JSON.stringify(payload);
  for (const file of PATHS) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, json);
    } catch {
      /* keep going */
    }
  }
}

export function getRanksIngest(): RanksIngestStore {
  const disk = readDisk();
  if (disk) last = disk;
  return last ?? {};
}

export function setRanksIngestSource(payload: RankIngestPayload) {
  const cur = getRanksIngest();
  const next: RanksIngestStore = {
    ...cur,
    [payload.source]: payload,
  };
  last = next;
  writeDisk(next);
  return next;
}

export function clearRanksIngest(source?: RankImportSource) {
  const cur = getRanksIngest();
  if (!source) {
    last = {};
    writeDisk(last);
    return last;
  }
  const next = { ...cur };
  delete next[source];
  last = next;
  writeDisk(next);
  return next;
}
