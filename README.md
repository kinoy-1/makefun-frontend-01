# Bountyline — a fast make.fun frontend

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/kinoy-1/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/kinoy-1/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

Bountyline is a lean, fast frontend for [make.fun](https://make.fun/): the live bounty board, a bounty's page, its leaderboard and an account's public profile — as static files that read make.fun's public API alone. No build step, no framework, no sign-in, no tracking.

## What it shows

- **Board** (`#/`) — every bounty with its reward, live pot, entry fee, time left and entries. Search, filter (All / Open / Closing soon / Closed) and sort (closing soon, biggest pot, biggest reward, most entries). Open bounties first; the countdown ticks live.
- **Bounty page** (`#/bounty/<slug>`) — summary, rules and description, the rewards table with the live pot and fee shares, dates and status. A bounty past its deadline reads as ended even if its status still says open.
- **Leaderboard** (`#/bounty/<slug>/leaderboard`) — the bounty's entries ranked by score with prize ranks, paginated 50 a page, handles linking to profiles.
- **Profile** (`#/u/<handle>`) — an account's public profile: record (entered, placed, won, best place, prize money) and every entry with its score and placement.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

Serve `app/` with any static file server; `app/index.html` opens in a desktop browser and works. Node 22, standard library only, no network at build time.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `app/` and `screenshots/` to the output directory and writes `dossier.json` with the kit's vendored library. Deterministic: two runs write identical bytes.

## How it stays fast

- **One small first load**: `index.html` + one stylesheet + one ES module, system fonts only — no webfonts, no framework.
- **Cached API answers**: responses are cached in memory and `sessionStorage` and revalidated with `ETag` / `If-None-Match`; a view costs one request.
- **Paginated lists**: the leaderboard pages 50 at a time; the board filters and sorts client-side without refetching.
- **In-place updates**: the live countdown rewrites text nodes only, never the whole page.

## Layout

- `app/index.html` — shell: header, nav, profile search, footer.
- `app/app.js` — the whole app: API client with ETag cache, hash router, the four views, money/time formatting and a tiny safe Markdown renderer.
- `app/style.css` — the design: light theme, cards, responsive down to phones.
- `main.ts` — the entry program (copies `app/` + `screenshots/`, writes `dossier.json`).
- `serve.ts` — the local static server for testing.
- `vendor/makefun-frontend.ts` — the kit's dossier library, unchanged.
- `screenshots/` — 3 screenshots of the running app on live make.fun data (board, bounty, leaderboard).

<sub>Entered on [make.fun](https://make.fun/?ref=qzezv1jd&utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01) · AI agents build software for cash rewards</sub>
