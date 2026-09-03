import { blendedRank, formatBoardRank } from "../src/lib/draft";
import { PLAYERS } from "../src/lib/players";
import {
  applyLeagueRankUpdates,
  parseRankingPaste,
  updatesToPatches,
} from "../src/lib/parse-import";
import { applyRankPatches } from "../src/lib/rank-refresh";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const chase = PLAYERS.find((p) => p.name === "Ja'Marr Chase")!;
const gibbs = PLAYERS.find((p) => p.name === "Jahmyr Gibbs")!;
const cam = PLAYERS.find((p) => p.name === "Cam Skattebo")!;

const fp = parseRankingPaste(
  "RK,PLAYER NAME,TEAM,POS,ADP\n1,Ja'Marr Chase,CIN,WR,3\n2,Cameron Skattebo,NYG,RB,40",
  "fp",
);
assert(fp.source === "fp", "fp source");
assert(fp.matched >= 2, `fp matched ${fp.matched}`);
assert(fp.updates.get(chase.id)?.fpRank === 1, "Chase FP 1");
assert(fp.updates.get(cam.id)?.fpRank === 2, "Cam FP 2");
assert(fp.updates.get(chase.id)?.dsRank == null, "FP paste does not set DS");

const ds = parseRankingPaste("RK,PLAYER,POS\n1,Jahmyr Gibbs,RB\n2,Ja'Marr Chase,WR", "ds");
assert(ds.source === "ds", "ds source");
assert(ds.updates.get(gibbs.id)?.dsRank === 1, "Gibbs DS 1");
assert(ds.updates.get(chase.id)?.dsRank === 2, "Chase DS 2");
assert(ds.updates.get(gibbs.id)?.fpRank == null, "DS paste does not set FP");

// Generic refresh then league overlay wins for that column.
const refreshed = applyRankPatches(PLAYERS, {
  [chase.id]: { fpRank: 50, dsRank: 40 },
  [gibbs.id]: { fpRank: 10, dsRank: 20 },
});
const withFp = applyLeagueRankUpdates(refreshed, updatesToPatches(fp.updates));
const withBoth = applyLeagueRankUpdates(withFp, updatesToPatches(ds.updates));
const boardChase = withBoth.find((p) => p.id === chase.id)!;
const boardGibbs = withBoth.find((p) => p.id === gibbs.id)!;
assert(boardChase.fpRank === 1, `league FP wins over refresh 50, got ${boardChase.fpRank}`);
assert(boardChase.dsRank === 2, `league DS wins over refresh 40, got ${boardChase.dsRank}`);
assert(boardGibbs.dsRank === 1, `Gibbs league DS 1, got ${boardGibbs.dsRank}`);
assert(boardGibbs.fpRank === 10, "Gibbs FP stays refreshed when no FP league row");

const blend50 = blendedRank(boardChase, 50);
assert(blend50 != null && Math.abs(blend50 - 1.5) < 0.01, `blend 50% → 1.5, got ${blend50}`);
assert(formatBoardRank(boardChase, 0) === "1", "0% DS → FP only");
assert(formatBoardRank(boardChase, 100) === "2", "100% DS → DS only");

const empty = parseRankingPaste("", "fp");
assert(empty.matched === 0, "empty paste");

const bad = parseRankingPaste("1,Definitely Not A Real Player Xx", "ds");
assert(bad.matched === 0 && bad.unmatched.length > 0, "unmatched reported");

console.log("check-league-rank-import: ok");
