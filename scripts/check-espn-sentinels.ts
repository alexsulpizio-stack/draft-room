import {
  bookmarkletOrigin,
  buildBookmarklet,
  cleanPickLogName,
  extractEspnDraftPicks,
  isDisplayablePlayerName,
  looksLikeEspnStatDump,
  pickLogDisplayName,
  extrasFromMapped,
  ingestCorsHeaders,
  isEspnDraftNetworkUrl,
  isPlaceholderEspnName,
  isValidEspnPlayerId,
  mapEspnPicks,
  mergeBoardWithEspnExtras,
  mergeEspnPicks,
  mergeLiveEspnFields,
  parseEspnPickLog,
  remapMappedPicks,
  snapshotIdForEspnPick,
  stubFromEspn,
} from "../src/lib/espn";
import { clearIngest, getIngest, INGEST_PATHS, setIngest } from "../src/lib/espn-ingest";
import { buildCompressedEspnBookmarklet } from "../src/lib/bookmarklet-compress";
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

const { resolveEspnBookmarkOrigin, requestPublicOrigin, configuredPublicOrigin, originDiagnostics } =
  require("../src/lib/espn") as typeof import("../src/lib/espn");
assert(
  resolveEspnBookmarkOrigin("http://127.0.0.1:43173", "https://share.example.com") ===
    "https://share.example.com",
  "resolveEspnBookmarkOrigin prefers public",
);
assert(
  resolveEspnBookmarkOrigin("https://share.example.com", "http://127.0.0.1:43173") ===
    "https://share.example.com",
  "resolveEspnBookmarkOrigin keeps non-loopback page",
);

{
  const prev = process.env.DRAFT_ROOM_PUBLIC_URL;
  process.env.DRAFT_ROOM_PUBLIC_URL = "https://env-preview.example.com";
  const fromEnv = requestPublicOrigin(
    new Request("http://127.0.0.1:43173/api/espn/listen", {
      headers: { host: "127.0.0.1:43173" },
    }),
  );
  assert(
    fromEnv === "https://env-preview.example.com",
    `loopback Host uses DRAFT_ROOM_PUBLIC_URL, got ${fromEnv}`,
  );
  const forwarded = requestPublicOrigin(
    new Request("http://127.0.0.1:43173/api/espn/listen", {
      headers: {
        host: "127.0.0.1:43173",
        "x-forwarded-host": "forwarded.example.com",
        "x-forwarded-proto": "https",
      },
    }),
  );
  assert(
    forwarded === "https://forwarded.example.com",
    `x-forwarded-host wins over env when present, got ${forwarded}`,
  );
  if (prev === undefined) delete process.env.DRAFT_ROOM_PUBLIC_URL;
  else process.env.DRAFT_ROOM_PUBLIC_URL = prev;
}

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

const { unpackRelayMessage, applyRelayToIngest } = require("../src/lib/espn-relay") as typeof import("../src/lib/espn-relay");
const packed = unpackRelayMessage(
  JSON.stringify({ v: 1, p: [[1, 4241457, 5, "Ja'Marr Chase"]], t: Date.now() }),
);
assert(packed?.picks[0]?.playerId === 4241457 && packed.picks[0].playerName === "Ja'Marr Chase", "unpack relay");

const emptyBeat = unpackRelayMessage(
  JSON.stringify({
    v: 1,
    p: [],
    m: { leagueId: "96402745", reason: "0 filled slots" },
    h: "https://fantasy.espn.com/football/draft?leagueId=96402745",
    t: Date.now(),
  }),
);
assert(emptyBeat && emptyBeat.picks.length === 0 && emptyBeat.href?.includes("espn.com"), "empty heartbeat unpacks");

const nameOnly = unpackRelayMessage(
  JSON.stringify({
    v: 1,
    p: [
      [1, 0, 1, "Ja'Marr Chase"],
      [2, 0, 2, "Bijan Robinson"],
    ],
    h: "https://fantasy.espn.com/football/draft?leagueId=96402745",
    t: Date.now(),
  }),
);
assert(
  nameOnly?.picks.length === 2 && nameOnly.picks[0].playerId === 0 && nameOnly.picks[0].playerName === "Ja'Marr Chase",
  "name-only relay rows survive unpack",
);

const afterBeat = applyRelayToIngest(
  {
    picks: [{ overallPickNumber: 1, playerId: 0, teamId: 1, playerName: "Ja'Marr Chase" }],
    ts: 100,
    href: "https://fantasy.espn.com/football/draft",
  },
  null,
  {
    picks: [],
    href: "https://fantasy.espn.com/football/draft",
    ts: 200,
    meta: { reason: "0 filled slots" },
  },
);
assert(afterBeat?.picks.length === 1 && afterBeat.picks[0].playerName === "Ja'Marr Chase", "heartbeat does not wipe picks");
assert(afterBeat?.ts === 200, "heartbeat refreshes connected ts");

const staleIgnored = applyRelayToIngest(
  { picks: [], ts: 500, href: "cleared" },
  {
    picks: [{ overallPickNumber: 1, playerId: 0, teamId: 1, playerName: "Ja'Marr Chase" }],
    href: "https://fantasy.espn.com/football/draft",
    ts: 100,
  },
  null,
);
assert(staleIgnored?.picks.length === 0 && staleIgnored.href === "cleared", "stale ntfy picks do not undo a clear");

const newerAfterClear = applyRelayToIngest(
  { picks: [], ts: 500, href: "cleared" },
  {
    picks: [{ overallPickNumber: 1, playerId: 0, teamId: 1, playerName: "Bijan Robinson" }],
    href: "https://fantasy.espn.com/football/draft",
    ts: 900,
  },
  null,
);
assert(
  newerAfterClear?.picks.length === 1 && newerAfterClear.picks[0].playerName === "Bijan Robinson",
  "newer ntfy applies after an intentional block-relay clear",
);

const replayAfterForeign = applyRelayToIngest(
  { picks: [], ts: 0, href: "cleared" },
  {
    picks: [{ overallPickNumber: 1, playerId: 0, teamId: 1, playerName: "Ja'Marr Chase" }],
    href: "https://fantasy.espn.com/football/draft",
    ts: 100,
  },
  null,
);
assert(
  replayAfterForeign?.picks.length === 1 && replayAfterForeign.picks[0].playerName === "Ja'Marr Chase",
  "ts=0 foreign clear allows ESPN relay replay",
);

const richerOlder = applyRelayToIngest(
  {
    picks: [{ overallPickNumber: 1, playerId: 0, teamId: 1, playerName: "Ja'Marr Chase" }],
    ts: 500,
    href: "https://fantasy.espn.com/football/draft",
  },
  {
    picks: [
      { overallPickNumber: 1, playerId: 0, teamId: 1, playerName: "Ja'Marr Chase" },
      { overallPickNumber: 2, playerId: 0, teamId: 2, playerName: "Bijan Robinson" },
    ],
    href: "https://fantasy.espn.com/football/draft",
    ts: 100,
  },
  null,
);
assert(richerOlder?.picks.length === 2, "older richer relay grows past newer partial ingest");

assert(cleanPickLogName("Ja'Marr Chase WR CIN") === "Ja'Marr Chase", "strip pos/team from scraped name");
assert(cleanPickLogName("Ja'Marr Chase, WR, CIN") === "Ja'Marr Chase", "comma pos/team after name");
assert(cleanPickLogName("Chase, Ja'Marr") === "Ja'Marr Chase", "flip last, first");
assert(cleanPickLogName("Chuba Hubbard") === "Chuba Hubbard", "do not eat trailing d as pos code");
assert(cleanPickLogName("93 Chuba Hubbard") === "Chuba Hubbard", "strip leading board rank");
assert(cleanPickLogName("83 Jonathon Brooks Q") === "Jonathon Brooks", "strip rank and injury letter");
assert(cleanPickLogName("Rico Dowdle · Molesters") === "Rico Dowdle", "strip middle-dot team suffix");
assert(cleanPickLogName("Amon-Ra St. Brown") === "Amon-Ra St. Brown", "keep hyphenated player names");
assert(cleanPickLogName("0 0 0 0 0 0 0 190 765 4 43 41 300 1 17 1") === "", "stat dump is not a name");
assert(looksLikeEspnStatDump("0 0 0 0 0 0 0 190 765 4 43 41 300 1 17 1") === true, "ESPN stat line detected");
assert(looksLikeEspnStatDump("93 Chuba Hubbard") === false, "rank + name is not a stat dump");
assert(isPlaceholderEspnName("0 0 0 0 0 0 0 190 765 4 43") === true, "stat dump is a placeholder name");
assert(isDisplayablePlayerName("Chuba Hubbard") === true, "real name is displayable");
assert(isDisplayablePlayerName("0 0 0 0 190 765") === false, "ints are not displayable");
assert(isDisplayablePlayerName(["0", "0", "190"]) === false, "array children are not a name");
assert(pickLogDisplayName({ name: "0 0 0 0 190 765 4 43" }) === "Waiting for name", "pick log never dumps ints");
assert(pickLogDisplayName({ name: "Tucker Kraft" }) === "Tucker Kraft", "pick log shows real names");
assert(pickLogDisplayName(undefined) === "Waiting for name", "missing player waits");
const log = parseEspnPickLog("1.01 Ja'Marr Chase WR CIN 1.02 Bijan Robinson RB ATL", 12);
assert(log.length === 2, `collapsed pick log parsed, got ${log.length}`);
assert(log[0].playerName === "Ja'Marr Chase" && log[1].playerName === "Bijan Robinson", "collapsed names match snapshot");
assert(log[0].overallPickNumber === 1 && log[1].overallPickNumber === 2, "1.01 / 1.02 overalls");

const scrapedBoard = parseEspnPickLog(
  [
    "75.05 0 0 0 0 0 0 0 190 765 4 43 41 300 1 17 1 · Bradys Sports Cards",
    "91.03 93 Chuba Hubbard · Bradys Sports Cards",
    "48.08 0 0 0 0 0 0 0 2 8 0 3 68 777 4 38 · you",
    "18.07 92 Tucker Kraft Q · 2 Street",
    "4.05 88 Rico Dowdle · Molesters",
    "13.04 83 Jonathon Brooks Q · Finest Meats and Cheeses",
    "72.06 82 Wan'Dale Robinson Q · It's Easy",
    "95.01 Alec Pierce · Deadman Inc.",
  ].join("\n"),
  12,
);
assert(scrapedBoard.length === 0, "projection table with no 1.01–3.XX is not a pick log");
assert(
  !scrapedBoard.some((p) => /0 0 0/.test(p.playerName || "")),
  "stat-dump rows are not ingested as picks",
);
const realLog = parseEspnPickLog(
  "1.01 Ja'Marr Chase WR CIN\n1.02 Bijan Robinson RB ATL\n4.05 88 Rico Dowdle · Molesters\n13.04 83 Jonathon Brooks Q · Finest Meats",
  12,
);
assert(
  realLog.some((p) => p.playerName === "Rico Dowdle" && p.overallPickNumber === 41),
  "4.05 Rico Dowdle is a real pick when the log starts at 1.01",
);
assert(
  realLog.some((p) => p.playerName === "Jonathon Brooks" && p.overallPickNumber === 148),
  "13.04 Jonathon Brooks is a real pick when the log starts at 1.01",
);
assert(
  !realLog.some((p) => (p.playerName || "").includes("Chuba")),
  "91.03 projected points + rank is not a pick",
);

const mappedDump = mapEspnPicks({
  picks: [
    { overallPickNumber: 893, playerId: 0, teamId: 0, playerName: "0 0 0 0 0 0 0 190 765 4 43 41 300 1 17 1" },
    { overallPickNumber: 1083, playerId: 0, teamId: 0, playerName: "93 Chuba Hubbard" },
    { overallPickNumber: 41, playerId: 0, teamId: 8, playerName: "88 Rico Dowdle" },
  ],
  pickOrder: [],
  teamsCount: 12,
  players: new Map(),
});
assert(mappedDump.length === 1 && mappedDump[0].name === "Rico Dowdle", "listen mapping drops stat dumps and projection overalls");
assert(mappedDump[0].playerId && !/^espn-0-0/.test(mappedDump[0].playerId), "real pick maps to a snapshot id");

const mappedPlayerList = mapEspnPicks({
  picks: [
    { overallPickNumber: 893, playerId: 0, teamId: 0, playerName: "George Kittle" },
    { overallPickNumber: 870, playerId: 0, teamId: 0, playerName: "Jaylen Warren" },
    { overallPickNumber: 858, playerId: 0, teamId: 0, playerName: "Jonathon Brooks" },
    { overallPickNumber: 41, playerId: 0, teamId: 8, playerName: "Rico Dowdle" },
    { overallPickNumber: 151, playerId: 0, teamId: 7, playerName: "Brandon Aubrey" },
  ],
  pickOrder: [],
  teamsCount: 12,
  players: new Map(),
});
assert(mappedPlayerList.length === 0, "listen drops player-list scrapes with no early-round picks");

const bm = buildBookmarklet("http://127.0.0.1:43173", "https://ntfy.sh/drjfl28jackal");
assert(bm.startsWith("javascript:"), "bookmarklet protocol");
assert(bm.includes("/\\s+/g"), "bookmarklet keeps \\\\s whitespace regex");
assert(bm.includes("^ESPN\\s+-?\\d+$"), "bookmarklet keeps ESPN placeholder regex");
assert(bm.includes("(\\d{1,2})\\.(\\d{1,2})\\b"), "bookmarklet keeps pick-number regex");
assert(bm.includes("[A-Za-z]{2,}"), "bookmarklet rejects nameless integer dumps");
assert(bm.includes(".r>16"), "bookmarklet ignores projected-point X.YY above round 16");
assert(bm.includes("0){3,}"), "bookmarklet drops leading 0 0 0 0 stat lines");
assert(!bm.includes("/^ESPNs+-?d+$"), "bookmarklet must not cook \\\\s/\\\\d away");
assert(!bm.includes(".replace(/s+/g"), "bookmarklet must not collapse the letter s");
assert(bm.includes('badge(0,"starting")'), "badge paints before scrape/post");
assert(bm.includes("sending"), "badge updates before relay POST");
assert(
  bm.includes('host==="espn.com"') || bm.includes('host==="espn.com"||'),
  "bookmarklet refuses non-ESPN hosts",
);
assert(bm.includes("Sync FP ranks") || bm.includes("Sync DS ranks"), "bookmarklet points users at FP/DS bookmarks");
const espnPacked = buildCompressedEspnBookmarklet("http://127.0.0.1:43173", "https://ntfy.sh/drjfl28jackal");
assert(espnPacked.startsWith("javascript:"), "compressed bookmarklet protocol");
assert(espnPacked.length < 9000, `compressed ESPN bookmarklet must fit Chrome, got ${espnPacked.length}`);
assert(espnPacked.includes("DecompressionStream"), "loader gunzips scrape after badge");
assert(espnPacked.includes('badge(0,"starting")'), "compressed loader badges first");
assert(!espnPacked.includes("\n"), "compressed bookmarklet is one line");

const { isAllowedEspnIngestHref, isLiveEspnCaptureHref } = require("../src/lib/espn") as typeof import("../src/lib/espn");
assert(isAllowedEspnIngestHref("https://fantasy.espn.com/football/draft?leagueId=1"), "espn href allowed");
assert(isAllowedEspnIngestHref("paste"), "paste href allowed");
assert(isAllowedEspnIngestHref("cleared"), "cleared stamp is an allowed ingest href");
assert(!isAllowedEspnIngestHref("https://draftwizard.fantasypros.com/d/rdr.jsp"), "FP href rejected");
assert(!isAllowedEspnIngestHref("https://www.draftsharks.com/war-room"), "DS href rejected");
assert(isLiveEspnCaptureHref("https://fantasy.espn.com/football/draft"), "live capture needs espn href");
assert(isLiveEspnCaptureHref("paste"), "paste is a live capture");
assert(!isLiveEspnCaptureHref("cleared"), "cleared is not a live capture");
assert(!isLiveEspnCaptureHref(undefined), "href-less writes are not live captures");

const relaySrc = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/lib/espn-relay.ts"), "utf8");
assert(relaySrc.includes("isAllowedEspnIngestHref"), "relay filters with isAllowedEspnIngestHref");
const listenSrc = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/app/api/espn/listen/route.ts"), "utf8");
assert(listenSrc.includes("Drop foreign scrapes before relay merge") || listenSrc.indexOf("isAllowedEspnIngestHref") !== listenSrc.lastIndexOf("isAllowedEspnIngestHref"), "listen clears foreign before relay");
assert(listenSrc.includes("allow-replay"), "listen foreign clear allows relay replay");
assert(!listenSrc.includes('clearIngest("block-relay")'), "href-less leftover must not stamp block-relay");
assert(listenSrc.includes("stale"), "listen reports stale without wiping picks");
assert(relaySrc.includes("isLiveEspnCaptureHref"), "relay ignores href-less leftover instead of merging");

const bmKeep = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/lib/espn-bookmarklet.ts"), "utf8");
assert(bmKeep.includes("nowKeep-lastBeat"), "bookmarklet soft-heartbeat when sig unchanged");
assert(bmKeep.includes("via relay"), "bookmarklet reports ntfy relay when localhost ingest fails");
assert(bmKeep.includes("700"), "localhost ingest aborts so badge does not wait on Cursor VM");

const { isLeftoverEspnTestPicks } = require("../src/lib/leftover-tests") as typeof import("../src/lib/leftover-tests");
assert(
  isLeftoverEspnTestPicks({
    leagueId: "96402745",
    picks: [
      { playerName: "Jahmyr Gibbs" },
      { playerName: "Bijan Robinson" },
      { playerName: "Justin Jefferson" },
    ],
  }),
  "leftover agent ESPN test is recognized",
);
assert(
  !isLeftoverEspnTestPicks({
    leagueId: "1361349772",
    picks: [
      { playerName: "Jahmyr Gibbs" },
      { playerName: "Bijan Robinson" },
      { playerName: "Justin Jefferson" },
    ],
  }),
  "real JFL league is not treated as leftover",
);

const ingestSrc = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/app/api/espn/ingest/route.ts"), "utf8");
assert(ingestSrc.includes("heartbeat: true"), "ingest empty-with-prior refreshes as heartbeat");

void configuredPublicOrigin;
void originDiagnostics;

clearIngest("allow-replay");
assert((getIngest()?.picks.length ?? 0) === 0, "sentinel check must not leave test picks on the live board");

console.log("espn sentinel checks passed");
console.log("sample board subtitle:", goodLine);
console.log("sentinel subtitle:", line);
