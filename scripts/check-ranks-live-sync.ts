import assert from "node:assert/strict";
import { ranksBookmarkletCode, buildRanksBookmarklet } from "../src/lib/ranks-bookmarklet";
import {
  clearRanksIngest,
  getRanksIngest,
  setRanksIngestSource,
} from "../src/lib/ranks-ingest";
import { parseRankingPaste, updatesToPatches } from "../src/lib/parse-import";

clearRanksIngest();
assert.deepEqual(getRanksIngest(), {});

const fpCode = ranksBookmarkletCode("http://127.0.0.1:43173", "fp");
assert.match(fpCode, /fantasypros\.com/);
assert.match(fpCode, /\/api\/ranks\/ingest/);
assert.match(fpCode, /data-player-name/);

const fpHref = buildRanksBookmarklet("http://127.0.0.1:43173", "fp");
assert.ok(fpHref.startsWith("javascript:"));
assert.doesNotMatch(fpHref, /\n/);

const dsHref = buildRanksBookmarklet("https://example.preview.dev", "ds");
assert.ok(dsHref.startsWith("javascript:"));
assert.match(dsHref, /draftsharks\.com/);
assert.match(dsHref, /example\.preview\.dev/);
assert.match(dsHref, /\/api\/ranks\/ingest/);
assert.doesNotMatch(dsHref, /\n/);

const text = "RK,PLAYER,POS,TEAM\n1,Ja'Marr Chase,WR,CIN\n2,Jahmyr Gibbs,RB,DET\n3,Bijan Robinson,RB,ATL\n4,Justin Jefferson,WR,MIN\n5,Saquon Barkley,RB,PHI\n6,CeeDee Lamb,WR,DAL\n7,Amon-Ra St. Brown,WR,DET\n8,Puka Nacua,WR,LAR";
const parsed = parseRankingPaste(text, "fp");
assert.ok(parsed.matched >= 5, `matched ${parsed.matched}`);

setRanksIngestSource({
  source: "fp",
  rows: [
    { rank: 1, name: "Ja'Marr Chase", pos: "WR", team: "CIN" },
    { rank: 2, name: "Jahmyr Gibbs", pos: "RB", team: "DET" },
  ],
  text,
  ts: 1000,
  matched: parsed.matched,
  patches: updatesToPatches(parsed.updates),
  unmatched: parsed.unmatched,
  label: "Live FantasyPros Draft Assistant sync",
});

const store = getRanksIngest();
assert.equal(store.fp?.matched, parsed.matched);
assert.ok(store.fp?.patches && Object.keys(store.fp.patches).length >= 5);

clearRanksIngest("fp");
assert.equal(getRanksIngest().fp, undefined);

console.log("check-ranks-live-sync: ok");
