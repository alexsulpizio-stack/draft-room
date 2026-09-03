import assert from "node:assert/strict";
import { ranksBookmarkletCode, buildRanksBookmarklet } from "../src/lib/ranks-bookmarklet";
import { buildCompressedRanksBookmarklet } from "../src/lib/bookmarklet-compress";
import {
  clearRanksIngest,
  getRanksIngest,
  isAllowedRanksIngestHref,
  setRanksIngestSource,
} from "../src/lib/ranks-ingest";
import { parseRankingPaste, updatesToPatches } from "../src/lib/parse-import";

clearRanksIngest();
assert.deepEqual(getRanksIngest(), {});

const fpCode = ranksBookmarkletCode("http://127.0.0.1:43173", "fp");
assert.match(fpCode, /fantasypros\.com/);
assert.match(fpCode, /\/api\/ranks\/ingest/);
assert.match(fpCode, /data-player-name/);
assert.match(fpCode, /draft-room-ranks-badge-\"\+SRC/);
assert.match(fpCode, /ntfy\.sh\/drjfl28jackal-ranks/);
assert.match(fpCode, /packChunks/);
assert.match(fpCode, /via relay/);
assert.match(fpCode, /badge\(0,"starting"\)/);

const fpHref = buildRanksBookmarklet("http://127.0.0.1:43173", "fp");
assert.ok(fpHref.startsWith("javascript:"));
assert.doesNotMatch(fpHref, /\n/);
const fpPacked = buildCompressedRanksBookmarklet("http://127.0.0.1:43173", "fp", "https://ntfy.sh/drjfl28jackal-ranks");
assert.ok(fpPacked.startsWith("javascript:"));
assert.ok(fpPacked.length < 9000, `compressed FP bookmarklet ${fpPacked.length}`);
assert.match(fpPacked, /DecompressionStream/);
assert.match(fpPacked, /badge\(0,"starting"\)/);

const dsHref = buildRanksBookmarklet("https://example.preview.dev", "ds");
assert.ok(dsHref.startsWith("javascript:"));
assert.match(dsHref, /draftsharks\.com/);
assert.match(dsHref, /example\.preview\.dev/);
assert.match(dsHref, /\/api\/ranks\/ingest/);
assert.doesNotMatch(dsHref, /\n/);
const dsPacked = buildCompressedRanksBookmarklet("https://example.preview.dev", "ds", "https://ntfy.sh/drjfl28jackal-ranks");
assert.ok(dsPacked.length < 9000, `compressed DS bookmarklet ${dsPacked.length}`);
assert.match(dsPacked, /draftsharks/);

assert.equal(isAllowedRanksIngestHref("fp", "https://draftwizard.fantasypros.com/d/rdr.jsp"), true);
assert.equal(isAllowedRanksIngestHref("fp", "https://www.fantasypros.com/nfl/rankings/"), true);
assert.equal(isAllowedRanksIngestHref("ds", "https://www.draftsharks.com/war-room"), true);
assert.equal(isAllowedRanksIngestHref("fp", "https://fantasy.espn.com/football/draft"), false);
assert.equal(isAllowedRanksIngestHref("ds", "https://draftwizard.fantasypros.com/d/rdr.jsp"), false);
assert.equal(isAllowedRanksIngestHref("fp", "https://www.draftsharks.com/war-room"), false);
assert.equal(isAllowedRanksIngestHref("fp", undefined), true);

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

// Weak scrape guard: keep a strong prior overlay.
setRanksIngestSource({
  source: "fp",
  rows: [{ rank: 1, name: "Ja'Marr Chase", pos: "WR", team: "CIN" }],
  text,
  ts: 2000,
  matched: 80,
  patches: updatesToPatches(parsed.updates),
  unmatched: [],
  label: "prior",
});
assert.equal(getRanksIngest().fp?.matched, 80);
assert.ok(
  8 < Math.min(20, Math.floor(80 * 0.35)),
  "8 matched is below the 35% weak-scrape threshold of 80",
);

clearRanksIngest();
console.log("check-ranks-live-sync: ok");
