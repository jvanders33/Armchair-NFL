# Armchair Experts — the Australian NFL Platform

Turning **Armchair Experts** (Cam Luke & Ben Graham's NFL podcast/video show) from a media brand into a Spotrac/Tankathon-style **platform for the NFL in Australia** — a personality-led *voice* on top of a data-driven *utility* layer, monetised through a Disney+/ESPN streaming partnership.

Built on the **ListTrac engine** (the AFL list-management platform's data → product pipeline), repointed at the NFL. Kept separate from `Desktop/ListTrac/`, which continues independently.

## The first real module: What to Watch

A live weekly hub answering the only question that matters for an Australian NFL fan: **what's worth watching, when does it kick off in my timezone, and where do I stream it.**

- **Live schedule + odds** from ESPN's public scoreboard feed (real fixtures, spreads, totals, records, broadcasters, team logos).
- **Win-probability meters** — de-vigged moneylines, spread-logistic fallback.
- **Watchability model** — every game scored (closeness of line + expected points + team quality + prime-time window + Aussie involvement) and tiered *Must-watch / Worth it / Deep cut*; the top game becomes Game of the Week.
- **Australian timezones** — Sydney / Brisbane / Perth conversion, client-side.
- **Aussies in the NFL** — curated layer (`data/aussies.json`) flagging every game with an Australian on the field.
- **Tracked Disney+ CTAs** — every card is a conversion surface carrying UTM parameters (the attribution story from the pitch).
- **Week navigation** across preseason → regular season → playoffs (ESPN calendar-driven), live scores and finals shown in-place.

## Run it

```bash
pip install -r requirements.txt
uvicorn api.app:app --app-dir . --port 8020
```

Then open http://localhost:8020.

## Deploy (Vercel)

Same pattern as ListTrac: everything routes through the Python function `api/index.py` (see `vercel.json`); FastAPI serves both the API and the `web/` static SPA. Import the repo in Vercel and it deploys as-is. **Do not rename `web/` to `public/`** — Vercel strips that folder name from Python bundles.

## Structure

| Path | What it is |
|---|---|
| `api/app.py` | FastAPI — `/api/schedule` (normalised ESPN slate, 10-min cache), `/api/aussies`, `/api/debug`, static serving |
| `web/` | No-build vanilla SPA — the What to Watch hub |
| `data/aussies.json` | Hand-curated Aussies-in-the-NFL list — **maintain each season / after cut-down day** |
| `scraper/` | (empty for now) future NFL data ingestion — nflverse, Spotrac, Over The Cap |
| `pitch/` | Pitch assets: hub concept prototype, the Disney+ deck slides — Audience & Reach, Measurement & Attribution, and a live-platform slide with real screenshots (`Armchair-Disney-slides.pptx`, rebuilt via `gen-slides.js`; refresh `assets/*.png` with new captures first) — and the platform map |

## Pitch context

- **One-liner:** Armchair = *Men in Blazers' market position + a Spotrac/Tankathon data spine* — a combination nobody has built for a foreign league in a new market. The voice wins the audience; the utility wins the daily year-round habit; Disney+ gets a measurable ROI story instead of a seasonal sponsorship.
- **Deck feedback:** strong media buy, but it sells a *voice* when Disney+ will pay more for a *habit*. Two gaps closed in `pitch/`: prove the audience (Audience & Reach slide), show attribution (Measurement & Attribution slide).
- Published artifacts: [hub prototype](https://claude.ai/code/artifact/0401f863-55ec-42b4-b805-f623c0202867) · [two slides](https://claude.ai/code/artifact/0626fa7b-5167-406b-91ad-ce2f8f2c5453) · [platform map](https://claude.ai/code/artifact/6b459ebe-32a0-4601-a6a6-15967d07d349)

## Roadmap (ListTrac playbook, NFL edition)

1. **What to Watch** (this) — the weekly habit anchor.
2. Contracts & cap module — NFL data is public (Spotrac / Over The Cap), so unlike the AFL build, dollars *can* be shown.
3. Draft module — Tankathon-style order tracker + mock draft (the ListTrac mock-draft engine generalises).
4. Aussies tracker — deep profiles, snap counts, the pathway pipeline (college punters etc.).
5. Shareable content — top-10 builders, watchlist cards, the social PNG pipeline from ListTrac.

*Prototype for pitch purposes; not affiliated with or endorsed by the NFL, ESPN or Disney+. Team marks are used for identification only.*
