import {
  firstNamesCompatible,
  matchOurPlayer,
  matchRankingSource,
} from "../src/lib/espn";
import { applyRankPatches } from "../src/lib/rank-refresh";
import { isMissingRank, formatSourceRank } from "../src/lib/draft";
import { PLAYERS } from "../src/lib/players";
import { parseRankingPaste } from "../src/lib/parse-import";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const chase = PLAYERS.find((p) => p.name === "Ja'Marr Chase");
const gibbs = PLAYERS.find((p) => p.name === "Jahmyr Gibbs");
const jt = PLAYERS.find((p) => p.name === "Jonathan Taylor");
const cam = PLAYERS.find((p) => p.name === "Cam Skattebo");
const kenny = PLAYERS.find((p) => p.name === "Kenny Gainwell");
const tee = PLAYERS.find((p) => p.name === "Tee Higgins");
const broncos = PLAYERS.find((p) => p.name === "Broncos");
const texans = PLAYERS.find((p) => p.name === "Texans");
assert(chase && gibbs && jt && cam && kenny && tee && broncos && texans, "snapshot players");

assert(chase!.fpRank === 1, `snapshot Chase fpRank 1, got ${chase!.fpRank}`);
assert(gibbs!.dsRank === 1, `snapshot Gibbs dsRank 1, got ${gibbs!.dsRank}`);
assert(
  PLAYERS.every((p) => !isMissingRank(p.fpRank) && !isMissingRank(p.dsRank)),
  "snapshot FP/DS 1..N has no sentinels",
);
assert(formatSourceRank(999) === "—" && formatSourceRank(0) === "—", "sentinels render as —");
assert(formatSourceRank(1) === "1", "rank 1 renders as 1");

assert(matchRankingSource("Ja'Marr Chase")?.id === chase!.id, "Ja'Marr Chase");
assert(matchRankingSource("Ja Marr Chase")?.id === chase!.id, "Ja Marr Chase compact");
assert(matchRankingSource("Jamarr Chase")?.id === chase!.id, "Jamarr Chase");
assert(matchRankingSource("Chase, Ja'Marr")?.id === chase!.id, "Chase, Ja'Marr last-first");
assert(matchRankingSource("Ja'Marr Chase Jr.", { pos: "WR", team: "CIN" })?.id === chase!.id, "Chase Jr.");

assert(matchRankingSource("Cameron Skattebo", { pos: "RB" })?.id === cam!.id, "Cameron → Cam Skattebo");
assert(matchRankingSource("Kenneth Gainwell", { pos: "RB" })?.id === kenny!.id, "Kenneth → Kenny Gainwell");
assert(matchRankingSource("Cameron Ward", { pos: "QB" })?.name === "Cam Ward", "Cameron Ward");

assert(matchRankingSource("Denver Broncos", { pos: "DST", team: "DEN" })?.id === broncos!.id, "Denver Broncos");
assert(matchRankingSource("Houston Texans", { pos: "DEF" })?.id === texans!.id, "Houston Texans DEF");
assert(matchRankingSource("Seattle Seahawks", { pos: "DST" })?.name === "Seahawks", "Seahawks mascot");

assert(matchRankingSource("J'Mari Taylor", { pos: "RB", team: "JAC" }) == null, "J'Mari Taylor must not match JT");
assert(matchRankingSource("J'Mari Taylor", { pos: "RB" }) == null, "J'Mari Taylor last+pos must not match JT");
assert(matchRankingSource("Patrick Taylor Jr.", { pos: "RB", team: "FA" }) == null, "Patrick Taylor FA");
assert(matchRankingSource("Jayden Higgins") == null, "Jayden Higgins must not match Tee Higgins");
assert(matchRankingSource("Danielle Hunter", { pos: "DL" }) == null, "IDP Danielle Hunter skipped");
assert(matchRankingSource("Travis Hunter", { pos: "WR" })?.name === "Travis Hunter", "Travis Hunter WR");
assert(matchRankingSource("Jake Ferguson", { pos: "TE" })?.name === "Jake Ferguson", "Jake not Terrance");
assert(matchRankingSource("Josh Allen", { pos: "QB" })?.name === "Josh Allen", "Josh Allen not Keenan/Braelon");

assert(matchOurPlayer("J'Mari Taylor", "RB", "JAC") === jt!.id, "ESPN last+pos still maps J'Mari (intentional for J. Taylor)");

assert(firstNamesCompatible("cam", "cameron"), "cam/cameron");
assert(firstNamesCompatible("kenny", "kenneth"), "kenny/kenneth");
assert(!firstNamesCompatible("jmari", "jonathan"), "jmari/jonathan");
assert(!firstNamesCompatible("j", "jonathan"), "j/jonathan");
assert(!firstNamesCompatible("jayden", "tee"), "jayden/tee");

const patched = applyRankPatches(PLAYERS, {
  [cam!.id]: { fpRank: 80 },
  "not-a-player": { fpRank: 1, dsRank: 1 },
});
const patchedCam = patched.find((p) => p.id === cam!.id)!;
const patchedGibbs = patched.find((p) => p.id === gibbs!.id)!;
assert(patchedCam.fpRank === 80, "overlay fp applied");
assert(patchedCam.dsRank === cam!.dsRank, "unmatched DS column keeps snapshot");
assert(patchedGibbs.fpRank === gibbs!.fpRank && patchedGibbs.dsRank === gibbs!.dsRank, "unpatched player keeps snapshot");

const sentinels = applyRankPatches(PLAYERS, {
  [gibbs!.id]: { fpRank: 0, dsRank: 999 },
});
const g2 = sentinels.find((p) => p.id === gibbs!.id)!;
assert(g2.fpRank === gibbs!.fpRank && g2.dsRank === gibbs!.dsRank, "sentinel overlay does not blank snapshot");

const paste = parseRankingPaste("RK,PLAYER NAME,TEAM,POS\n1,Ja'Marr Chase,CIN,WR\n2,Cameron Skattebo,NYG,RB");
assert(paste.matched >= 2, `paste matched Chase+Cam, got ${paste.matched}`);
assert(paste.updates.get(chase!.id)?.fpRank === 1, "paste Chase fp 1");
assert(paste.updates.get(cam!.id)?.fpRank === 2, "paste Cameron Skattebo");

console.log("check-rank-matching: ok");
