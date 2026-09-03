/** Synthetic ingest → listen verification for pick team owners. */
const BASE = process.env.DRAFT_ROOM_URL || "http://127.0.0.1:43173";

async function postIngest(body: unknown) {
  const res = await fetch(`${BASE}/api/espn/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(`ingest failed: ${JSON.stringify(json)}`);
  return json;
}

async function listen() {
  const res = await fetch(`${BASE}/api/espn/listen?teams=12`, { cache: "no-store" });
  return res.json();
}

function assertTeams(
  picks: Array<{ overall: number; team: number; name?: string; espnTeamId?: number }>,
  expect: Record<number, number>,
  label: string,
) {
  for (const p of picks) {
    const e = expect[p.overall];
    if (e == null) continue;
    if (p.team !== e) {
      throw new Error(
        `${label}: overall ${p.overall} expected team ${e}, got ${p.team} (espnTeamId=${p.espnTeamId}, ${p.name})`,
      );
    }
    console.log(`  ok overall ${p.overall} → team ${p.team} (${p.name})`);
  }
}

async function main() {
  const pickOrder = [8, 3, 11, 1, 5, 9, 2, 12, 7, 4, 10, 6];

  console.log("1) with pickOrder (scrambled ESPN team ids)");
  await postIngest({
    href: "https://fantasy.espn.com/football/draft?leagueId=999001&seasonId=2026&teamId=5",
    title: "Synthetic Snake Verify",
    ts: Date.now(),
    meta: {
      leagueId: "999001",
      season: 2026,
      teams: 12,
      teamId: 5,
      draftType: "snake",
      leagueName: "Synthetic Snake Verify",
      pickOrder,
      teamNames: ["T8", "T3", "T11", "T1", "JackAL", "T9", "T2", "T12", "T7", "T4", "T10", "T6"],
    },
    picks: [
      { overallPickNumber: 1, playerId: 3116406, teamId: 8, playerName: "Jahmyr Gibbs" },
      { overallPickNumber: 12, playerId: 4241457, teamId: 6, playerName: "Ja'Marr Chase" },
      { overallPickNumber: 13, playerId: 4430807, teamId: 6, playerName: "Breece Hall" },
      { overallPickNumber: 14, playerId: 4426385, teamId: 10, playerName: "Bijan Robinson" },
      { overallPickNumber: 5, playerId: 3916387, teamId: 5, playerName: "Christian McCaffrey" },
    ],
  });
  const withOrder = await listen();
  if (!withOrder.ingest) throw new Error("listen did not see ingest");
  if (withOrder.meta?.slot !== 5) {
    throw new Error(`expected meta.slot 5 for JackAL, got ${withOrder.meta?.slot}`);
  }
  assertTeams(withOrder.picks, { 1: 1, 12: 12, 13: 12, 14: 11, 5: 5 }, "with pickOrder");

  console.log("2) without pickOrder — fall back to overall snake math (ignore raw teamId)");
  await postIngest({
    href: "https://fantasy.espn.com/football/draft?leagueId=999002&seasonId=2026",
    title: "No Order Verify",
    ts: Date.now(),
    meta: {
      leagueId: "999002",
      teams: 12,
      draftType: "snake",
      leagueName: "No Order Verify",
    },
    picks: [
      { overallPickNumber: 1, playerId: 3116406, teamId: 8, playerName: "Jahmyr Gibbs" },
      { overallPickNumber: 13, playerId: 4241457, teamId: 8, playerName: "Ja'Marr Chase" },
      { overallPickNumber: 14, playerId: 4430807, teamId: 3, playerName: "Breece Hall" },
    ],
  });
  const noOrder = await listen();
  assertTeams(noOrder.picks, { 1: 1, 13: 12, 14: 11 }, "no pickOrder");

  console.log("synthetic ingest verify: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
