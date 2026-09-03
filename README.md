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

Ranks start as a September 1, 2026 snapshot of public FantasyPros ECR and DraftSharks 3D values. Click **Refresh ranks** to pull live public Half PPR (or whatever scoring is set in League) sheets **and recent injury flags** (Out / Q / Watch) from FantasyPros injury news, DraftSharks ranking badges when present, and the public ESPN injury report (no cookies). That refresh is **generic scoring ECR / 3D** — Draft Room cannot log into your FantasyPros or DraftSharks account, so it cannot see ranks that only exist after you sync a private league.

## League-specific FP / DS ranks

If you already synced JFL 28 (or another league) on FantasyPros and DraftSharks so those sites customize rankings to your scoring and roster, import those boards into Draft Room:

### FantasyPros (CSV)

1. Sync the league under FantasyPros → My Leagues.
2. Open [Cheat Sheet Creator](https://www.fantasypros.com/nfl/cheat-sheet-creator.php), select that synced league, start from ECR (or your preferred expert set).
3. Download / export the CSV (or copy Rank, Player, Team, Pos).
4. In Draft Room click **Import** → **FantasyPros** → paste or **Choose CSV…** → **Import FantasyPros ranks**.

That replaces the **FP** column only. Blend, `#`, sorts, and suggested picks use the imported FP ranks instead of generic ECR.

### DraftSharks (paste)

DraftSharks does not offer a public CSV for synced-league boards. After you sync the league:

1. Open your league-adjusted rankings (Draft War Room or rankings with that league selected).
2. Copy Rank + Player (+ Pos when available).
3. In Draft Room click **Import** → **DraftSharks** → paste → **Import DraftSharks ranks**.

That replaces the **DS** column only.

Imports persist in the browser (localStorage). **Refresh ranks** still updates public sheets and injuries but **does not wipe** league imports — those keep winning for their column until you clear them in the Import dialog.
