import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { YahooRawPick } from "./yahoo";

export type YahooIngestPayload = {
  picks: YahooRawPick[];
  href?: string;
  title?: string;
  ts: number;
  meta?: {
    leagueId?: string;
    season?: number;
    teams?: number;
    draftType?: "snake" | "linear";
    slot?: number;
    roomName?: string;
  };
};

const PATHS = [
  "/tmp/draft-room-yahoo-ingest.json",
  `${process.cwd()}/.data/yahoo-ingest.json`,
] as const;

let last: YahooIngestPayload | null = null;

function parse(raw: string): YahooIngestPayload | null {
  try {
    const value = JSON.parse(raw) as YahooIngestPayload;
    if (!value || !Array.isArray(value.picks) || typeof value.ts !== "number") return null;
    return value;
  } catch {
    return null;
  }
}

function readDisk() {
  for (const file of PATHS) {
    try {
      const value = parse(readFileSync(file, "utf8"));
      if (value) return value;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

function writeDisk(value: YahooIngestPayload) {
  const json = JSON.stringify(value);
  for (const file of PATHS) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, json);
    } catch {
      /* one writable location is sufficient */
    }
  }
}

export function setYahooIngest(value: YahooIngestPayload) {
  last = value;
  writeDisk(value);
}

export function getYahooIngest(): YahooIngestPayload | null {
  const disk = readDisk();
  if (disk && (!last || disk.ts >= last.ts)) last = disk;
  return last;
}

export function clearYahooIngest() {
  setYahooIngest({ picks: [], href: "cleared", ts: Date.now() });
}
