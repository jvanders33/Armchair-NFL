# Armchair Experts — Every Sport. One Armchair.

The platform behind **Armchair Experts** (Cam Luke) — the voice of sports fans in Australia. One masthead over every code: the shows are the voice, this is the anchor between them.

**Live: [armchair-nfl.vercel.app](https://armchair-nfl.vercel.app)**

Built on the **ListTrac engine** (the AFL list-management platform's data → product pipeline), generalised so a new league is a config entry rather than a rebuild.

## What's live

| Surface | What it does |
|---|---|
| **Landing** | The network front door — logo, tagline, channel menu, socials, and the cross-code **Coming up** calendar (every major event, any code, from `data/events.json`) |
| **Leagues** | The code picker: NFL, AFL, NBL, NRL, NBA and Racing, all live. Newsletter signup + Ask the Experts mailbag |
| **League hubs** (`#/nfl`, `#/afl`, `#/nbl`) | Rotating image-led top story, headline ticker, live fixtures with watchability ranking (live-score polling while games run), aggregated news + numbered top stories, clubs and players. NFL adds the MCG versus-strip countdown, the 10-day advent rail and the Experts' calls. AFL adds the full 1–18 ladder with the 2026 wildcard lines, the finals bracket (projected from the ladder until it locks), season leaders, round-by-round form guides and official-stats player pages. NBL adds season leaders, rosters and career pages from the league's own feed |
| **NRL hub** (`#/nrl`) | Round-by-round draw, live ladder with the top-eight line, all 17 clubs, aggregated news — pure ESPN shell (see the quirks in `LEAGUES_CFG`) |
| **NBA hub** (`#/nba`) | The nightly slate in Sydney time with a **day stepper**, win-probability meters, teams by division, full rosters, career-stat player pages, East/West standings with playoff and play-in lines, and **Aussies in the NBA** (roster birthplace scan + `data/aussies_nba.json`) |
| **Racing hub** (`#/racing`) | The same shell on racing.com's national feed: every meeting in every state ranked by black type, Race of the Day with silks and odds, the Road to the Cup countdown, The Spring rail, next-to-jump, the premierships, last Saturday's black-type results, meeting cards, race pages (fields or finishing order), and jockey/trainer/horse profiles with form |
| **Clubs & players** | Every club, every roster, career stats — ESPN for the NFL, the AFL's Champion Data feed for AFL lists and players, the NBL's Rosetta feed for NBL rosters and careers; AFL clubs also hand off to ListTrac for contracts and trades |
| **Shows** | The full slate with status, plus the Always On runway — the year with no dark weeks |
| **Podcasts** | Fanned show deck + latest episodes |
| **A Sporting Christmas** | The 2016 miracle year, five teams, told on the data spine |
| `#/audience`, `#/partner` | Pitch collateral — deliberately **not** in site nav |

## Architecture

**One shell, every code.** Adding a league is two rows: `LEAGUES_CFG` in `api/app.py` (ESPN sport path, timezone, slot style) and `LEAGUE_UI` in `web/app.js` (labels, tools). Everything else — hub, hero, news, fixtures, clubs, routing — comes for free.

**News is aggregated, not single-source.** Two tiers per league: named publishers with clean feeds (which carry the photography) plus a Google News sweep that catches every masthead without a usable feed. Fetched in parallel, deduped on headline, ranked by recency with a nudge toward stories that brought art. ~50–60 stories from 9–12 outlets per league, 15-minute cache.

**Watchability** ranks each fixture on line closeness, expected points, team quality and timeslot. The NFL has odds so it gets win-probability meters; the Australian codes don't, so the model degrades to form and slot. Racing ranks races on black-type status, metro venue, Saturday and field size.

**Data sources.** ESPN's public JSON for NFL/AFL/NBL fixtures, news and standings. Beyond ESPN: the AFL's official Champion Data stats API (`api.afl.com.au`, token handshake) for AFL leaders, lists, player pages, form guides and the finals bracket; the NBL's Rosetta API (`prod.rosetta.nbl.com.au`, Origin-gated) for NBL leaders, rosters and careers; racing.com's GraphQL layer (Champion Data racing behind `graphql.rmdprod.racing.com`, editorial and premierships behind `graphql.api.racing.com`, public client keys) for everything racing — see `api/racing.py`.

**Where to watch.** No exclusive streaming partner. Every watch button points at the real Australian broadcaster for that code (`WATCH` in `web/app.js`): 7plus / Kayo / Game Pass for the NFL, 7plus / Kayo for the AFL, 9Now / Kayo for the NBL, Racing.com / 7plus / Sky Racing for racing.

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
| `data/aussies_nba.json` | Curated half of the Aussies-in-the-NBA layer — names ESPN lists without a birthplace, plus hooks; must match ESPN `fullName` |
| `data/racing.json` | The spring feature-race spine (the Road to the Cup countdown + The Spring rail) — update each winter |
| `data/events.json` | The landing-page calendar: one line per major event, any code (NRL, NBA, EPL slot in here first) |

Keep unannounced commercial details (co-host negotiations, revenue splits, funding) **out of these files** — they render publicly.

## Structure

| Path | What it is |
|---|---|
| `api/app.py` | FastAPI — league registry, schedule, news aggregation, teams, players, ladder, leaders, form, finals, NBL layer, capture, partner metrics |
| `api/racing.py` | The racing data layer — racing.com GraphQL queries, watchability, premierships, profiles, weekend results |
| `web/` | No-build vanilla SPA + self-hosted fonts (Anton / Barlow Condensed / Inter) |
| `data/` | Editable content files |
| `pitch/` | Deck generators and assets — Disney+ slides, the "Running it Back" Gurley proposal, the flywheel, the Monday Armchair sample issue |

## Design system

Committed dark (no light variant — the brand doesn't hedge), iHeart red `#F5294B` on near-black `#0F0407`, Anton for display, accent-slab section headers, official league marks, depth on every card. Asset URLs are versioned (`?v=`) — **bump on every CSS/JS change** or cached browsers keep the old files.

*Prototype for pitch purposes. Not affiliated with the NFL, ESPN, Disney+, the AFL or the NBL. League and team marks used for identification only.*
