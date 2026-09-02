import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EspnIngestMeta, EspnRawPick } from "./espn";

export type IngestPayload = {
  picks: EspnRawPick[];
  href?: string;
  title?: string;
  ts: number;
  meta?: EspnIngestMeta;
};

/** Turbopack can load this module twice (ingest POST vs listen GET). Disk is the source of truth. */
export const INGEST_PATHS = [
  "/tmp/draft-room-espn-ingest.json",
  `${process.cwd()}/.data/espn-ingest.json`,
] as const;

let last: IngestPayload | null = null;

function parseStored(raw: string): IngestPayload | null {
  try {
    const v = JSON.parse(raw) as IngestPayload;
    if (!v || !Array.isArray(v.picks) || typeof v.ts !== "number") return null;
    return v;
  } catch {
    return null;
  }
}

function readDisk(): IngestPayload | null {
  for (const file of INGEST_PATHS) {
    try {
      const parsed = parseStored(readFileSync(file, "utf8"));
      if (parsed) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

function writeDisk(payload: IngestPayload) {
  const json = JSON.stringify(payload);
  for (const file of INGEST_PATHS) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, json);
    } catch {
      /* keep going — the other path may work */
    }
  }
}

export function setIngest(payload: IngestPayload) {
  last = payload;
  writeDisk(payload);
}

export function getIngest(): IngestPayload | null {
  if (last) return last;
  last = readDisk();
  return last;
}
