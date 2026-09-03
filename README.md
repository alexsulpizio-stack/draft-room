# Draft Room — JFL 28

Desktop draft companion for **JFL 28** on ESPN (league `1361349772`).

Snake draft is **Thursday, Sep 3, 2026 at 7:00 PM EDT**, 90 seconds a pick. You are **JackAL, pick 5** (1.05 / 2.08 / 3.05 / 4.08).

## Draft order

1. Deadman Inc. · 2. Doc · 3. Bradys Sports Cards · 4. Finest Meats and Cheeses · **5. JackAL (you)** · 6. 2 Street · 7. It's Easy · 8. Molesters · 9. Vince's Pizza · 10. ARITSTARERYTIOCTTI · 11. Black Lodge · 12. Shysters

## League (from ESPN settings)

| | |
| --- | --- |
| Teams | 12 |
| Scoring | Head-to-head points, 0.5 PPR, 0.25 rushing/receiving first downs |
| Draft | Snake, LM-set order, no pick trading, no keepers |
| Starters | QB, RB, RB/WR, WR, WR, WR, TE, K |
| Bench / IR | 6 bench, 2 IR |
| Not used | D/ST, Superflex, full FLEX |

RB/WR is **not** a full FLEX. Tight ends cannot play that slot.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:43173](http://localhost:43173) in Chrome on a computer. Keep ESPN in another tab.

The header and **Sync ESPN** sheet show the build as `v{package version} · {git short SHA}` so you can confirm you are on the latest commit after an update.

JFL 28 on ESPN:

- League home: [https://fantasy.espn.com/football/league?leagueId=1361349772&seasonId=2026](https://fantasy.espn.com/football/league?leagueId=1361349772&seasonId=2026)
- Draft room (from ~6:00 PM EDT Thursday): [https://fantasy.espn.com/football/draft?leagueId=1361349772&seasonId=2026](https://fantasy.espn.com/football/draft?leagueId=1361349772&seasonId=2026)

## ESPN live sync

Works with **any** live ESPN draft — JFL 28, another league, a mock, or a practice room. After a Draft Room update you **must reinstall** the bookmark (Chrome often keeps a stale script, or even a dead `#` URL).

1. In Draft Room, click **Sync ESPN** (that chip only opens this help). Copy the script. Chrome → Ctrl+Shift+B → right-click the bookmarks bar → Add page → Name: `Sync ESPN` → URL: paste the script → Save. Delete any older Sync ESPN bookmark first.
2. Open the ESPN draft tab and click that bookmark. A green badge should appear on ESPN. Leave the tab open. Picks also go through a public relay (`ntfy.sh/drjfl28jackal`) so ESPN on your PC can reach a Cloud preview.
3. If the badge says **0 picks** but names are already on the ESPN board (common in practice drafts — ESPN leaves `playerId` empty), copy the pick history from ESPN and paste it as step 3 in Draft Room. Lines like `1.01 Jahmyr Gibbs` or `1.02 Puka Nacua, WR, LAR` work.

Draft Room reads league ID, season, team count, league name, draft type, and your slot (`teamId`) from that page, then marks those players taken on the board.

Cookies still exist under **Show cookies** if a browser blocks the bookmark. Defaults stay **JackAL, pick 5** in JFL 28 until you sync a different room.

## How to draft this format

- You start **three WRs**. Early WR is not a reach the way it is in 2-WR leagues.
- You start **one RB** plus an RB/WR. Get a workhorse, then you can fill the combo with a WR.
- Never draft a D/ST. Kicker in the last round.
- 1QB: wait unless elite value falls.

Ranks start as a September 1, 2026 snapshot of public FantasyPros ECR and DraftSharks 3D values.

### Live mid-draft refresh

While **Sync ESPN** is connected, Draft Room **auto-refreshes** public FP ECR + DraftSharks 3D:

- After each new ESPN pick (debounced)
- On a ~90s interval while the draft is live
- Always via the **Refresh ranks** button (full refresh including injuries)

Auto-refresh uses a **ranks-only** upstream path (2 pages) and the server **throttles to at most once per 60s** per scoring mode so we do not hammer FantasyPros / DraftSharks. The header shows last-refreshed time, auto on/off, and refresh errors. Toggle auto with the **auto public ranks on/off** control in the status strip.

**What updates automatically:** public FantasyPros consensus cheatsheets and DraftSharks ranking tables for your League scoring setting. Taken players are filtered from ESPN. Those public boards move during draft season as experts update; they are **not** login-gated Draft War Room / league-synced remaining-player boards with your draft’s supply/demand.

**What needs a mid-draft re-import (or live bookmarklet):** league-specific FP/DS columns you pasted earlier stay **pinned** until you paste a fresh export **or** run the **Sync FP ranks** / **Sync DS ranks** bookmarklets on an open FantasyPros Draft Assistant / DraftSharks War Room tab. While ESPN is live, the status strip offers **Re-import FP / Re-import DS**, and after each completed round Draft Room nudges you if those boards are still frozen (no live bookmarklet). The Import button becomes **Re-import** during a live draft when league ranks are loaded.

### Live league ranks (Sync FP / Sync DS bookmarklets)

Opening the FantasyPros or DraftSharks **Chrome extension sidebars on ESPN is not enough**. Those plugins keep rankings in isolated extension worlds / cross-origin frames — a web app cannot read them.

**What works:** keep the full FantasyPros Draft Assistant (or cheat sheet) and/or DraftSharks Draft War Room open in its own tab (logged in, league selected). Install bookmarklets from Draft Room → **Import**:

1. **Sync FP ranks** — click on `draftwizard.fantasypros.com` / FantasyPros Draft Assistant or cheat sheet.
2. **Sync DS ranks** — click on `draftsharks.com` Draft War Room (or league rankings).

A teal badge on that page shows how many ranks were scraped. Draft Room polls `/api/ranks/ingest` and overlays those ranks onto the FP or DS column (same as paste import, but live as the board re-ranks). Reinstall the bookmark after Draft Room updates (same rule as Sync ESPN).

Fallback remains CSV / paste import below.

Manual **Refresh ranks** also pulls injury flags (Out / Q / Watch) from FantasyPros injury news, DraftSharks badges when present, and the public ESPN injury report (no cookies).

## League-specific FP / DS ranks

If you already synced JFL 28 (or another league) on FantasyPros and DraftSharks so those sites customize rankings to your scoring and roster, import those boards into Draft Room (or use the live bookmarklets above):

### FantasyPros (live bookmarklet or CSV)

1. Sync the league under FantasyPros → My Leagues.
2. Open [Draft Wizard / My Leagues](https://draftwizard.fantasypros.com/football/leagues/) → Draft Assistant, or [Cheat Sheet Creator](https://www.fantasypros.com/nfl/cheat-sheet-creator.php) with that league.
3. Best: Draft Room → **Import** → **FantasyPros** → save **Sync FP ranks** → click it on that FP tab.
4. Fallback: download / export CSV (or copy Rank, Player, Team, Pos) → paste or **Choose CSV…** → **Import FantasyPros ranks**.

That replaces the **FP** column only. Blend, `#`, sorts, and suggested picks use the imported FP ranks instead of generic ECR.

### DraftSharks (live bookmarklet or paste)

DraftSharks does not offer a public CSV for synced-league boards. After you sync the league:

1. Open your league-adjusted rankings (**Draft War Room** full site tab — not only the ESPN sidebar).
2. Best: Draft Room → **Import** → **DraftSharks** → save **Sync DS ranks** → click it on that DS tab.
3. Fallback: copy Rank + Player (+ Pos when available) → paste → **Import DraftSharks ranks**.

That replaces the **DS** column only.

Imports and live bookmarklet syncs persist in the browser (localStorage). **Refresh ranks** and mid-draft auto-refresh still update public sheets (and injuries on manual refresh) but **do not wipe** league imports — those keep winning for their column until you clear them, **Re-import**, or a newer live sync arrives.
