# Draft Room — Context

**What it is:** A desktop-oriented fantasy football draft companion. Ingests live draft activity, maintains board/rosters/clock, combines it with external rankings, and recommends picks.

**Repo:** `alexsulpizio-stack/draft-room` (`main`) · **Deploy:** Vercel project `draft-room`

**Stack:** Next.js 16.3.4, React 19.2.8, TypeScript, Tailwind 4, shadcn/Base UI, Lucide, npm, GitHub Actions CI. Desktop-first, ~1280px minimum width — mobile has never been a requirement.

See `AGENTS.md` for working conventions.

---

## ⏰ Read this first if you're picking this up before a season

**This is a draft-week tool with a two-week useful window each year.** The 2026 season opened September 9. Yahoo sync was left unfinished at that point, which means it sat unused for a full offseason.

**Assume everything Yahoo-facing has rotted.** Yahoo's DOM, network payload shapes, and draft UI will have changed. Re-validate before trusting any of it, and start in **July**, not the week of the draft.

**Strongly consider replacing the bookmarklet with Yahoo's official Fantasy Sports API.** An OAuth contract survives an offseason; DOM selectors don't. The tradeoff is latency — the API may lag a live draft where in-page interception is instant. A hybrid (API for state reconstruction, bookmarklet for real-time) is reasonable. Either way, the durable code is normalization and player matching, which don't care about the source.

---

## Priority: Yahoo, not ESPN

The app was originally built around ESPN. **Yahoo is now the primary platform; ESPN is maintenance-only.** Don't improve ESPN unless it prevents a regression or unblocks Yahoo.

Required path:

> Yahoo draft → capture → relay/ingest → player matching → picks/rosters/clock → visible sync health

**Not a manual import.** Yahoo should drive picks, roster state, current pick, upcoming picks, recommendations, and sync status automatically.

### Hard requirement: the Board tab must not be needed

An early version only worked when Yahoo's **Board** tab was selected. This was explicitly rejected. The sync must work without forcing a switch to Board, keeping it visible, or otherwise changing how the draft is normally viewed. **Test with Board deselected — a solution that needs Board is a failure.**

### Definition of done

A Yahoo pick automatically and correctly updates: selected player → overall pick → fantasy team → roster → draft position/clock → recommendations, **and the UI says whether sync is healthy.** Not done because a bookmarklet runs or a relay receives JSON.

---

## Yahoo work in progress

Branch `codex/yahoo-sync`, **not merged, not functional end-to-end.** Contains `src/lib/yahoo-relay.ts` and `src/lib/yahoo-bookmarklet.ts`.

The bookmarklet captures two ways deliberately — DOM extraction (overall pick, player name, position, NFL team) and network interception via hooks on `window.fetch` and `XMLHttpRequest`. Two paths because DOM selectors alone would be brittle; interception is also what may allow tab-independent capture.

Relay topic: `https://ntfy.sh/drjfl28jackal-yahoo` — separate from ESPN's.

**The parser is heuristic and unproven against a live Yahoo draft.** Compiling is not evidence. Likely failure points: Yahoo DOM changes, payload structure changes, duplicate picks, name normalization, fantasy-team identification, mock vs. real draft differences, lazily loaded components, non-Board views.

**Still needed:** ingest API, relay consumption, payload normalization, player matching, `DraftPick` conversion, team/slot assignment, draft state integration, roster updates, clock and current-pick updates, Yahoo UI controls and status, failure diagnostics, regression tests, CI, PR, merge, deploy verification, and validation against a real Yahoo draft.

---

## What's already merged

**PR #1 — reliability checks and CI.** Added `test` → `test:checks` and `check` → `lint && test && build`. CI on Node 24. Five deterministic regression checks: rank matching, league rank import, live rank refresh, ranks live sync, recommend ADP sentinel.

**PR #2 — ntfy relay hardening** in `src/lib/ntfy-cache.ts`: retries on transient HTTP and network failures, exponential bounded backoff, `Retry-After` support, stale-cache fallback for recent successful GETs, reusable `postNtfy()`. Infrastructure hardening — **not proof the sync chain works.**

---

## Constraints

**Don't rewrite the sync effects to satisfy lint.** React compiler warnings around refs and effects in the sync components are known. Those effects coordinate localStorage, external state, polling, and timing-sensitive sync; behavioral regressions are more dangerous than the warnings. `react-hooks/refs` and `react-hooks/set-state-in-effect` were deliberately downgraded to warnings. Refactor only with a functional reason and real tests.

**Don't force Yahoo into ESPN's shape.** `src/app/api/espn/ingest/route.ts` is a useful architectural reference, but Yahoo gets its own extraction and then normalizes into the generic draft state. Don't just rename ESPN code.

**Don't refactor the large modules yet** — `draft-app.tsx` (~74 KB), `espn.ts` (~54 KB), `espn-sync.tsx` (~39 KB), `players.ts` (~31 KB), `rank-refresh.ts` (~21 KB). Real maintainability risk, but not before Yahoo works.

**Next.js version has breaking changes.** Consult `node_modules/next/dist/docs/` before Next-specific architectural changes.

**Rankings are separate.** FantasyPros and DraftSharks feeds, `Sync FP` and `Sync DS` workflows, public ranking refreshes. Yahoo sync concerns draft activity, not rankings.

---

## Known issues, lower priority

- **Public ntfy topics.** Fixed, guessable, unauthenticated — anyone who knows a topic can publish to it, including fake picks mid-draft. Pollution, collisions, and rate limits are also possible. Worth fixing before next season; not worth a large relay rewrite that doesn't advance Yahoo.
- **FP/DS bookmarklet retries.** An unchanged signature may count as already-sent, so a failed publish might never retry; chunks sent close together may hit ntfy rate limits. Identified, never confirmed fixed.
- **Auto-merge setting.** Repository-level "Allow auto-merge" was off, so enabling PR auto-merge failed. May have changed since — check rather than assume. If unavailable, merge manually once CI is green.

---

## League config

Default league JFL 28: 12 teams, 14 rounds, user's slot 5, half PPR, first-down bonus, snake. Settings still carry ESPN-specific fields such as `espnLeagueId`.
