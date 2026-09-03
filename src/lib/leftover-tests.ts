export type RelayKind = "picks" | "heartbeat" | "fp" | "ds" | "ping" | "leftover-test" | "none";

/** Prior agent leftover: 3 test ESPN picks on a non-JFL league. Never mark these taken. */
export const LEFTOVER_ESPN_LEAGUE = "96402745";
const LEFTOVER_ESPN_NAMES = ["jahmyr gibbs", "bijan robinson", "justin jefferson"];
export const LEFTOVER_RANK_SLUGS = [
  "jamarr-chase",
  "jahmyr-gibbs",
  "bijan-robinson",
  "justin-jefferson",
  "saquon-barkley",
  "ceedee-lamb",
  "amon-ra-st-brown",
  "puka-nacua",
];
const LEFTOVER_RANK_TS = new Set([1788461934456, 1788465829002]);

export function isLeftoverTestNtfyTitle(title: unknown): boolean {
  return typeof title === "string" && /draft-room-test/i.test(title);
}

export function isLeftoverEspnTestPicks(args: {
  picks: Array<{ playerName?: string }>;
  leagueId?: string;
}): boolean {
  if (args.leagueId && args.leagueId === LEFTOVER_ESPN_LEAGUE && args.picks.length <= 8) {
    const names = new Set(args.picks.map((p) => (p.playerName || "").toLowerCase()));
    return LEFTOVER_ESPN_NAMES.every((n) => names.has(n));
  }
  return false;
}

export function isLeftoverAgentRankSnapshot(args: {
  matched?: number;
  ts?: number;
  patches?: Record<string, unknown>;
  rows?: Array<{ name?: string }>;
}): boolean {
  // Only the known leftover agent timestamps — a real 8-name remaining board
  // of stars must still apply.
  return Boolean(args.ts && LEFTOVER_RANK_TS.has(args.ts));
}
