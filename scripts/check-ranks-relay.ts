import assert from "node:assert/strict";
import {
  selectBestRankSnapshots,
  unpackRanksRelayMessage,
} from "../src/lib/ranks-relay";
import { commitRankScrape } from "../src/lib/ranks-apply";
import { clearRanksIngest, getRanksIngest } from "../src/lib/ranks-ingest";
import { RANKS_RELAY_URL } from "../src/lib/relay-urls";
import { parseRankingPaste } from "../src/lib/parse-import";

assert.equal(RANKS_RELAY_URL, "https://ntfy.sh/drjfl28jackal-ranks");

const names = [
  "Ja'Marr Chase",
  "Jahmyr Gibbs",
  "Bijan Robinson",
  "Justin Jefferson",
  "Saquon Barkley",
  "CeeDee Lamb",
  "Amon-Ra St. Brown",
  "Puka Nacua",
];
const rows = names.map((name, i) => ({
  rank: i + 1,
  name,
  pos: i % 2 === 0 ? "WR" : "RB",
  team: "FA",
}));

const chunk0 = JSON.stringify({
  v: 2,
  s: "fp",
  t: 5000,
  h: "https://draftwizard.fantasypros.com/football/mock-draft-simulator/",
  i: 0,
  n: 2,
  r: rows.slice(0, 4).map((r) => [r.rank, r.name, r.pos, r.team]),
});
const chunk1 = JSON.stringify({
  v: 2,
  s: "fp",
  t: 5000,
  h: "https://draftwizard.fantasypros.com/football/mock-draft-simulator/",
  i: 1,
  n: 2,
  r: rows.slice(4).map((r) => [r.rank, r.name, r.pos, r.team]),
});

const part = unpackRanksRelayMessage(chunk0);
assert.ok(part);
assert.equal(part.source, "fp");
assert.equal(part.rows.length, 4);

const best = selectBestRankSnapshots([chunk0, chunk1]);
assert.ok(best.fp);
assert.equal(best.fp.rows.length, 8);
assert.equal(best.fp.rows[0].name, "Ja'Marr Chase");
assert.equal(best.fp.rows[7].name, "Puka Nacua");

const espnBody = JSON.stringify({
  v: 1,
  p: [[1, 1, 1, "Jahmyr Gibbs"]],
  h: "https://fantasy.espn.com/football/draft",
  t: 1,
});
assert.equal(unpackRanksRelayMessage(espnBody), null);
assert.equal(selectBestRankSnapshots([espnBody]).fp, undefined);

clearRanksIngest();
const parsed = parseRankingPaste(
  ["RK,PLAYER,POS,TEAM", ...rows.map((r) => `${r.rank},${r.name},${r.pos},${r.team}`)].join("\n"),
  "fp",
);
assert.ok(parsed.matched >= 5, `matched ${parsed.matched}`);

const foreign = commitRankScrape({
  source: "fp",
  rows,
  href: "https://fantasy.espn.com/football/draft",
  ts: 1,
});
assert.equal(foreign.applied, false);
assert.equal(foreign.ignoredForeign, true);

const applied = commitRankScrape({
  source: "fp",
  rows,
  href: "https://draftwizard.fantasypros.com/d/rdr.jsp",
  ts: 9001,
});
assert.equal(applied.applied, true);
assert.ok((applied.matched ?? 0) >= 5);
assert.equal(getRanksIngest().fp?.ts, 9001);

const again = commitRankScrape({
  source: "fp",
  rows,
  href: "https://draftwizard.fantasypros.com/d/rdr.jsp",
  ts: 9001,
});
assert.equal(again.applied, false);

const ds = commitRankScrape({
  source: "ds",
  rows,
  href: "https://www.draftsharks.com/war-room",
  ts: 42,
});
assert.equal(ds.applied, true);
assert.ok(getRanksIngest().ds);

clearRanksIngest();
console.log("check-ranks-relay: ok");
