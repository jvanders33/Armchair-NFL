"""Armchair Experts — the NFL utility layer for Australia.

FastAPI app serving:
  /api/schedule — normalised weekly NFL slate (ESPN public scoreboard, cached)
  /api/aussies  — curated Aussies-in-the-NFL list (data/aussies.json)
  /api/debug    — deployed-bundle lister (Vercel debugging)
  everything else — the web/ static SPA

Run locally:  uvicorn api.app:app --app-dir <repo> --port 8020
"""
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = ROOT / "data"

ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
ESPN_WEB = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl"
ESPN_SCOREBOARD = f"{ESPN_SITE}/scoreboard"
CACHE_TTL = 600  # seconds; the slate changes slowly, live scores are fine at 10 min for v1

app = FastAPI(title="Armchair Experts API")

_cache: dict[str, tuple[float, dict]] = {}


# ESPN's edge (Akamai) blocks browser-like UAs from non-browser clients but passes
# plain client UAs — send curl-style first, fall back to requests' default on 403.
_UAS = ("curl/8.9.1", "python-requests/2.32")


def _get_json(url: str, params: dict | None = None, ttl: int = CACHE_TTL) -> dict:
    key = url + "?" + json.dumps(params or {}, sort_keys=True)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    last = None
    for ua in _UAS:
        r = requests.get(url, params=params, timeout=15, headers={"User-Agent": ua})
        if r.status_code == 403:
            last = r
            continue
        r.raise_for_status()
        data = r.json()
        _cache[key] = (time.time(), data)
        return data
    last.raise_for_status()


def _fetch_scoreboard(year: int | None, seasontype: int | None, week: int | None) -> dict:
    params = {}
    if year:
        params["dates"] = str(year)  # ESPN takes the season year via `dates`, not `year`
    if seasontype:
        params["seasontype"] = str(seasontype)
    if week:
        params["week"] = str(week)
    return _get_json(ESPN_SCOREBOARD, params)


# ---------- odds → win probability ----------

def _implied(odds_str: str) -> float | None:
    """American moneyline string → implied probability (with vig)."""
    try:
        s = odds_str.strip().upper()
        if s in ("EVEN", "EV", "PK"):
            return 0.5
        o = int(s.replace("+", ""))
        return 100 / (o + 100) if o > 0 else -o / (-o + 100)
    except (ValueError, AttributeError):
        return None


def _home_win_prob(odds: dict | None) -> float | None:
    """Prefer de-vigged moneyline; fall back to a spread logistic."""
    if not odds:
        return None
    ml = odds.get("moneyline") or {}
    try:
        ih = _implied(ml["home"]["close"]["odds"])
        ia = _implied(ml["away"]["close"]["odds"])
        if ih and ia:
            return round(ih / (ih + ia), 3)
    except (KeyError, TypeError):
        pass
    spread = odds.get("spread")  # ESPN reports the HOME team's line (-3.5 = home favoured)
    if spread is not None:
        margin_home = -float(spread)
        return round(1 / (1 + math.exp(-0.145 * margin_home)), 3)
    return None


# ---------- kickoff slot labelling (US Eastern windows) ----------

def _slot(dt_utc: datetime, seasontype: int) -> str:
    try:
        from zoneinfo import ZoneInfo
        et = dt_utc.astimezone(ZoneInfo("America/New_York"))
    except Exception:
        # tzdata missing — approximate ET (EDT Mar–Oct, EST Nov–Feb); labels only
        from datetime import timedelta
        offset = 4 if 3 <= dt_utc.month <= 10 else 5
        et = dt_utc - timedelta(hours=offset)
    wd, hr = et.weekday(), et.hour
    if seasontype == 1:
        return et.strftime("%A") + " preseason"
    if wd == 3:
        return "Thursday Night Football" if hr >= 19 else "Thursday"
    if wd == 4:
        return "Friday Football"
    if wd == 5:
        return "Saturday · Late" if hr >= 16 else "Saturday · Early"
    if wd == 6:
        if hr >= 19:
            return "Sunday Night Football"
        return "Sunday · Late" if hr >= 16 else "Sunday · Early"
    if wd == 0:
        return "Monday Night Football"
    return et.strftime("%A")


_SLOT_BONUS = {
    "Sunday Night Football": 14, "Monday Night Football": 14,
    "Thursday Night Football": 10, "Sunday · Late": 6,
    "Saturday · Late": 4, "Saturday · Early": 4,
}


def _win_pct(record: str) -> float:
    try:
        parts = [int(p) for p in record.split("-")]
        w, l = parts[0], parts[1]
        t = parts[2] if len(parts) > 2 else 0
        total = w + l + t
        return (w + 0.5 * t) / total if total else 0.5
    except (ValueError, AttributeError, IndexError):
        return 0.5


def _watch_score(spread, over_under, home_rec, away_rec, slot, has_aussie, in_australia=False) -> float:
    score = 50.0
    if spread is not None:
        score -= min(24.0, abs(float(spread)) * 2.2)      # closeness
    if over_under:
        score += max(-8.0, min(12.0, (float(over_under) - 42.0) * 1.1))  # expected points
    quality = (_win_pct(home_rec) + _win_pct(away_rec)) / 2 - 0.5
    score += quality * 40                                  # combined team quality
    score += _SLOT_BONUS.get(slot, 0)
    if has_aussie:
        score += 6
    if in_australia:
        score += 20  # an Australian platform ranks the game played in Australia first
    return round(score, 1)


def _tier(score: float) -> int:
    return 1 if score >= 62 else (2 if score >= 48 else 3)


# ---------- normalisation ----------

def _load_aussies() -> list[dict]:
    try:
        return json.loads((DATA / "aussies.json").read_text(encoding="utf-8"))["players"]
    except Exception:
        return []


def _load_experts() -> dict:
    try:
        return json.loads((DATA / "experts.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def _competitor(c: dict) -> dict:
    t = c.get("team", {})
    abbr = t.get("abbreviation", "")
    recs = c.get("records") or []
    record = recs[0].get("summary", "") if recs else ""
    return {
        "abbr": abbr,
        "name": t.get("name", ""),
        "displayName": t.get("displayName", ""),
        "color": t.get("color"),
        "altColor": t.get("alternateColor"),
        "logo": t.get("logo") or f"https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/{abbr.lower()}.png",
        "record": record,
        "score": c.get("score"),
        "winner": c.get("winner"),
    }


def _calendar(payload: dict) -> list[dict]:
    """Flatten ESPN's league calendar into [(seasontype, week, label)] for week nav."""
    out = []
    try:
        for cal in payload["leagues"][0]["calendar"]:
            st = int(cal.get("value", 0))
            for e in cal.get("entries", []):
                out.append({
                    "seasontype": st,
                    "week": int(e.get("value", 0)),
                    "label": e.get("label", ""),
                    "start": e.get("startDate"),
                    "end": e.get("endDate"),
                })
    except (KeyError, IndexError, ValueError, TypeError):
        pass
    return out


@app.get("/api/schedule")
def schedule(year: int | None = None, seasontype: int | None = None, week: int | None = None):
    try:
        payload = _fetch_scoreboard(year, seasontype, week)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"ESPN feed unavailable: {exc}") from exc

    aussies = _load_aussies()
    aussie_by_team = {}
    for p in aussies:
        aussie_by_team.setdefault(p["team"], []).append(p)

    season = payload.get("season", {})
    wk = payload.get("week", {})
    st = int(season.get("type", 2) or 2)

    games = []
    for ev in payload.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        competitors = comp.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        h, a = _competitor(home), _competitor(away)

        odds = (comp.get("odds") or [None])[0]
        hp = _home_win_prob(odds)
        spread = odds.get("spread") if odds else None
        ou = odds.get("overUnder") if odds else None
        details = odds.get("details") if odds else None

        try:
            dt = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(timezone.utc)
        except (KeyError, ValueError):
            continue
        slot = _slot(dt, st)

        game_aussies = aussie_by_team.get(h["abbr"], []) + aussie_by_team.get(a["abbr"], [])
        status = ev.get("status", {}).get("type", {})
        bc = (comp.get("broadcasts") or [{}])[0].get("names", [])
        venue = comp.get("venue", {})
        venue_name = venue.get("fullName", "")
        in_australia = "Melbourne" in venue_name or "Australia" in str(venue.get("address", {}))
        score = _watch_score(spread, ou, h["record"], a["record"], slot, bool(game_aussies), in_australia)

        games.append({
            "id": ev.get("id"),
            "name": ev.get("name"),
            "shortName": ev.get("shortName"),
            "date": dt.isoformat().replace("+00:00", "Z"),
            "slot": slot,
            "broadcast": " / ".join(bc),
            "venue": venue.get("fullName", ""),
            "home": h,
            "away": a,
            "odds": {"details": details, "spread": spread, "overUnder": ou},
            "homeWinProb": hp,
            "watch": {"score": score, "tier": _tier(score)},
            "status": {
                "state": status.get("state", "pre"),
                "detail": status.get("shortDetail", ""),
                "completed": status.get("completed", False),
            },
            "aussies": [{"name": p["name"], "pos": p["pos"], "team": p["team"], "hook": p.get("hook", "")}
                        for p in game_aussies],
        })

    games.sort(key=lambda g: (-g["watch"]["score"], g["date"]))
    gotw = next((g["id"] for g in games if g["status"]["state"] != "post"), games[0]["id"] if games else None)

    # the VOICE layer — attach the Experts' calls for this week
    experts = _load_experts()
    week_key = f"{season.get('year')}-{st}-{wk.get('number')}"
    week_experts = (experts.get("weeks") or {}).get(week_key, {})
    calls = week_experts.get("calls", {})
    experts_gotw_id = None
    for g in games:
        matchup = f"{g['away']['abbr']}@{g['home']['abbr']}"
        if matchup in calls:
            g["expertCall"] = calls[matchup]
        if matchup == week_experts.get("gotw"):
            experts_gotw_id = g["id"]

    return {
        "season": {"year": season.get("year"), "type": st},
        "week": {"number": wk.get("number")},
        "calendar": _calendar(payload),
        "gotw": gotw,
        "games": games,
        "experts": {
            "show": experts.get("show", {}),
            "gotw": experts_gotw_id,
            "episode": week_experts.get("episode"),
        },
        "source": "ESPN public scoreboard API · odds by ESPN BET/DraftKings · cached 10 min",
    }


@app.get("/api/road-to-the-g")
def road_to_the_g():
    """The MCG game (SF vs LAR, 11 Sep 2026) straight from the live feed + the series rail."""
    experts = _load_experts()
    game = None
    try:
        payload = _fetch_scoreboard(2026, 2, 1)
        for ev in payload.get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            venue = (comp.get("venue") or {}).get("fullName", "")
            if "Melbourne" in venue:
                competitors = comp.get("competitors", [])
                home = next((c for c in competitors if c.get("homeAway") == "home"), None)
                away = next((c for c in competitors if c.get("homeAway") == "away"), None)
                status = ev.get("status", {}).get("type", {})
                game = {
                    "id": ev.get("id"),
                    "name": ev.get("name"),
                    "shortName": ev.get("shortName"),
                    "date": ev.get("date"),
                    "venue": venue,
                    "home": _competitor(home) if home else None,
                    "away": _competitor(away) if away else None,
                    "status": {"state": status.get("state", "pre"),
                               "detail": status.get("shortDetail", ""),
                               "completed": status.get("completed", False)},
                }
                break
    except requests.RequestException:
        pass
    return {"game": game, "series": experts.get("road_to_the_g", {}), "show": experts.get("show", {})}


@app.get("/api/aussies")
def api_aussies():
    return {"players": _load_aussies()}


# ---------- teams / rosters / players ----------

DIVISIONS = [
    ("AFC East", ["BUF", "MIA", "NE", "NYJ"]),
    ("AFC North", ["BAL", "CIN", "CLE", "PIT"]),
    ("AFC South", ["HOU", "IND", "JAX", "TEN"]),
    ("AFC West", ["DEN", "KC", "LAC", "LV"]),
    ("NFC East", ["DAL", "NYG", "PHI", "WSH"]),
    ("NFC North", ["CHI", "DET", "GB", "MIN"]),
    ("NFC South", ["ATL", "CAR", "NO", "TB"]),
    ("NFC West", ["ARI", "LAR", "SEA", "SF"]),
]

AU_HINTS = ("Australia", ", NSW", ", VIC", ", QLD", ", WA", ", SA", ", TAS", ", ACT", ", NT")


def _is_aussie(birthplace: dict | str | None, name: str = "") -> bool:
    if isinstance(birthplace, dict):
        return (birthplace.get("country") or "") == "Australia"
    if isinstance(birthplace, str) and any(birthplace.endswith(h) or h.strip(", ") == birthplace for h in AU_HINTS):
        return True
    return any(p["name"] == name for p in _load_aussies())


@app.get("/api/teams")
def api_teams():
    payload = _get_json(f"{ESPN_SITE}/teams", ttl=86400)
    by_abbr = {}
    for entry in payload["sports"][0]["leagues"][0]["teams"]:
        t = entry["team"]
        logos = t.get("logos") or []
        by_abbr[t["abbreviation"]] = {
            "abbr": t["abbreviation"],
            "location": t.get("location", ""),
            "name": t.get("name", ""),
            "displayName": t.get("displayName", ""),
            "color": t.get("color"),
            "altColor": t.get("alternateColor"),
            "logo": logos[0]["href"] if logos else None,
        }
    return {"divisions": [
        {"name": name, "teams": [by_abbr[a] for a in abbrs if a in by_abbr]}
        for name, abbrs in DIVISIONS
    ]}


ROSTER_GROUP_LABELS = {
    "offense": "Offense", "defense": "Defense", "specialTeam": "Special teams",
    "injuredReserveOrOut": "Injured reserve / out", "suspended": "Suspended",
    "practiceSquad": "Practice squad",
}


@app.get("/api/team/{abbr}")
def api_team(abbr: str):
    slug = abbr.lower()
    try:
        detail = _get_json(f"{ESPN_SITE}/teams/{slug}", ttl=21600)["team"]
        roster = _get_json(f"{ESPN_SITE}/teams/{slug}/roster", ttl=21600)
    except requests.HTTPError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown team {abbr}") from exc

    logos = detail.get("logos") or []
    rec_items = (detail.get("record") or {}).get("items") or [{}]
    division = next((n for n, ab in DIVISIONS if detail.get("abbreviation") in ab), "")

    next_event = None
    ne = detail.get("nextEvent") or []
    if ne:
        next_event = {"name": ne[0].get("name", ""), "shortName": ne[0].get("shortName", ""),
                      "date": ne[0].get("date", "")}

    groups = []
    for g in roster.get("athletes", []):
        items = g.get("items", [])
        if not items:
            continue
        players = []
        for a in items:
            players.append({
                "id": a.get("id"),
                "name": a.get("fullName", ""),
                "jersey": a.get("jersey", ""),
                "pos": (a.get("position") or {}).get("abbreviation", ""),
                "age": a.get("age"),
                "height": a.get("displayHeight", ""),
                "weight": a.get("displayWeight", ""),
                "college": (a.get("college") or {}).get("name", ""),
                "exp": (a.get("experience") or {}).get("years"),
                "headshot": (a.get("headshot") or {}).get("href"),
                "aussie": _is_aussie(a.get("birthPlace"), a.get("fullName", "")),
            })
        players.sort(key=lambda p: (p["pos"], int(p["jersey"]) if str(p["jersey"]).isdigit() else 999))
        groups.append({"key": g.get("position", ""),
                       "label": ROSTER_GROUP_LABELS.get(g.get("position", ""), g.get("position", "").title()),
                       "players": players})

    return {
        "team": {
            "abbr": detail.get("abbreviation"),
            "displayName": detail.get("displayName", ""),
            "location": detail.get("location", ""),
            "name": detail.get("name", ""),
            "color": detail.get("color"),
            "altColor": detail.get("alternateColor"),
            "logo": logos[0]["href"] if logos else None,
            "record": rec_items[0].get("summary", ""),
            "standing": detail.get("standingSummary", ""),
            "division": division,
            "nextEvent": next_event,
        },
        "groups": groups,
        "source": "ESPN public API · cached 6 h",
    }


@app.get("/api/player/{pid}")
def api_player(pid: str):
    try:
        bio = _get_json(f"{ESPN_WEB}/athletes/{pid}", ttl=21600)
        stats = _get_json(f"{ESPN_WEB}/athletes/{pid}/stats", ttl=21600)
    except requests.HTTPError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown player {pid}") from exc
    a = bio.get("athlete", bio)

    team = a.get("team") or {}
    birthplace = a.get("displayBirthPlace", "")
    name = a.get("displayName", "")

    # teamId → abbr map so season rows show the club (players move teams)
    team_abbrs = {}
    for t in (stats.get("teams") or {}).values() if isinstance(stats.get("teams"), dict) else []:
        team_abbrs[str(t.get("id"))] = t.get("abbreviation", "")
    if isinstance(stats.get("teams"), list):
        for t in stats["teams"]:
            team_abbrs[str(t.get("id"))] = t.get("abbreviation", "")

    categories = []
    for c in stats.get("categories", []):
        seasons = []
        for s in c.get("statistics", []):
            seasons.append({
                "season": (s.get("season") or {}).get("displayName", ""),
                "team": team_abbrs.get(str(s.get("teamId")), (s.get("teamSlug") or "").upper()[:3]),
                "stats": s.get("stats", []),
            })
        if seasons:
            categories.append({
                "name": c.get("displayName", c.get("name", "")),
                "labels": c.get("labels", []),
                "seasons": seasons,
                "totals": c.get("totals", []),
            })

    news = []
    try:
        overview = _get_json(f"{ESPN_WEB}/athletes/{pid}/overview", ttl=3600)
        for n in (overview.get("news") or [])[:4]:
            link = ((n.get("links") or {}).get("web") or {}).get("href", "")
            if n.get("headline") and link:
                news.append({"headline": n["headline"], "link": link})
    except Exception:
        pass

    summary = []
    ss = a.get("statsSummary") or {}
    for item in (ss.get("statistics") or []):
        summary.append({"label": item.get("displayName", item.get("name", "")),
                        "value": item.get("displayValue", "")})

    return {
        "player": {
            "id": a.get("id"),
            "name": name,
            "jersey": a.get("displayJersey") or (("#" + a["jersey"]) if a.get("jersey") else ""),
            "pos": (a.get("position") or {}).get("abbreviation", ""),
            "headshot": (a.get("headshot") or {}).get("href"),
            "age": a.get("age"),
            "dob": a.get("displayDOB", ""),
            "height": a.get("displayHeight", ""),
            "weight": a.get("displayWeight", ""),
            "college": (a.get("college") or {}).get("name", "") or (a.get("collegeAthlete") or {}).get("name", ""),
            "draft": a.get("displayDraft", ""),
            "experience": a.get("displayExperience", ""),
            "debutYear": a.get("debutYear"),
            "birthplace": birthplace,
            "aussie": _is_aussie(birthplace, name),
            "status": (a.get("status") or {}).get("name", ""),
            "team": {
                "abbr": team.get("abbreviation", ""),
                "displayName": team.get("displayName", ""),
                "color": team.get("color"),
                "logo": (team.get("logos") or [{}])[0].get("href")
                        or (f"https://a.espncdn.com/i/teamlogos/nfl/500/{team.get('abbreviation', '').lower()}.png"
                            if team.get("abbreviation") else None),
            },
        },
        "summary": summary,
        "categories": categories,
        "news": news,
        "source": "ESPN public API · cached 6 h",
    }


@app.get("/api/christmas")
def api_christmas():
    try:
        return json.loads((DATA / "christmas.json").read_text(encoding="utf-8"))
    except Exception:
        return {"teams": []}


@app.get("/api/shows")
def api_shows():
    try:
        return json.loads((DATA / "shows.json").read_text(encoding="utf-8"))
    except Exception:
        return {"shows": [], "runway": []}


# ---------- news feed (ListTrac pattern: Google News RSS, link-out only) ----------

NEWS_URL = "https://news.google.com/rss/search?q=NFL%20when:2d&hl=en-US&gl=US&ceid=US:en"
_news_cache: dict[str, tuple[float, list]] = {}


@app.get("/api/news")
def api_news():
    hit = _news_cache.get("news")
    if hit and time.time() - hit[0] < 900:  # 15-min cache
        return {"stories": hit[1]}
    import xml.etree.ElementTree as ET
    try:
        r = requests.get(NEWS_URL, timeout=15, headers={"User-Agent": _UAS[0]})
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception:
        return {"stories": hit[1] if hit else []}

    stories, seen = [], set()
    for it in root.findall(".//item"):
        title = it.findtext("title") or ""
        src_el = it.find("source")
        source = src_el.text if src_el is not None else ""
        # Google News titles end " - Source"; strip when the source tag repeats it
        if source and title.endswith(" - " + source):
            title = title[: -len(" - " + source)]
        title = title.rstrip(" -")
        key = title.lower()[:60]
        if not title or key in seen:
            continue
        seen.add(key)
        stories.append({
            "title": title,
            "link": it.findtext("link") or "",
            "source": source,
            "published": it.findtext("pubDate") or "",
        })
        if len(stories) >= 12:
            break
    _news_cache["news"] = (time.time(), stories)
    return {"stories": stories}


# ---------- partner dashboard (Measurement & Attribution, live) ----------
# Live taps land in memory per serverless instance — enough to demo the loop.
# Production path: swap _clicks for Upstash Redis REST (same pattern as ListTrac stars).

_clicks: dict[tuple, int] = {}

PARTNER_SAMPLE = {
    "period": "MCG Game Week · Sept 7–14 2026 (illustrative)",
    "kpis": {"reach": 412000, "taps": 18400, "landings": 15900, "signups": 2140},
    "storylines": [
        {"label": "SF vs LAR at the MCG — California to the G", "content": "SF@LAR", "taps": 7900},
        {"label": "NE @ SEA — Dickson in the Thursday window", "content": "NE@SEA", "taps": 2100},
        {"label": "DAL @ NYG — rivalry opener", "content": "DAL@NYG", "taps": 1900},
        {"label": "TB @ CIN — Burrow's first test", "content": "TB@CIN", "taps": 1650},
        {"label": "KC opener — the champs raise the banner", "content": "KC", "taps": 1500},
        {"label": "Rest of the slate", "content": "other", "taps": 3350},
    ],
    "surfaces": [
        {"key": "gotw", "label": "Game of the Week card", "taps": 5400},
        {"key": "rtg", "label": "Road to the G banner", "taps": 6200},
        {"key": "wtw", "label": "Slate cards", "taps": 6800},
    ],
    "trend": [
        {"week": "Jul 13", "taps": 2100}, {"week": "Jul 20", "taps": 3400},
        {"week": "Jul 27", "taps": 4200}, {"week": "Aug 3", "taps": 5100},
        {"week": "Aug 10", "taps": 6800}, {"week": "Aug 17", "taps": 9500},
        {"week": "Aug 24", "taps": 13200}, {"week": "Aug 31", "taps": 18400},
    ],
}


@app.post("/api/track")
async def track(req: Request):
    try:
        data = json.loads(await req.body())
        key = (str(data.get("medium", ""))[:24], str(data.get("campaign", ""))[:24],
               str(data.get("content", ""))[:24])
        _clicks[key] = _clicks.get(key, 0) + 1
        return {"ok": True}
    except Exception:
        return {"ok": False}


# ---------- audience capture: newsletter + mailbag ----------
# Prototype store (per-instance memory). Production path: Upstash / an ESP list.

_subscribers: list[dict] = []
_mailbag: list[dict] = []


@app.post("/api/subscribe")
async def subscribe(req: Request):
    try:
        data = json.loads(await req.body())
        email = str(data.get("email", "")).strip()[:120]
        if "@" not in email or "." not in email.split("@")[-1]:
            return {"ok": False, "error": "That doesn't look like an email address."}
        if not any(s["email"].lower() == email.lower() for s in _subscribers):
            _subscribers.append({"email": email, "ts": time.time()})
        return {"ok": True, "count": len(_subscribers)}
    except Exception:
        return {"ok": False, "error": "Couldn't save that — try again."}


@app.post("/api/mailbag")
async def mailbag(req: Request):
    try:
        data = json.loads(await req.body())
        q = str(data.get("question", "")).strip()[:600]
        name = str(data.get("name", "")).strip()[:60]
        email = str(data.get("email", "")).strip()[:120]
        if len(q) < 10:
            return {"ok": False, "error": "Give the Experts a bit more to work with."}
        _mailbag.append({"question": q, "name": name, "email": email, "ts": time.time()})
        return {"ok": True, "count": len(_mailbag)}
    except Exception:
        return {"ok": False, "error": "Couldn't send that — try again."}


@app.get("/api/audience-profile")
def audience_profile():
    """The public audience story (data/audience.json) — the top of every pitch deck."""
    try:
        return json.loads((DATA / "audience.json").read_text(encoding="utf-8"))
    except Exception:
        return {"channels": []}


@app.get("/api/capture-stats")
def capture_stats():
    """Demo visibility for the capture loop (counts + recent mailbag, no emails)."""
    return {
        "subscribers": len(_subscribers),
        "mailbag": [{"question": m["question"], "name": m["name"]} for m in _mailbag[-10:]],
        "note": "Per-instance prototype store — production wires an email platform + persistent DB.",
    }


@app.get("/api/partner")
def partner():
    live = [{"medium": k[0], "campaign": k[1], "content": k[2], "count": v}
            for k, v in sorted(_clicks.items(), key=lambda kv: -kv[1])]
    return {"sample": PARTNER_SAMPLE, "live": live,
            "note": "Sample figures are illustrative; live taps are real CTA clicks recorded by this prototype instance."}


@app.get("/api/debug")
def debug():
    """List what actually made it into the deployed bundle (Vercel gotcha-hunter)."""
    out = []
    for p in sorted(ROOT.rglob("*")):
        if p.is_file() and "__pycache__" not in str(p) and ".git" not in p.parts:
            out.append(str(p.relative_to(ROOT)))
    return {"root": str(ROOT), "files": out[:400]}


app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")
