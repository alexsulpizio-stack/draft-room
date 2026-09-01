# Draft Room — JFL 28

Desktop draft companion for **JFL 28** on ESPN (league `1361349772`).

Snake draft is **Thursday, Sep 3, 2026 at 7:00 PM EDT**, 90 seconds a pick. This is a 12-team **half PPR** league with a WR-heavy lineup and no defense.

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

Open [http://localhost:43173](http://localhost:43173) in Chrome on a computer. Keep the ESPN draft in another tab.

## ESPN live sync

The league is private. Open **ESPN**, confirm league ID `1361349772`, paste `SWID` and `espn_s2` from fantasy.espn.com cookies, and Connect. Set **your slot** — the LM set the draft order by hand.

ESPN's `mDraftDetail` often stays empty until the draft ends. Drag **Sync Draft Room** to your bookmarks bar and click it on the live draft tab so picks still stream in.

## How to draft this format

- You start **three WRs**. Early WR is not a reach the way it is in 2-WR leagues.
- You start **one RB** plus an RB/WR. Get a workhorse, then you can fill the combo with a WR.
- Never draft a D/ST. Kicker in the last round.
- 1QB: wait unless elite value falls.

Ranks are a September 1, 2026 snapshot of public FantasyPros ECR and DraftSharks 3D-style values. Overlay a fresh FantasyPros CSV via **Import** if you want.
