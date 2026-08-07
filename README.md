# Armchair Experts — Every Sport. One Armchair.

The platform behind **Armchair Experts** (Cam Luke) — the voice of sports fans in Australia. One masthead over every code: the shows are the voice, this is the anchor between them.

**Live: [armchair-nfl.vercel.app](https://armchair-nfl.vercel.app)**

Built on the **ListTrac engine** (the AFL list-management platform's data → product pipeline), generalised so a new league is a config entry rather than a rebuild.

## What's live

| Surface | What it does |
|---|---|
| **Landing** | The network front door — logo, tagline, channel menu (Leagues / Shows / Podcasts), socials |
| **Leagues** | The code picker: NFL, AFL, NBL live; racing to come. Newsletter signup + Ask the Experts mailbag |
| **League hubs** (`#/nfl`, `#/afl`, `#/nbl`) | Rotating image-led top story, live fixtures with watchability ranking, aggregated news, clubs and players. NFL adds the MCG countdown, the 10-day advent rail and the Experts' calls |
| **Clubs & players** | Every club, every roster, career stats (NFL); AFL clubs hand off to ListTrac for lists, contracts and trades |
| **Shows** | The full slate with status, plus the Always On runway — the year with no dark weeks |
| **Podcasts** | Fanned show deck + latest episodes |
| **A Sporting Christmas** | The 2016 miracle year, five teams, told on the data spine |
| `#/audience`, `#/partner` | Pitch collateral — deliberately **not** in site nav |

## Architecture

**One shell, every code.** Adding a league is two rows: `LEAGUES_CFG` in `api/app.py` (ESPN sport path, timezone, slot style) and `LEAGUE_UI` in `web/app.js` (labels, tools). Everything else — hub, hero, news, fixtures, clubs, routing — comes for free.

**News is aggregated, not single-source.** Two tiers per league: named publishers with clean feeds (which carry the photography) plus a Google News sweep that catches every masthead without a usable feed. Fetched in parallel, deduped on headline, ranked by recency with a nudge toward stories that brought art. ~50–60 stories from 9–12 outlets per league, 15-minute cache.

**Watchability** ranks each fixture on line closeness, expected points, team quality and timeslot. The NFL has odds so it gets win-probability meters; the Australian codes don't, so the model degrades to form and slot.

## Run it

```bash
pip install -r requirements.txt
uvicorn api.app:app --app-dir . --port 8020
```

Note: uvicorn does **not** hot-reload `api/app.py` here — restart after backend edits or you'll debug stale code.

## Deploy

Everything routes through the Python function `api/index.py` (see `vercel.json`); FastAPI serves both the API and the `web/` SPA. Push to `main` and Vercel redeploys. **Don't rename `web/` to `public/`** — Vercel strips that name from Python bundles.

## Editing content

| File | Holds |
|---|---|
| `data/shows.json` | The slate and the Always On runway |
| `data/experts.json` | Weekly Experts' calls, the Cali to the 'G advent calendar (Sep 1–10 drop dates), optional pinned hero stories |
| `data/christmas.json` | A Sporting Christmas editorial |
| `data/audience.json` | Audience figures for the pitch page (`verified: false` renders an "indicative" chip) |
| `data/aussies.json` | Aussies-in-the-NFL layer |

Keep unannounced commercial details (co-host negotiations, revenue splits, funding) **out of these files** — they render publicly.

## Structure

| Path | What it is |
|---|---|
| `api/app.py` | FastAPI — league registry, schedule, news aggregation, teams, players, capture, partner metrics |
| `web/` | No-build vanilla SPA + self-hosted fonts (Anton / Barlow Condensed / Inter) |
| `data/` | Editable content files |
| `pitch/` | Deck generators and assets — Disney+ slides, the "Running it Back" Gurley proposal, the flywheel, the Monday Armchair sample issue |

## Design system

Committed dark (no light variant — the brand doesn't hedge), iHeart red `#F5294B` on near-black `#0F0407`, Anton for display, accent-slab section headers, official league marks, depth on every card. Asset URLs are versioned (`?v=`) — **bump on every CSS/JS change** or cached browsers keep the old files.

*Prototype for pitch purposes. Not affiliated with the NFL, ESPN, Disney+, the AFL or the NBL. League and team marks used for identification only.*
