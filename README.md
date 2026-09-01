# Draft Room

A live 2026 fantasy football draft companion that sits between **FantasyPros** and **DraftSharks**, and stays in sync with an **ESPN** room.

Use it on your laptop or phone Wednesday while the room is picking. It blends public FantasyPros ECR with DraftSharks 3D-style ranks, flags where those two boards disagree, and tells you who to take **on the clock** given your roster holes.

Rankings are a **September 1, 2026 snapshot**. Paste your latest FantasyPros cheat sheet before you draft if you want the overlay refreshed.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:43173](http://localhost:43173).

## ESPN live sync

ESPN's league API (`mDraftDetail`) often stays empty until the draft is over. Draft Room covers that with three layers:

1. **Connect ESPN** — paste the league URL or ID. Public leagues load as-is. Private leagues need `SWID` and `espn_s2` from `fantasy.espn.com` cookies (Chrome → Application → Cookies). Those stay in this browser and are only forwarded to ESPN.
2. **Poll** — every two seconds the app asks ESPN for new picks, maps them onto this board (including custom pick order, PPR vs standard, Superflex, and roster slots), and treats ESPN as the source of truth. Jump-to-me is disabled while connected.
3. **Room capture** — drag the **Sync Draft Room** bookmarklet onto your bookmarks bar, open the ESPN draft tab, and click it. A green chip on that page reads the live React state and POSTs picks here. Use this when the official API is silent.

You can also paste ESPN pick history (`1.01 Jahmyr Gibbs`) if the bookmarklet is blocked.

Cookies never go into git. They live in `localStorage` on this machine.

## Before the draft

1. Open **ESPN** and connect the league, or **League** to set teams, your slot, PPR/half/standard, and Superflex by hand.
2. Drag **Trust DraftSharks** toward DS if you live in their 3D values, toward 0% if you want pure FantasyPros.
3. Optional: **Import** and paste a FantasyPros CSV (`RK,PLAYER NAME,TEAM,POS,ADP`).
4. If you are not live on ESPN yet, hit **Jump to me** a few times to mock your turn and see who tends to fall.

## On the clock

- Search a name, tap **Draft** on your pick or **Taken** on everyone else. While ESPN is connected, the room overwrites local clicks on the next poll.
- The middle column ranks six names with *why* (need, ADP fall, DS vs FP gap, positional cliff).
- Star players you want. **FP vs DS** is the disagreement board — that is the whole reason to use both sites.
- **Undo** and **Reset** if you misclick. State is saved in the browser.

## What this is not

Not a licensed FantasyPros, DraftSharks, or ESPN product. Official ranks live on those sites. This is a war-room layer on top of a public snapshot, your own paste, and ESPN's public fantasy API.
