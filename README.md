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

JFL 28 on ESPN:

- League home: [https://fantasy.espn.com/football/league?leagueId=1361349772&seasonId=2026](https://fantasy.espn.com/football/league?leagueId=1361349772&seasonId=2026)
- Draft room (from ~6:00 PM EDT Thursday): [https://fantasy.espn.com/football/draft?leagueId=1361349772&seasonId=2026](https://fantasy.espn.com/football/draft?leagueId=1361349772&seasonId=2026)

## ESPN live sync

Works with **any** live ESPN draft — JFL 28, another league, or a mock. Two steps. No cookies.

1. Drag the green **Sync ESPN** chip onto the Chrome bookmarks bar (Ctrl+Shift+B if the bar is hidden). After a Draft Room update, delete the old bookmark and drag it again — stale bookmarks miss live picks.
2. Open whatever ESPN draft tab is live (mock lobby, live lobby, or a league room) and click that bookmark. Leave the tab open. ESPN's board should stay usable; a green "Draft Room is syncing N picks" chip appears on that tab.

Draft Room reads league ID, season, team count, league name, draft type, and your slot (`teamId`) from that page, then fills the board as picks come in. Click the chip in Draft Room anytime for this reminder.

Cookies and a pasted pick log still exist under **Show cookies & paste** if a browser blocks the bookmark. Defaults stay **JackAL, pick 5** in JFL 28 until you sync a different room.

## How to draft this format

- You start **three WRs**. Early WR is not a reach the way it is in 2-WR leagues.
- You start **one RB** plus an RB/WR. Get a workhorse, then you can fill the combo with a WR.
- Never draft a D/ST. Kicker in the last round.
- 1QB: wait unless elite value falls.

Ranks start as a September 1, 2026 snapshot of public FantasyPros ECR and DraftSharks 3D values. Click **Refresh ranks** to pull live Half PPR (or whatever scoring is set in League) sheets **and recent injury flags** (Out / Q / Watch) from FantasyPros injury news, DraftSharks ranking badges when present, and the public ESPN injury report (no cookies). Overlay a CSV via **Import** if you want your own FP list.
