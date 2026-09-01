import type { EspnRawPick } from "./espn";

export type IngestPayload = {
  picks: EspnRawPick[];
  href?: string;
  title?: string;
  ts: number;
};

let last: IngestPayload | null = null;

export function setIngest(payload: IngestPayload) {
  last = payload;
}

export function getIngest(): IngestPayload | null {
  return last;
}
