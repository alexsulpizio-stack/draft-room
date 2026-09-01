# Draft Room

A live 2026 fantasy football draft companion that sits between **FantasyPros** and **DraftSharks**.

Use it on your laptop or phone Wednesday while the room is picking. It blends public FantasyPros ECR with DraftSharks 3D-style ranks, flags where those two boards disagree, and tells you who to take **on the clock** given your roster holes.

Rankings are a **September 1, 2026 snapshot**. Paste your latest FantasyPros cheat sheet before you draft if you want the overlay refreshed.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:43173](http://localhost:43173).

## Before the draft

1. Open **League** and set teams, your slot, PPR/half/standard, and Superflex.
2. Drag **Trust DraftSharks** toward DS if you live in their 3D values, toward 0% if you want pure FantasyPros.
3. Optional: **Import** and paste a FantasyPros CSV (`RK,PLAYER NAME,TEAM,POS,ADP`).
4. Hit **Jump to me** a few times to mock your turn and see who tends to fall.

## On the clock

- Search a name, tap **Draft** on your pick or **Taken** on everyone else.
- The middle column ranks six names with *why* (need, ADP fall, DS vs FP gap, positional cliff).
- Star players you want. **FP vs DS** is the disagreement board — that is the whole reason to use both sites.
- **Undo** and **Reset** if you misclick. State is saved in the browser.

## What this is not

Not a licensed FantasyPros or DraftSharks product. Official ranks live on those sites. This is a war-room layer on top of a public snapshot plus your own paste.
