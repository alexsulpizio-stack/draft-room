import {
  extrasFromMapped,
  isPlaceholderEspnName,
  isValidEspnPlayerId,
  mapEspnPicks,
  mergeBoardWithEspnExtras,
  mergeEspnPicks,
  mergeLiveEspnFields,
  stubFromEspn,
} from "../src/lib/espn";
import { playerSublineText } from "../src/lib/player-display";
import { PLAYERS } from "../src/lib/players";
import type { Player } from "../src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const chase = PLAYERS.find((p) => p.name === "Ja'Marr Chase");
assert(chase, "snapshot includes Ja'Marr Chase");

assert(isValidEspnPlayerId(-1) === false, "playerId -1 is empty");
assert(isValidEspnPlayerId(0) === false, "playerId 0 is empty");
assert(isValidEspnPlayerId(4241457) === true, "real ESPN id");
assert(isPlaceholderEspnName("ESPN -1") === true, "ESPN -1 is a placeholder name");
assert(isPlaceholderEspnName("ESPN 4241457") === false, "ESPN + real id is not a placeholder");

const kept = mergeLiveEspnFields(chase, { team: "FA", bye: 0, adp: -1 });
assert(kept.team === chase!.team, `keep snapshot team, got ${kept.team}`);
assert(kept.bye === chase!.bye && kept.bye > 0, `keep snapshot bye, got ${kept.bye}`);
assert(kept.adp === chase!.adp && kept.adp > 0, `keep snapshot ADP, got ${kept.adp}`);

const live = mergeLiveEspnFields(chase, { team: "CIN", bye: 12, adp: 3 });
assert(live.team === "CIN" && live.bye === 12 && live.adp === 3, "real ESPN values overlay");

const mappedEmpty = mapEspnPicks({
  picks: [
    { overallPickNumber: 1, playerId: -1, teamId: 0 },
    { overallPickNumber: 2, playerId: 0, teamId: 0, playerName: "ESPN -1" },
    { overallPickNumber: 5, playerId: -1, teamId: 0, playerName: "Ja'Marr Chase" },
  ],
  pickOrder: [],
  teamsCount: 12,
  players: new Map(),
});
assert(mappedEmpty.every((p) => p.playerId !== "espn--1"), "no espn--1 ids");
assert(
  mappedEmpty.length === 1 && mappedEmpty[0].playerId === chase!.id,
  `Chase matched from name despite playerId -1, got ${JSON.stringify(mappedEmpty)}`,
);
assert(mappedEmpty[0].nflTeam === chase!.team, "mapped team is snapshot, not FA");

const extras = extrasFromMapped(mappedEmpty);
const board = mergeBoardWithEspnExtras(PLAYERS, extras);
const onBoard = board.find((p) => p.id === chase!.id)!;
assert(onBoard.team === chase!.team, "board team not wiped to FA");
assert(onBoard.bye === chase!.bye, "board bye not wiped to 0");
assert(onBoard.adp === chase!.adp, "board ADP not wiped to -1");
assert(
  !board.some((p) => p.name === "ESPN -1" || p.id === "espn--1"),
  "placeholder stubs not added",
);

const stub = stubFromEspn({
  espnId: -1,
  name: "Ja'Marr Chase",
  pos: "WR",
  team: "FA",
  adp: -1,
});
assert(stub.id === chase!.id, "named stub uses snapshot id");
assert(stub.team === chase!.team && stub.bye === chase!.bye, "named stub keeps snapshot team/bye");

const orphan = stubFromEspn({
  espnId: -1,
  name: "ESPN -1",
  pos: "WR",
  team: "FA",
  adp: -1,
});
assert(orphan.adp >= 900, `orphan ADP is unranked sentinel, got ${orphan.adp}`);
assert(orphan.id !== "espn--1", `orphan id is not espn--1, got ${orphan.id}`);

const line = playerSublineText({
  ...chase!,
  adp: -1,
  team: "FA",
  bye: 0,
} satisfies Player);
assert(!line.includes("-1"), `subtitle hides ESPN -1: ${line}`);
assert(!/bye 0/i.test(line), `subtitle hides bye 0: ${line}`);
assert(!/\bFA\b/.test(line), `subtitle hides unknown FA: ${line}`);

const goodLine = playerSublineText(chase!);
assert(/^ESPN \d+ [A-Z]{2,3} · bye \d+$/.test(goodLine), `real subtitle: ${goodLine}`);

const merged = mergeEspnPicks(
  [{ overallPickNumber: 1, playerId: -1, teamId: 0 }],
  [{ overallPickNumber: 1, playerId: -1, teamId: 0, playerName: "ESPN -1" }],
);
assert(merged.length === 0, "merge drops unfilled -1 slots");

console.log("espn sentinel checks passed");
console.log("sample board subtitle:", goodLine);
console.log("sentinel subtitle:", line);
