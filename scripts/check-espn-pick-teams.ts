/**
 * Focused checks for ESPN pick → Draft Room team slot mapping.
 * Run: npx tsx scripts/check-espn-pick-teams.ts
 */
import { pickOwner } from "../src/lib/draft";
import {
  mapEspnPicks,
  mergeIngestMeta,
  resolveEspnTeamSlot,
} from "../src/lib/espn";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const TEAMS = 12;

// Snake 12-team: overall → slot via pickOwner
const snakeExpect: Array<[number, number]> = [
  [1, 1],
  [12, 12],
  [13, 12],
  [14, 11],
  [24, 1],
  [25, 1],
];
for (const [overall, slot] of snakeExpect) {
  const got = pickOwner(overall, TEAMS, "snake");
  assert(got === slot, `snake pick ${overall} → team ${slot}, got ${got}`);
}

// Without pickOrder, never treat raw ESPN teamId as slot — use overall math
assert(
  resolveEspnTeamSlot({
    teamId: 5,
    overall: 1,
    pickOrder: [],
    teamsCount: TEAMS,
    draftType: "snake",
  }) === 1,
  "missing pickOrder: pick 1 with ESPN teamId 5 must map to slot 1, not 5",
);
assert(
  resolveEspnTeamSlot({
    teamId: 8,
    overall: 13,
    pickOrder: [],
    teamsCount: TEAMS,
    draftType: "snake",
  }) === 12,
  "missing pickOrder: pick 13 with ESPN teamId 8 must map to slot 12",
);

// Non-sequential ESPN teamIds in draft order
const pickOrder = [8, 3, 11, 1, 5, 9, 2, 12, 7, 4, 10, 6]; // JackAL = ESPN id 5 → slot 5
assert(
  resolveEspnTeamSlot({
    teamId: 8,
    overall: 1,
    pickOrder,
    teamsCount: TEAMS,
    draftType: "snake",
  }) === 1,
  "pickOrder: ESPN team 8 (first) → slot 1",
);
assert(
  resolveEspnTeamSlot({
    teamId: 6,
    overall: 12,
    pickOrder,
    teamsCount: TEAMS,
    draftType: "snake",
  }) === 12,
  "pickOrder: ESPN team 6 (last) → slot 12",
);
assert(
  resolveEspnTeamSlot({
    teamId: 6,
    overall: 13,
    pickOrder,
    teamsCount: TEAMS,
    draftType: "snake",
  }) === 12,
  "pickOrder: ESPN team 6 on pick 13 (snake reverse) → slot 12",
);
assert(
  resolveEspnTeamSlot({
    teamId: 10,
    overall: 14,
    pickOrder,
    teamsCount: TEAMS,
    draftType: "snake",
  }) === 11,
  "pickOrder: ESPN team 10 → slot 11",
);
assert(
  resolveEspnTeamSlot({
    teamId: 5,
    overall: 5,
    pickOrder,
    teamsCount: TEAMS,
    draftType: "snake",
  }) === 5,
  "JackAL ESPN teamId 5 → draft slot 5 via pickOrder",
);

// mapEspnPicks end-to-end with scrambled teamIds and no pickOrder
const scrambledNoOrder = mapEspnPicks({
  picks: [
    { overallPickNumber: 1, playerId: 3116406, teamId: 8, playerName: "Jahmyr Gibbs" },
    { overallPickNumber: 12, playerId: 4241457, teamId: 6, playerName: "Ja'Marr Chase" },
    { overallPickNumber: 13, playerId: 4426385, teamId: 6, playerName: "Bijan Robinson" },
    { overallPickNumber: 14, playerId: 4430807, teamId: 10, playerName: "Breece Hall" },
  ],
  pickOrder: [],
  teamsCount: TEAMS,
  players: new Map(),
  draftType: "snake",
});
assert(scrambledNoOrder[0]?.team === 1, `no-order pick1 team, got ${scrambledNoOrder[0]?.team}`);
assert(scrambledNoOrder[1]?.team === 12, `no-order pick12 team, got ${scrambledNoOrder[1]?.team}`);
assert(scrambledNoOrder[2]?.team === 12, `no-order pick13 team, got ${scrambledNoOrder[2]?.team}`);
assert(scrambledNoOrder[3]?.team === 11, `no-order pick14 team, got ${scrambledNoOrder[3]?.team}`);

const scrambledWithOrder = mapEspnPicks({
  picks: [
    { overallPickNumber: 1, playerId: 3116406, teamId: 8, playerName: "Jahmyr Gibbs" },
    { overallPickNumber: 12, playerId: 4241457, teamId: 6, playerName: "Ja'Marr Chase" },
    { overallPickNumber: 13, playerId: 4426385, teamId: 6, playerName: "Bijan Robinson" },
    { overallPickNumber: 14, playerId: 4430807, teamId: 10, playerName: "Breece Hall" },
  ],
  pickOrder,
  teamsCount: TEAMS,
  players: new Map(),
  draftType: "snake",
});
assert(scrambledWithOrder[0]?.team === 1, `ordered pick1 team, got ${scrambledWithOrder[0]?.team}`);
assert(scrambledWithOrder[1]?.team === 12, `ordered pick12 team, got ${scrambledWithOrder[1]?.team}`);
assert(scrambledWithOrder[2]?.team === 12, `ordered pick13 team, got ${scrambledWithOrder[2]?.team}`);
assert(scrambledWithOrder[3]?.team === 11, `ordered pick14 team, got ${scrambledWithOrder[3]?.team}`);

// mergeIngestMeta: teamId alone must not become slot; pickOrder maps it
const metaNoOrder = mergeIngestMeta({ teams: 12, teamId: 5, draftType: "snake" });
assert(metaNoOrder.slot == null, `teamId without pickOrder must not set slot, got ${metaNoOrder.slot}`);

const metaWithOrder = mergeIngestMeta({
  teams: 12,
  teamId: 5,
  pickOrder,
  draftType: "snake",
});
assert(metaWithOrder.slot === 5, `teamId 5 with pickOrder → slot 5, got ${metaWithOrder.slot}`);
assert(
  metaWithOrder.pickOrder?.length === 12 && metaWithOrder.pickOrder[0] === 8,
  "pickOrder preserved on meta",
);

// Partial meta must not wipe an established pickOrder (heartbeat / empty scrape).
const prior = mergeIngestMeta({
  teams: 12,
  teamId: 5,
  pickOrder,
  draftType: "snake",
  leagueName: "JFL 28",
  teamNames: Array.from({ length: 12 }, (_, i) => `T${i + 1}`),
});
const partial = mergeIngestMeta({ leagueId: "1361349772", reason: "0 filled slots" });
const kept = { ...prior };
for (const [k, v] of Object.entries(partial) as Array<[string, unknown]>) {
  if (v !== undefined && v !== null) (kept as Record<string, unknown>)[k] = v;
}
assert(kept.pickOrder?.length === 12 && kept.pickOrder[0] === 8, "partial merge keeps pickOrder");
assert(kept.teams === 12 && kept.slot === 5, "partial merge keeps teams/slot");
assert(!(partial as { pickOrder?: number[] }).pickOrder, "partial mergeIngestMeta omits missing pickOrder");

console.log("check-espn-pick-teams: ok");
