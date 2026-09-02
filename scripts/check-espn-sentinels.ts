import {
  bookmarkletOrigin,
  extractEspnDraftPicks,
  extrasFromMapped,
  ingestCorsHeaders,
  isEspnDraftNetworkUrl,
  isPlaceholderEspnName,
  isValidEspnPlayerId,
  mapEspnPicks,
  mergeBoardWithEspnExtras,
  mergeEspnPicks,
  mergeLiveEspnFields,
  remapMappedPicks,
  snapshotIdForEspnPick,
  stubFromEspn,
} from "../src/lib/espn";
import { getIngest, INGEST_PATHS, setIngest } from "../src/lib/espn-ingest";
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

const nested = extractEspnDraftPicks({
  draftDetail: {
    picks: [{ overallPickNumber: 1, teamId: 5, player: { id: 4241457, fullName: "Ja'Marr Chase" } }],
  },
});
assert(nested.length === 1 && nested[0].playerId === 4241457, `nested player.id, got ${JSON.stringify(nested)}`);
assert(nested[0].playerName === "Ja'Marr Chase", "nested player name");

const wrapped = extractEspnDraftPicks([
  {
    draftDetail: {
      picks: [{ overallPickNumber: 2, playerId: 3116406, teamId: 1 }],
    },
    players: [{ id: 3116406, fullName: "Jahmyr Gibbs" }],
  },
]);
assert(wrapped.length === 1 && wrapped[0].playerId === 3116406, "array-wrapped league payload");
assert(wrapped[0].playerName === "Jahmyr Gibbs", "name filled from players list");

const idOnly = mapEspnPicks({
  picks: [{ overallPickNumber: 1, playerId: 4241457, teamId: 5 }],
  pickOrder: [],
  teamsCount: 12,
  players: new Map([
    [
      4241457,
      { id: 4241457, name: "Ja'Marr Chase", pos: "WR", team: "CIN", ourId: chase!.id, adp: 3 },
    ],
  ]),
});
assert(idOnly.length === 1 && idOnly[0].playerId === chase!.id, `ESPN id-only pick maps to snapshot, got ${JSON.stringify(idOnly)}`);

const merged = mergeEspnPicks(
  [{ overallPickNumber: 1, playerId: -1, teamId: 0 }],
  [{ overallPickNumber: 1, playerId: -1, teamId: 0, playerName: "ESPN -1" }],
);
assert(merged.length === 0, "merge drops unfilled -1 slots");

const gibbs = PLAYERS.find((p) => p.name === "Jahmyr Gibbs");
assert(gibbs, "snapshot includes Jahmyr Gibbs");
const noCatalog = mapEspnPicks({
  picks: [{ overallPickNumber: 1, playerId: 3116406, teamId: 1, playerName: "Jahmyr Gibbs" }],
  pickOrder: [],
  teamsCount: 12,
  players: new Map(),
});
assert(
  noCatalog.length === 1 && noCatalog[0].playerId === gibbs!.id,
  `name match beats espn-* without catalog, got ${JSON.stringify(noCatalog)}`,
);

const unmatched = mapEspnPicks({
  picks: [{ overallPickNumber: 3, playerId: 999000111, teamId: 2, playerName: "Not A Real Player Xyz" }],
  pickOrder: [],
  teamsCount: 12,
  players: new Map(),
});
assert(unmatched[0].playerId.startsWith("espn-"), "unknown name stays espn-*");
assert(
  snapshotIdForEspnPick({ playerId: "espn-3116406", name: "Jahmyr Gibbs" }) === gibbs!.id,
  "client fallback remaps espn-* by name",
);
assert(
  remapMappedPicks([{ ...unmatched[0], name: "Jahmyr Gibbs", playerId: "espn-3116406" }])[0]
    .playerId === gibbs!.id,
  "remapMappedPicks uses snapshot id",
);

assert(
  isEspnDraftNetworkUrl(
    "https://fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/-99?view=mDraftDetail",
  ),
  "negative mock leagueId is a draft URL",
);
assert(
  isEspnDraftNetworkUrl("https://gambit-api.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1?view=mRoster"),
  "gambit-api draft URL",
);
assert(
  !isEspnDraftNetworkUrl("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/players?view=players_wl"),
  "players_wl is not a draft URL",
);

const cors = ingestCorsHeaders(
  new Request("http://127.0.0.1:43173/api/espn/ingest", {
    headers: { origin: "https://fantasy.espn.com" },
  }),
);
assert(cors["Access-Control-Allow-Origin"] === "https://fantasy.espn.com", "ESPN ACAO echoes origin");
assert(cors["Access-Control-Allow-Credentials"] === "true", "ESPN CORS allows credentials");

assert(
  bookmarkletOrigin("http://127.0.0.1:43173", "https://preview.example.com") ===
    "https://preview.example.com",
  "bookmarklet prefers public preview over loopback",
);

setIngest({
  picks: [{ overallPickNumber: 1, playerId: 3116406, teamId: 1, playerName: "Jahmyr Gibbs" }],
  ts: Date.now(),
  href: "https://fantasy.espn.com/football/draft?leagueId=1361349772",
});
const stored = getIngest();
assert(stored?.picks[0]?.playerName === "Jahmyr Gibbs", "ingest persist round-trips");
assert(
  INGEST_PATHS.some((p) => {
    try {
      return require("node:fs").readFileSync(p, "utf8").includes("Jahmyr Gibbs");
    } catch {
      return false;
    }
  }),
  "ingest written to disk",
);

const { writeFileSync } = require("node:fs") as typeof import("node:fs");
writeFileSync(
  INGEST_PATHS[0],
  JSON.stringify({
    picks: [{ overallPickNumber: 2, playerId: 4241457, teamId: 1, playerName: "Ja'Marr Chase" }],
    ts: Date.now() + 10,
  }),
);
const afterDisk = getIngest();
assert(
  afterDisk?.picks[0]?.playerName === "Ja'Marr Chase",
  `getIngest rereads newer disk payload, got ${JSON.stringify(afterDisk?.picks)}`,
);

const { unpackRelayMessage } = require("../src/lib/espn-relay") as typeof import("../src/lib/espn-relay");
const packed = unpackRelayMessage(
  JSON.stringify({ v: 1, p: [[1, 4241457, 5, "Ja'Marr Chase"]], t: Date.now() }),
);
assert(packed?.picks[0]?.playerId === 4241457 && packed.picks[0].playerName === "Ja'Marr Chase", "unpack relay");

console.log("espn sentinel checks passed");
console.log("sample board subtitle:", goodLine);
console.log("sentinel subtitle:", line);
