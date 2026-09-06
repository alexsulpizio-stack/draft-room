import assert from "node:assert/strict";
import { normalizeYahooPicks, teamForOverall, yahooToDraftPicks } from "../src/lib/yahoo";

const picks = normalizeYahooPicks([
  { overall: 2, playerName: "  Puka   Nacua ", team: 2 },
  { overall: 1, playerName: "Ja'Marr Chase", team: 1 },
  { overall: 2, playerName: "duplicate should be ignored" },
  { overall: 0, playerName: "invalid" },
]);

assert.deepEqual(picks.map((p) => p.overall), [1, 2]);
assert.equal(picks[0].playerName, "Ja'Marr Chase");
assert.equal(teamForOverall(1, 12, "snake"), 1);
assert.equal(teamForOverall(12, 12, "snake"), 12);
assert.equal(teamForOverall(13, 12, "snake"), 12);
assert.equal(teamForOverall(24, 12, "snake"), 1);

const mapped = yahooToDraftPicks(
  [{ overall: 1, playerName: "Ja'Marr Chase" }, { overall: 2, playerName: "Unknown Player" }],
  12,
  "snake",
);
assert.equal(mapped.picks.length, 1);
assert.equal(mapped.unmatched, 1);
console.log("Yahoo ingest checks passed");
