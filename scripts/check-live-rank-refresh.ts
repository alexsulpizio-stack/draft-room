import {
  clearRankRefreshCache,
  LIVE_RANK_POLL_MS,
  MIN_REFRESH_INTERVAL_MS,
  refreshLiveRankings,
} from "../src/lib/rank-refresh";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(MIN_REFRESH_INTERVAL_MS >= 60_000, "throttle ≥ 60s");
  assert(LIVE_RANK_POLL_MS >= MIN_REFRESH_INTERVAL_MS, "poll ≥ throttle");

  const fpHtml = `<html><script>var ecrData = {"last_updated":"9/03","players":[
  {"player_name":"Ja'Marr Chase","rank_ecr":1,"player_team_id":"CIN","player_position_id":"WR"},
  {"player_name":"Jahmyr Gibbs","rank_ecr":2,"player_team_id":"DET","player_position_id":"RB"}
]};</script></html>`;
  const dsHtml = `<div data-fantasy-position="WR" data-player-name="Ja'Marr Chase"><div class="rank-index"><span>2</span></div></div>
<div data-fantasy-position="RB" data-player-name="Jahmyr Gibbs"><div class="rank-index"><span>1</span></div></div>`;

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls += 1;
    const url = String(input);
    if (url.includes("fantasypros.com")) return new Response(fpHtml, { status: 200 });
    if (url.includes("draftsharks.com")) return new Response(dsHtml, { status: 200 });
    if (url.includes("espn.com")) return new Response(JSON.stringify({ injuries: [] }), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  clearRankRefreshCache();
  fetchCalls = 0;
  const first = await refreshLiveRankings("half", { ranksOnly: true, force: true });
  assert(first.ok && first.ranksOnly === true, `first ${first.error}`);
  assert(first.fpMatched >= 1 && first.dsMatched >= 1, "matched");
  assert(fetchCalls === 2, `calls ${fetchCalls}`);
  const cached = await refreshLiveRankings("half", { ranksOnly: true });
  assert(cached.cached === true && fetchCalls === 2, "cached");
  await refreshLiveRankings("half", { ranksOnly: true, force: true });
  assert(fetchCalls === 4, "force");
  clearRankRefreshCache();
  fetchCalls = 0;
  const full = await refreshLiveRankings("half", { force: true });
  assert(full.ok && full.ranksOnly !== true && fetchCalls > 2, "full");
  globalThis.fetch = originalFetch;
  clearRankRefreshCache();
  console.log("check-live-rank-refresh: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
