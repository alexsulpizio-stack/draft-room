/**
 * Guard: missing/sentinel ADP must not produce "Falling N spots past ADP"
 * or inflate recommendPicks scores via 999 − overall ≈ 998.
 */
import { recommendPicks } from "../src/lib/draft";
import { DEFAULT_SETTINGS, type Player } from "../src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const base: Player = {
  id: "test-orphan",
  name: "Orphan Stub",
  team: "BUF",
  pos: "WR",
  bye: 7,
  fpRank: 999,
  dsRank: 999,
  adp: 999,
  proj: 0,
  tags: ["espn"],
  note: "On ESPN's board but not in this snapshot.",
};

const real: Player = {
  id: "test-real",
  name: "Real ADP Guy",
  team: "CIN",
  pos: "WR",
  bye: 6,
  fpRank: 40,
  dsRank: 42,
  adp: 45,
  proj: 180,
  tags: [],
};

const settings = { ...DEFAULT_SETTINGS, slot: 5, teams: 12 };
const overall = 5; // pick 1.05

const orphanRecs = recommendPicks({
  available: [base],
  roster: [],
  settings,
  overall,
  picksUntilNext: 0,
});
assert(orphanRecs.length === 1, "orphan still recommendable");
const orphanReasons = orphanRecs[0].reasons.join(" | ");
assert(
  !/Falling \d+ spots past ADP/.test(orphanReasons),
  `sentinel ADP must not emit falling reason, got: ${orphanReasons}`,
);
assert(orphanRecs[0].wait !== "can-wait", `sentinel ADP must not force can-wait, got ${orphanRecs[0].wait}`);

const mixed = recommendPicks({
  available: [base, real],
  roster: [],
  settings,
  overall,
  picksUntilNext: 12,
});
const falling = mixed.flatMap((r) => r.reasons).filter((r) => /Falling \d+ spots past ADP/.test(r));
assert(
  falling.every((r) => r.includes("Falling 40 spots")),
  `only real ADP (45−5=40) may fall; got ${JSON.stringify(falling)}`,
);
assert(
  !falling.some((r) => /998|994|999/.test(r)),
  `no 99x sentinel fall, got ${JSON.stringify(falling)}`,
);

// Real value at overall 5 with ADP 45 → Falling 40 — score uses value; orphan must not outrank via 998 boost alone
const orphanScore = mixed.find((r) => r.player.id === "test-orphan")!.score;
const realScore = mixed.find((r) => r.player.id === "test-real")!.score;
assert(
  realScore > orphanScore,
  `real ranked player should outscore ADP-999 stub (real=${realScore}, orphan=${orphanScore})`,
);

console.log("ok: recommend ADP sentinel guard");
