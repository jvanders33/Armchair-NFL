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
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles

try:
    from . import racing as rc          # package import (uvicorn api.app:app)
    from . import globalsports as gs
except ImportError:
    import racing as rc                 # Vercel runs api/index.py with api/ on sys.path
    import globalsports as gs

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = ROOT / "data"

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports"
ESPN_WEB_BASE = "https://site.web.api.espn.com/apis/common/v3/sports"

# Every league the platform serves. Adding one is a config entry, not a rebuild.
LEAGUES_CFG = {
    "nfl": {"path": "football/nfl", "name": "NFL", "tz": "America/New_York", "slots": "us"},
    "afl": {"path": "australian-football/afl", "name": "AFL", "tz": "Australia/Melbourne", "slots": "au"},
    "nbl": {"path": "basketball/nbl", "name": "NBL", "tz": "Australia/Melbourne", "slots": "au"},
    # ESPN files the NRL under league id 3; its home-and-away season is seasontype 1
    "nrl": {"path": "rugby-league/3", "name": "NRL", "tz": "Australia/Sydney", "slots": "au"},
    # NBA: nightly US games = Australian daytime, so slots are Sydney day-parts; ESPN carries odds
    "nba": {"path": "basketball/nba", "name": "NBA", "tz": "Australia/Sydney", "slots": "au"},
    # EPL: UK afternoons = Australian nights/early mornings; MLB: US nights = Australian mornings
    "epl": {"path": "soccer/eng.1", "name": "Premier League", "tz": "Australia/Sydney", "slots": "au"},
    "mlb": {"path": "baseball/mlb", "name": "MLB", "tz": "Australia/Sydney", "slots": "au"},
    # college football: FBS only (groups=80); Saturday windows in the US = Sunday mornings here
    "cfb": {"path": "football/college-football", "name": "College Football", "tz": "America/New_York", "slots": "us",
            "params": {"groups": "80", "limit": "300"}},
}


def _cfg(league: str) -> dict:
    c = LEAGUES_CFG.get((league or "nfl").lower())
    if not c:
        raise HTTPException(status_code=404, detail=f"Unknown league {league}")
    return c


def _site(league: str) -> str:
    return f"{ESPN_BASE}/{_cfg(league)['path']}"


ESPN_SITE = f"{ESPN_BASE}/football/nfl"          # NFL shortcuts kept for existing callers
ESPN_WEB = f"{ESPN_WEB_BASE}/football/nfl"
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


def _fetch_scoreboard(year: int | None, seasontype: int | None, week: int | None,
                     league: str = "nfl", date: str | None = None) -> dict:
    params = {}
    if date:
        params["dates"] = date.replace("-", "")   # a single day, YYYYMMDD — the nightly leagues (NBA, NBL)
    elif year:
        params["dates"] = str(year)  # ESPN takes the season year via `dates`, not `year`
    if seasontype:
        params["seasontype"] = str(seasontype)
    if week:
        params["week"] = str(week)
    params.update(_cfg(league).get("params") or {})
    return _get_json(f"{_site(league)}/scoreboard", params)


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

def _slot_au(dt_utc: datetime, tzname: str) -> str:
    """Australian codes play local nights and weekend afternoons — label those."""
    try:
        from zoneinfo import ZoneInfo
        lt = dt_utc.astimezone(ZoneInfo(tzname))
    except Exception:
        from datetime import timedelta
        lt = dt_utc + timedelta(hours=10)
    wd, hr = lt.weekday(), lt.hour
    day = lt.strftime("%A")
    if hr >= 18:
        return f"{day} night"
    if wd >= 5:
        return f"{day} afternoon" if hr >= 12 else f"{day} early"
    return f"{day} {'afternoon' if hr >= 12 else 'morning'}"


def _slot(dt_utc: datetime, seasontype: int, league: str = "nfl") -> str:
    lbl = _slot_nfl(dt_utc, seasontype)
    if league == "cfb":
        lbl = lbl.replace(" Football", "").replace("NFL Kickoff · ", "")
    return lbl


def _slot_nfl(dt_utc: datetime, seasontype: int) -> str:
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
    if wd in (1, 2) and hr >= 19:
        # a standalone midweek primetime game only happens for the season
        # opener (2026: Wed 9 Sep, Patriots at Seahawks — the Super Bowl LX
        # rematch, moved off Thursday for the MCG game)
        return "NFL Kickoff · " + et.strftime("%A") + " Night"
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
    "NFL Kickoff · Wednesday Night": 16, "NFL Kickoff · Tuesday Night": 16,
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
        score += 2   # a light tiebreak, not a thumb on the scale — the sport leads
    if in_australia:
        score += 20  # the MCG game is a genuine once-ever event, not a local-interest nudge
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


def _competitor(c: dict, league: str = "nfl") -> dict:
    t = c.get("team", {})
    abbr = t.get("abbreviation", "")
    recs = c.get("records") or []
    record = recs[0].get("summary", "") if recs else ""
    return {
        # NRL abbreviations collide (three NEW, two CAN) — link NRL clubs by ESPN id, show the abbr
        "abbr": t.get("id", abbr) if league in ("nrl", "epl", "cfb") else abbr,
        "code": abbr,
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
        if (payload.get("leagues") or [{}])[0].get("abbreviation") == "NRL":
            # ESPN's NRL calendar is two bare season entries with no rounds inside;
            # the scoreboard still answers seasontype+week, so build the stepper by hand
            return ([{"seasontype": 1, "week": w, "label": f"Round {w}", "start": None, "end": None} for w in range(1, 28)] +
                    [{"seasontype": 2, "week": w, "label": lbl, "start": None, "end": None}
                     for w, lbl in ((1, "Finals Week 1"), (2, "Semi Finals"), (3, "Preliminary Finals"), (4, "Grand Final"))])
        for cal in payload["leagues"][0]["calendar"]:
            # Week-based leagues (NFL, AFL) nest entries under a season type;
            # date-based ones (NBL) hand back a flat list of ISO strings — skip those,
            # the slate still renders, there's just no week stepper.
            if not isinstance(cal, dict):
                continue
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
def schedule(year: int | None = None, seasontype: int | None = None, week: int | None = None,
             league: str = "nfl", date: str | None = None):
    cfg = _cfg(league)
    try:
        payload = _fetch_scoreboard(year, seasontype, week, league, date)
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
        h, a = _competitor(home, league), _competitor(away, league)

        odds = (comp.get("odds") or [None])[0]
        hp = _home_win_prob(odds)
        spread = odds.get("spread") if odds else None
        ou = odds.get("overUnder") if odds else None
        details = odds.get("details") if odds else None

        try:
            dt = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(timezone.utc)
        except (KeyError, ValueError):
            continue
        slot = _slot(dt, st, league) if cfg["slots"] == "us" else _slot_au(dt, cfg["tz"])

        game_aussies = (aussie_by_team.get(h["abbr"], []) + aussie_by_team.get(a["abbr"], [])
                        if league == "nfl" else [])
        status = ev.get("status", {}).get("type", {})
        bc = (comp.get("broadcasts") or [{}])[0].get("names", [])
        venue = comp.get("venue", {})
        venue_name = venue.get("fullName", "")
        in_australia = "Melbourne" in venue_name or "Australia" in str(venue.get("address", {}))
        score = _watch_score(spread, ou, h["record"], a["record"], slot, bool(game_aussies), in_australia)

        games.append({
            "id": ev.get("id"),
            "faces": _game_faces(comp),
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
    experts = _load_experts() if league == "nfl" else {}
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
        "day": (payload.get("day") or {}).get("date") or date,   # ESPN omits day on dated queries
        "calendar": _calendar(payload),
        "gotw": gotw,
        "games": games,
        "experts": {
            "show": experts.get("show", {}),
            "gotw": experts_gotw_id,
            "episode": week_experts.get("episode"),
        },
        "league": league,
        "source": "ESPN public scoreboard API · cached 10 min",
    }


MCG_FACES = {
    "SF": {"name": "Brock Purdy", "headshot": "https://a.espncdn.com/i/headshots/nfl/players/full/4361741.png"},
    "LAR": {"name": "Matthew Stafford", "headshot": "https://a.espncdn.com/i/headshots/nfl/players/full/12483.png"},
}


def _game_faces(comp: dict) -> dict:
    """The face of each side: the game's statistical leader once games are live."""
    out = {}
    for c in comp.get("competitors", []):
        abbr = (c.get("team") or {}).get("abbreviation", "")
        for cat in (c.get("leaders") or []):
            for l in (cat.get("leaders") or []):
                a = l.get("athlete") or {}
                hs = (a.get("headshot") or {}) if isinstance(a.get("headshot"), dict) else {"href": a.get("headshot")}
                if a.get("shortName") and hs.get("href"):
                    out[abbr] = {"name": a["shortName"], "headshot": hs["href"]}
                    break
            if abbr in out:
                break
    return out


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
                faces = _game_faces(comp) or {
                    (away.get("team") or {}).get("abbreviation", ""): MCG_FACES.get((away.get("team") or {}).get("abbreviation", "")),
                    (home.get("team") or {}).get("abbreviation", ""): MCG_FACES.get((home.get("team") or {}).get("abbreviation", "")),
                } if away and home else {}
                faces = {k: v for k, v in faces.items() if v}
                game = {
                    "id": ev.get("id"),
                    "faces": faces,
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
def api_aussies(league: str = "nfl"):
    if league in ("nba", "mlb", "epl", "cfb"):
        try:
            return {"players": _roster_aussies(league)}
        except requests.RequestException:
            return {"players": []}
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

NBA_DIVISIONS = [
    ("Atlantic", ["BOS", "BKN", "NY", "PHI", "TOR"]),
    ("Central", ["CHI", "CLE", "DET", "IND", "MIL"]),
    ("Southeast", ["ATL", "CHA", "MIA", "ORL", "WSH"]),
    ("Northwest", ["DEN", "MIN", "OKC", "POR", "UTAH"]),
    ("Pacific", ["GS", "LAC", "LAL", "PHX", "SAC"]),
    ("Southwest", ["DAL", "HOU", "MEM", "NO", "SA"]),
]

MLB_DIVISIONS = [
    ("AL East", ["BAL", "BOS", "NYY", "TB", "TOR"]),
    ("AL Central", ["CHW", "CLE", "DET", "KC", "MIN"]),
    ("AL West", ["ATH", "HOU", "LAA", "SEA", "TEX"]),
    ("NL East", ["ATL", "MIA", "NYM", "PHI", "WSH"]),
    ("NL Central", ["CHC", "CIN", "MIL", "PIT", "STL"]),
    ("NL West", ["ARI", "COL", "LAD", "SD", "SF"]),
]
DIVISION_SETS = {"nfl": None, "nba": None, "mlb": None}   # filled below once DIVISIONS exists

AU_HINTS = ("Australia", ", NSW", ", VIC", ", QLD", ", WA", ", SA", ", TAS", ", ACT", ", NT")


def _load_aussies_for(league: str) -> list[dict]:
    """Curated supplement per league (data/aussies_{league}.json) — names ESPN
    lists without a birthplace, plus hooks. Missing file = no supplement."""
    if league == "nfl":
        return _load_aussies()
    try:
        return json.loads((DATA / f"aussies_{league}.json").read_text(encoding="utf-8")).get("players", [])
    except Exception:
        return []


def _load_aussies_nba() -> list[dict]:
    return _load_aussies_for("nba")


def _is_aussie(birthplace: dict | str | None, name: str = "", league: str = "nfl") -> bool:
    if isinstance(birthplace, dict):
        if (birthplace.get("country") or "") == "Australia":
            return True
    if isinstance(birthplace, str) and any(birthplace.endswith(h) or h.strip(", ") == birthplace for h in AU_HINTS):
        return True
    return any(p["name"] == name for p in _load_aussies_for(league))


_roster_aussies_cache: dict[str, tuple[float, list]] = {}


def _roster_aussies(league: str) -> list[dict]:
    """Every Australian on a roster in the league right now: birthplace scan of
    every roster (parallel, 6 h cache) plus the curated list for players ESPN
    lists without a birthplace. Self-updates through trades and cut-downs."""
    hit = _roster_aussies_cache.get(league)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    curated = {p["name"]: p for p in _load_aussies_for(league)}
    if league == "cfb":
        # 136 FBS rosters is too many for one call — scan the AP Top 25 (where the punters are)
        d = _get_json(f"{_site('cfb')}/rankings", ttl=1800)
        poll = next((r for r in d.get("rankings", []) if "AP" in r.get("name", "")), (d.get("rankings") or [{}])[0])
        teams = [{"team": r["team"]} for r in poll.get("ranks", []) if r.get("team")]
    else:
        teams = _get_json(f"{_site(league)}/teams", ttl=86400)["sports"][0]["leagues"][0]["teams"]
    by_id = league in ("nrl", "epl", "cfb")

    def scan(entry):
        t = entry["team"]
        try:
            roster = _get_json(f"{_site(league)}/teams/{t['id'] if by_id else t['abbreviation'].lower()}/roster", ttl=21600)
        except requests.HTTPError:
            return []
        out = []
        athletes = roster.get("athletes", [])
        if athletes and "items" in athletes[0]:                 # grouped rosters (NFL, MLB)
            athletes = [p for g in athletes for p in g.get("items", [])]
        for p in athletes:
            born_au = (p.get("birthPlace") or {}).get("country") == "Australia"
            cur = curated.get(p.get("fullName", ""))
            if born_au or cur:
                out.append({
                    "id": p.get("id"), "name": p.get("fullName", ""), "team": t["id"] if by_id else t["abbreviation"],
                    "teamCode": t.get("abbreviation", ""),
                    "pos": (p.get("position") or {}).get("abbreviation", ""),
                    "jersey": p.get("jersey", ""), "headshot": (p.get("headshot") or {}).get("href"),
                    "from": (cur or {}).get("from", (p.get("birthPlace") or {}).get("city", "")),
                    "hook": (cur or {}).get("hook", ""),
                    "bornAu": born_au,
                })
        return out
    with ThreadPoolExecutor(max_workers=10) as ex:
        players = [p for chunk in ex.map(scan, teams) for p in chunk]
    # curated order first (the names people know), then the rest alphabetically
    order = {n: i for i, n in enumerate(curated)}
    players.sort(key=lambda p: (order.get(p["name"], 999), p["name"]))
    if players:
        _roster_aussies_cache[league] = (time.time(), players)
    return players


def _nba_aussies() -> list[dict]:
    return _roster_aussies("nba")


CFB_CONF_ORDER = ["Southeastern Conference", "Big Ten Conference", "Big 12 Conference", "Atlantic Coast Conference",
                  "FBS Independents", "American Conference", "Mountain West Conference", "Sun Belt Conference",
                  "Mid-American Conference", "Conference USA", "Pac-12 Conference"]
CFB_CONF_SHORT = {"Southeastern Conference": "SEC", "Big Ten Conference": "Big Ten", "Big 12 Conference": "Big 12",
                  "Atlantic Coast Conference": "ACC", "American Conference": "American", "Mountain West Conference": "Mountain West",
                  "Sun Belt Conference": "Sun Belt", "Mid-American Conference": "MAC", "Conference USA": "Conference USA",
                  "Pac-12 Conference": "Pac-12", "FBS Independents": "Independents"}


def _cfb_teams() -> dict:
    """FBS teams grouped by conference — ESPN's standings tree carries the
    conference structure (the teams endpoint ignores its groups param).
    Clubs key by ESPN id: abbreviations collide (OSU is Ohio State AND
    Ohio State Newark)."""
    d = _get_json("https://site.api.espn.com/apis/v2/sports/football/college-football/standings", {"group": "80"}, ttl=86400)
    by_conf = {}
    for c in d.get("children", []):
        entries = (c.get("standings") or {}).get("entries") or []
        for sub in c.get("children") or []:                       # Sun Belt splits into divisions
            entries += (sub.get("standings") or {}).get("entries") or []
        teams = []
        for e in entries:
            t = e.get("team") or {}
            logos = t.get("logos") or []
            teams.append({"id": t.get("id"), "abbr": t.get("id"), "code": t.get("abbreviation", ""),
                          "location": t.get("location", ""), "name": t.get("name", "") or t.get("displayName", ""),
                          "displayName": t.get("displayName", ""), "color": t.get("color"), "altColor": t.get("alternateColor"),
                          "logo": logos[0]["href"] if logos else None})
        if teams:
            by_conf[c.get("name", "")] = sorted(teams, key=lambda t: t["displayName"])
    order = {n: i for i, n in enumerate(CFB_CONF_ORDER)}
    return {"divisions": [{"name": CFB_CONF_SHORT.get(n, n), "teams": by_conf[n]}
                          for n in sorted(by_conf, key=lambda n: order.get(n, 99))]}


@app.get("/api/teams")
def api_teams(league: str = "nfl"):
    if league == "cfb":
        return _cfb_teams()
    payload = _get_json(f"{_site(league)}/teams", ttl=86400)
    by_abbr = {}
    for entry in payload["sports"][0]["leagues"][0]["teams"]:
        t = entry["team"]
        logos = t.get("logos") or []
        by_abbr[t["id"] if league in ("nrl", "epl") else t["abbreviation"]] = {
            "id": t.get("id"),
            # NRL abbreviations collide (three NEW, two CAN); ESPN's soccer team-detail route
            # only answers to ids — both key clubs by ESPN id
            "abbr": t["id"] if league in ("nrl", "epl") else t["abbreviation"],
            "location": t.get("location", ""),
            "name": t.get("name", ""),
            "displayName": t.get("displayName", ""),
            "color": t.get("color"),
            "altColor": t.get("alternateColor"),
            "logo": logos[0]["href"] if logos else None,
        }
    if league in ("nfl", "nba", "mlb"):
        divs = {"nfl": DIVISIONS, "nba": NBA_DIVISIONS, "mlb": MLB_DIVISIONS}[league]
        return {"divisions": [
            {"name": name, "teams": [by_abbr[a] for a in abbrs if a in by_abbr]}
            for name, abbrs in divs
        ]}
    if league == "afl":
        # ESPN's AFL feed ships a phantom GCFC entry (Gold Coast's logo under
        # Sydney's name) and doesn't list Tasmania yet — drop one, add the other.
        by_abbr.pop("GCFC", None)
        by_abbr["TAS"] = {
            "abbr": "TAS", "location": "", "name": "Tasmania Devils",
            "displayName": "Tasmania Devils", "color": "0c2f2a", "altColor": "b41f2e",
            "logo": "/img/tas-devils.png", "coming": "Joining 2028",
        }
    if league == "nrl":
        by_abbr = {k: v for k, v in by_abbr.items() if v.get("id") not in ("289317", "289318")}
    # AFL, NBL and NRL run single ladders — one group, alphabetical
    return {"divisions": [{"name": _cfg(league)["name"] + " clubs",
                           "teams": sorted(by_abbr.values(), key=lambda t: t["displayName"])}]}


@app.get("/api/ladder")
def api_ladder(league: str = "afl"):
    if league == "nfl":
        raise HTTPException(status_code=400, detail="The NFL runs conference standings, not a ladder")
    if league == "cfb":
        d = _get_json(f"{_site('cfb')}/rankings", ttl=1800)
        poll = next((r for r in d.get("rankings", []) if "AP" in r.get("name", "")), (d.get("rankings") or [{}])[0])
        rows = []
        for r in poll.get("ranks", []):
            t = r.get("team") or {}
            rows.append({"rank": r.get("current"), "abbr": t.get("id"), "name": t.get("nickname") or t.get("name"),
                         "logo": ((t.get("logos") or [{}])[0].get("href")) or t.get("logo"),
                         "wins": (r.get("recordSummary") or "0-0").split("-")[0], "losses": (r.get("recordSummary") or "0-0").split("-")[-1],
                         "draws": "", "pct": r.get("firstPlaceVotes") or "", "points": r.get("points"), "form": "",
                         "trend": r.get("trend")})
        return {"ladder": rows, "lines": [{"after": 12, "kind": "top6", "label": "Playoff — twelve teams"}], "poll": poll.get("name", "AP Top 25")}
    cfg = _cfg(league)
    # standings live under /apis/v2, not /apis/site/v2 like the rest of the feed
    data = _get_json(f"https://site.api.espn.com/apis/v2/sports/{cfg['path']}/standings", ttl=900)
    entries = (data.get("standings") or {}).get("entries") or []
    groups = []
    if not entries and data.get("children"):
        if league in ("nba", "mlb"):
            groups = [(c.get("name", ""), (c.get("standings") or {}).get("entries") or []) for c in data["children"]]
            entries = [e for _, es in groups for e in es]
        else:
            entries = ((data["children"][0].get("standings") or {}).get("entries")) or []
    rows = []
    for e in entries:
        t = e.get("team") or {}
        st = {s.get("name"): s for s in e.get("stats", [])}
        val = lambda k: st.get(k, {}).get("value")
        disp = lambda k: st.get(k, {}).get("displayValue", "")
        rows.append({
            # AFL publishes rank; the NBL only a playoff seed
            "rank": int(val("rank") or val("playoffSeed") or 0),
            "abbr": t.get("id") if league in ("nrl", "epl") else t.get("abbreviation"),
            "name": t.get("shortDisplayName") or t.get("displayName"),
            "logo": (t.get("logos") or [{}])[0].get("href"),
            "wins": disp("wins") or disp("gamesWon"), "losses": disp("losses") or disp("gamesLost"),
            "draws": disp("ties") or disp("gamesDrawn"),
            "pct": disp("percentage") or (disp("pointsDifference") if league == "nrl" else
                                          disp("pointDifferential") if league == "epl" else disp("winPercent")),
            "points": disp("points"),
            "form": disp("form")[-5:],          # season-long string, latest game last
        })
    if league in ("nba", "mlb"):
        # NBA East/West: top six to the playoffs, 7-10 play-in. MLB AL/NL: top six to the postseason.
        by_abbr = {r["abbr"]: r for r in rows}
        out = []
        for name, es in groups:
            g = sorted((by_abbr[(e.get("team") or {}).get("abbreviation")] for e in es
                        if (e.get("team") or {}).get("abbreviation") in by_abbr), key=lambda r: r["rank"] or 99)
            out.append({"name": name.replace(" Conference", ""), "ladder": g})
        lines = ([{"after": 6, "kind": "top6", "label": "Playoffs — top six"},
                  {"after": 10, "kind": "wild", "label": "Play-in — 7th to 10th"}] if league == "nba" else
                 [{"after": 6, "kind": "top6", "label": "Postseason — top six"}])
        return {"ladder": rows, "groups": out, "lines": lines}
    rows.sort(key=lambda r: r["rank"] or 99)
    # 2026 finals: top six straight through, 7th-10th play a wildcard round
    lines = ([{"after": 6, "kind": "top6", "label": "Top six — week off, straight to finals"},
              {"after": 10, "kind": "wild", "label": "Wildcard — 7v10 & 8v9 for the last two spots"}]
             if league == "afl" else
             [{"after": 8, "kind": "top6", "label": "Finals — top eight"}] if league == "nrl" else
             [{"after": 4, "kind": "top6", "label": "Champions League"},
              {"after": 17, "kind": "wild", "label": "Relegation"}] if league == "epl" else
             [{"after": 6, "kind": "top6", "label": "Finals line"}])
    return {"ladder": rows, "lines": lines}


# ---------------------------------------------------------------------------
# AFL season leaders — the official Champion Data feed (api.afl.com.au).
# A short-lived MIS token unlocks it: POST /cfs/afl/WMCTok, then send the
# token as x-media-mis-token. Same mechanism the AFL's own site uses.
# ---------------------------------------------------------------------------
AFL_API = "https://api.afl.com.au"
_AFL_HDRS = {"Origin": "https://www.afl.com.au", "Referer": "https://www.afl.com.au/",
             "User-Agent": "Mozilla/5.0"}
_afl_tok = {"token": None, "ts": 0.0}
_leaders_cache = {"data": None, "ts": 0.0}
# the stats feed still calls Gold Coast GCFC; the rest of the site says SUNS
_AFL_ABBR_FIX = {"GCFC": "SUNS"}


def _afl_token() -> str:
    if _afl_tok["token"] and time.time() - _afl_tok["ts"] < 1800:
        return _afl_tok["token"]
    r = requests.post(f"{AFL_API}/cfs/afl/WMCTok", headers=_AFL_HDRS, timeout=15)
    r.raise_for_status()
    _afl_tok.update(token=r.json()["token"], ts=time.time())
    return _afl_tok["token"]


_afl_stats_cache = {"players": None, "ts": 0.0}


def _afl_players() -> list:
    """The full Champion Data season payload — every listed player's totals
    and averages, one request an hour."""
    if _afl_stats_cache["players"] and time.time() - _afl_stats_cache["ts"] < 3600:
        return _afl_stats_cache["players"]
    season = f"CD_S{datetime.now().year}014"          # AFL comp digits = 014
    r = requests.get(f"{AFL_API}/statspro/playersStats/seasons/{season}",
                     headers={**_AFL_HDRS, "x-media-mis-token": _afl_token()}, timeout=25)
    r.raise_for_status()
    players = r.json().get("players", [])
    if players:
        _afl_stats_cache.update(players=players, ts=time.time())
    return players


def _afl_abbr(p: dict) -> str:
    ab = (p.get("team") or {}).get("teamAbbr", "")
    return _AFL_ABBR_FIX.get(ab, ab)


def _afl_name(p: dict) -> str:
    d = p.get("playerDetails") or {}
    return f'{d.get("givenName", "")} {d.get("surname", "")}'.strip()


def _afl_pos(d: dict) -> str:
    # the feed says KEY_FORWARD / MEDIUM_DEFENDER — read as Key Forward
    return (d.get("position") or "").replace("_", " ").title()


@app.get("/api/leaders")
def api_leaders(league: str = "afl"):
    if league == "nbl":
        return _nbl_leaders_payload()
    if league != "afl":
        return {"categories": []}
    if _leaders_cache["data"] and time.time() - _leaders_cache["ts"] < 3600:
        return _leaders_cache["data"]
    players = _afl_players()
    cats = [("goals", "Goals"), ("disposals", "Disposals"), ("marks", "Marks"),
            ("tackles", "Tackles"), ("hitouts", "Hitouts")]
    out = []
    for key, label in cats:
        stat = lambda p: (p.get("totals") or {}).get(key) or 0
        top = sorted(players, key=stat, reverse=True)[:10]
        out.append({"key": key, "label": label, "leaders": [{
            "id": p.get("playerId"),
            "name": _afl_name(p),
            "club": _afl_abbr(p),
            "photo": (p.get("playerDetails") or {}).get("photoURL"),
            "value": int(stat(p)),
            "games": int(p.get("gamesPlayed") or 0),
            "avg": (p.get("averages") or {}).get(key),
        } for p in top if stat(p)]})
    data = {"categories": out}
    _leaders_cache.update(data=data, ts=time.time())
    return data


@app.get("/api/afl/list/{abbr}")
def api_afl_list(abbr: str):
    """A club's list with season numbers, from the official stats feed —
    ESPN publishes no AFL rosters, Champion Data has every listed player."""
    cd = {v: k for k, v in _AFL_ABBR_FIX.items()}.get(abbr.upper(), abbr.upper())
    avg = lambda p, k: (p.get("averages") or {}).get(k)
    rows = [{
        "id": p.get("playerId"),
        "name": _afl_name(p),
        "photo": (p.get("playerDetails") or {}).get("photoURL"),
        "pos": _afl_pos(p.get("playerDetails") or {}),
        "age": (p.get("playerDetails") or {}).get("age"),
        "jumper": (p.get("playerDetails") or {}).get("jumperNumber"),
        "games": int(p.get("gamesPlayed") or 0),
        "goals": int((p.get("totals") or {}).get("goals") or 0),
        "disp": avg(p, "disposals"), "marks": avg(p, "marks"), "tackles": avg(p, "tackles"),
        "rating": (p.get("totals") or {}).get("ratingPoints"),
    } for p in _afl_players() if _afl_abbr(p) == abbr.upper() or (p.get("team") or {}).get("teamAbbr") == cd]
    if not rows:
        raise HTTPException(status_code=404, detail=f"No list for {abbr}")
    rows.sort(key=lambda r: (-(r["games"]), -(r["disp"] or 0)))
    return {"players": rows}


# ---------- round-by-round: form guides from the per-round stats feed ----------
_afl_rounds_cache = {"rounds": None, "ts": 0.0}
_afl_round_stats: dict[str, tuple[float, list]] = {}
FORM_ROUNDS = 5


def _afl_rounds() -> list:
    """This season's round list (name/number/id) — finals rounds included."""
    if _afl_rounds_cache["rounds"] and time.time() - _afl_rounds_cache["ts"] < 6 * 3600:
        return _afl_rounds_cache["rounds"]
    r = requests.get(f"{AFL_API}/cfs/afl/seasons",
                     headers={**_AFL_HDRS, "x-media-mis-token": _afl_token()}, timeout=25)
    r.raise_for_status()
    body = r.json()
    seasons = body.get("seasons", body) if isinstance(body, dict) else body
    sid = f"CD_S{datetime.now().year}014"
    cur = next((s for s in seasons if s.get("id") == sid), None)
    rounds = sorted((cur or {}).get("rounds", []), key=lambda x: x.get("roundNumber", 0))
    if rounds:
        _afl_rounds_cache.update(rounds=rounds, ts=time.time())
    return rounds


def _afl_round_players(round_id: str) -> list:
    """Every player-game for one round. Rounds don't change once played, but the
    current round fills in over the weekend — 15 min is fine for both."""
    hit = _afl_round_stats.get(round_id)
    if hit and time.time() - hit[0] < 900:
        return hit[1]
    r = requests.get(f"{AFL_API}/statspro/playersStats/rounds/{round_id}",
                     headers={**_AFL_HDRS, "x-media-mis-token": _afl_token()}, timeout=25)
    r.raise_for_status()
    players = r.json().get("players", []) or []
    _afl_round_stats[round_id] = (time.time(), players)
    return players


def _played_rounds(n: int = FORM_ROUNDS) -> list:
    """The last n rounds with any player-games recorded, newest first.
    Unplayed rounds (finals, the current weekend before it starts) return
    empty — so fetch a window of candidates in parallel and keep the last n
    that have data. Cold call ≈ one round-trip, not seven."""
    rounds = _afl_rounds()
    # cheap heuristic for where "now" is: the newest round with a cached
    # payload, else the whole tail — finals + a buffer for byes
    window = rounds[-(n + 8):]
    _afl_token()                                    # warm the token once, off the threads
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(_afl_round_players, rd["roundId"]): rd for rd in window}
        played = set()
        for fut in as_completed(futs):
            try:
                if fut.result():
                    played.add(futs[fut]["roundId"])
            except requests.HTTPError:
                pass
    return [rd for rd in reversed(window) if rd["roundId"] in played][:n]


def _fmt1(v):
    return None if v is None else round(float(v), 1)


@app.get("/api/afl/form")
def api_afl_form():
    """Round-by-round form: for each of the last five played rounds, the best
    on ground by AFL rating, the goal leaders, and each club's result."""
    rounds = _played_rounds()
    if not rounds:
        return {"rounds": []}
    out = []
    for rd in rounds:
        pg = _afl_round_players(rd["roundId"])
        tot = lambda p, k: (p.get("totals") or {}).get(k) or 0
        best = sorted(pg, key=lambda p: tot(p, "ratingPoints"), reverse=True)[:5]
        goals = sorted(pg, key=lambda p: (tot(p, "goals"), tot(p, "ratingPoints")), reverse=True)[:5]
        disp = sorted(pg, key=lambda p: (tot(p, "disposals"), tot(p, "ratingPoints")), reverse=True)[:5]
        card = lambda p, k: {
            "id": p.get("playerId"), "name": _afl_name(p), "club": _afl_abbr(p),
            "photo": (p.get("playerDetails") or {}).get("photoURL"),
            "value": _fmt1(tot(p, k)) if k == "ratingPoints" else int(tot(p, k)),
            "line": f'{int(tot(p, "disposals"))} disp · {int(tot(p, "goals"))} gls · {int(tot(p, "marks"))} mks · {int(tot(p, "tackles"))} tkl',
            "result": p.get("result", ""),
            "opp": _AFL_ABBR_FIX.get((p.get("opponent") or {}).get("teamAbbr", ""), (p.get("opponent") or {}).get("teamAbbr", "")),
        }
        # one line per club: result + opponent
        clubs = {}
        for p in pg:
            ab = _afl_abbr(p)
            if ab and ab not in clubs:
                clubs[ab] = {"club": ab, "result": p.get("result", ""),
                             "opp": _AFL_ABBR_FIX.get((p.get("opponent") or {}).get("teamAbbr", ""), (p.get("opponent") or {}).get("teamAbbr", ""))}
        out.append({
            "roundId": rd["roundId"], "name": rd.get("name", ""), "number": rd.get("roundNumber"),
            "games": len(clubs) // 2,
            "best": [card(p, "ratingPoints") for p in best],
            "goals": [card(p, "goals") for p in goals if tot(p, "goals")],
            "disposals": [card(p, "disposals") for p in disp],
            "clubs": sorted(clubs.values(), key=lambda c: c["club"]),
        })
    return {"rounds": out}


@app.get("/api/afl/form/{abbr}")
def api_afl_club_form(abbr: str):
    """A club's last five rounds: result, opponent, and its best three by rating."""
    ab = abbr.upper()
    cd = {v: k for k, v in _AFL_ABBR_FIX.items()}.get(ab, ab)
    rounds = _played_rounds()
    out = []
    for rd in rounds:
        pg = [p for p in _afl_round_players(rd["roundId"])
              if _afl_abbr(p) == ab or (p.get("team") or {}).get("teamAbbr") == cd]
        if not pg:
            out.append({"name": rd.get("name", ""), "number": rd.get("roundNumber"), "bye": True})
            continue
        tot = lambda p, k: (p.get("totals") or {}).get(k) or 0
        best = sorted(pg, key=lambda p: tot(p, "ratingPoints"), reverse=True)[:3]
        goals = sorted(pg, key=lambda p: tot(p, "goals"), reverse=True)[:1]
        opp = (pg[0].get("opponent") or {}).get("teamAbbr", "")
        out.append({
            "name": rd.get("name", ""), "number": rd.get("roundNumber"),
            "result": pg[0].get("result", ""), "opp": _AFL_ABBR_FIX.get(opp, opp),
            "best": [{"id": p.get("playerId"), "name": _afl_name(p),
                      "photo": (p.get("playerDetails") or {}).get("photoURL"),
                      "rating": _fmt1(tot(p, "ratingPoints")),
                      "line": f'{int(tot(p, "disposals"))} disp · {int(tot(p, "goals"))} gls · {int(tot(p, "marks"))} mks · {int(tot(p, "tackles"))} tkl'}
                     for p in best],
            "topGoals": ({"name": _afl_name(goals[0]), "goals": int(tot(goals[0], "goals"))}
                         if goals and tot(goals[0], "goals") else None),
        })
    return {"club": ab, "rounds": out}


@app.get("/api/afl/player/{pid}/form")
def api_afl_player_form(pid: str):
    """A player's last five games — the game log the player page needs."""
    out = []
    for rd in _played_rounds():
        p = next((x for x in _afl_round_players(rd["roundId"]) if x.get("playerId") == pid), None)
        if not p:
            out.append({"name": rd.get("name", ""), "number": rd.get("roundNumber"), "dnp": True})
            continue
        t = p.get("totals") or {}
        opp = (p.get("opponent") or {}).get("teamAbbr", "")
        out.append({
            "name": rd.get("name", ""), "number": rd.get("roundNumber"),
            "result": p.get("result", ""), "opp": _AFL_ABBR_FIX.get(opp, opp),
            "disposals": int(t.get("disposals") or 0), "kicks": int(t.get("kicks") or 0),
            "handballs": int(t.get("handballs") or 0), "marks": int(t.get("marks") or 0),
            "tackles": int(t.get("tackles") or 0), "goals": int(t.get("goals") or 0),
            "behinds": int(t.get("behinds") or 0), "clearances": int(t.get("totalClearances") or 0),
            "hitouts": int(t.get("hitouts") or 0),
            "fantasy": int(t.get("dreamTeamPoints") or 0), "rating": _fmt1(t.get("ratingPoints")),
        })
    return {"games": out}


# ---------- finals: the bracket, straight from the AFL's match items ----------
# Rounds 25-29 = Wildcard · Qualifying/Elimination · Semis · Prelims · Grand
# Final. Each match is a PLACEHOLDER ("7th Vs 10th") until the AFL fixes it,
# then SCHEDULED → LIVE → CONCLUDED with scores. Before the ladder is final we
# project the placeholder seeds from the live ladder, clearly flagged.
FINALS_ROUNDS = ["25", "26", "27", "28", "29"]
FINALS_LABELS = {"25": "Wildcard", "26": "Qualifying & Elimination", "27": "Semi Finals",
                 "28": "Preliminary Finals", "29": "Grand Final"}
_SEED_RE = re.compile(r"^(\d+)(?:st|nd|rd|th)$", re.I)
_afl_matches_cache: dict[str, tuple[float, dict]] = {}


def _afl_match_items(round_id: str) -> dict:
    hit = _afl_matches_cache.get(round_id)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    r = requests.get(f"{AFL_API}/cfs/afl/matchItems/round/{round_id}",
                     headers={**_AFL_HDRS, "x-media-mis-token": _afl_token()}, timeout=25)
    r.raise_for_status()
    data = r.json()
    _afl_matches_cache[round_id] = (time.time(), data)
    return data


def _afl_logo_map() -> dict:
    """abbr → {name, logo} from ESPN's teams feed (24h cache via _get_json)."""
    try:
        payload = _get_json(f"{_site('afl')}/teams", ttl=86400)
        out = {}
        for entry in payload["sports"][0]["leagues"][0]["teams"]:
            t = entry["team"]
            logos = t.get("logos") or []
            out[t["abbreviation"]] = {"name": t.get("displayName", ""), "logo": logos[0]["href"] if logos else None}
        out.pop("GCFC", None)          # the phantom entry, see api_teams
        return out
    except Exception:
        return {}


@app.get("/api/afl/finals")
def api_afl_finals():
    year = datetime.now().year
    logos = _afl_logo_map()
    # live ladder for seed projection
    try:
        ladder = {r["rank"]: r for r in api_ladder("afl")["ladder"]}
    except Exception:
        ladder = {}

    def side(t: dict) -> dict:
        ab = _AFL_ABBR_FIX.get(t.get("abbr") or "", t.get("abbr") or "")
        raw = t.get("name") or ""
        if ab and ab != "TBD":
            info = logos.get(ab, {})
            return {"abbr": ab, "name": info.get("name") or raw, "logo": info.get("logo"), "seed": None, "projected": False}
        m = _SEED_RE.match(raw.strip())
        if m and ladder:
            seed = int(m.group(1))
            row = ladder.get(seed)
            if row:
                return {"abbr": row["abbr"], "name": row["name"], "logo": row["logo"], "seed": raw, "projected": True}
        return {"abbr": None, "name": raw, "logo": None, "seed": raw, "projected": False}

    def items_for(rn: str) -> list:
        try:
            return _afl_match_items(f"CD_R{year}014{rn}").get("items", [])
        except requests.HTTPError:
            return []
    _afl_token()                                    # warm once, off the threads
    with ThreadPoolExecutor(max_workers=5) as ex:
        fetched = dict(zip(FINALS_ROUNDS, ex.map(items_for, FINALS_ROUNDS)))
    rounds, any_fixed = [], False
    for rn in FINALS_ROUNDS:
        items = fetched.get(rn) or []
        matches = []
        for it in items:
            m = it.get("match") or {}
            sc = it.get("score") or {}
            hs = ((sc.get("homeTeamScore") or {}).get("matchScore") or {})
            as_ = ((sc.get("awayTeamScore") or {}).get("matchScore") or {})
            status = m.get("status", "PLACEHOLDER")
            home, away = side(m.get("homeTeam") or {}), side(m.get("awayTeam") or {})
            if rn != "29" and status != "PLACEHOLDER":
                any_fixed = True
            venue = (it.get("venue") or {}).get("name", "")
            matches.append({
                "id": m.get("matchId"), "label": m.get("name", ""), "status": status,
                "date": (m.get("utcStartTime") or "") + ("Z" if m.get("utcStartTime") else ""),
                "venue": "" if venue == "To Be Confirmed" else venue,
                "home": home, "away": away,
                "homeScore": hs.get("totalScore"), "awayScore": as_.get("totalScore"),
                "homeGB": f'{hs.get("goals")}.{hs.get("behinds")}' if hs.get("goals") is not None else None,
                "awayGB": f'{as_.get("goals")}.{as_.get("behinds")}' if as_.get("goals") is not None else None,
            })
        rounds.append({"round": int(rn), "name": FINALS_LABELS[rn], "matches": matches})
    return {"rounds": rounds, "live": any_fixed, "projected": not any_fixed}


# ---------------------------------------------------------------------------
# NBL — the league's own "Rosetta" stats API (prod.rosetta.nbl.com.au), the
# same feed nbl.com.au renders from. Plain GETs; the only gate is a
# nbl.com.au Origin header (no key). Season ids come from /nbl/seasons;
# leaders need filter[period]=0&sort=... or the API returns three rows.
# ---------------------------------------------------------------------------
NBL_API = "https://prod.rosetta.nbl.com.au/get"
_NBL_HDRS = {"User-Agent": "Mozilla/5.0", "Origin": "https://www.nbl.com.au",
             "Referer": "https://www.nbl.com.au/"}
_nbl_cache: dict[str, tuple[float, dict]] = {}


def _nbl_get(route: str, ttl: int = 900) -> dict:
    hit = _nbl_cache.get(route)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    r = requests.get(f"{NBL_API}/{route}", headers=_NBL_HDRS, timeout=25)
    r.raise_for_status()
    data = r.json()
    _nbl_cache[route] = (time.time(), data)
    return data


def _nbl_season() -> dict:
    """The season to show: the newest regular season with leader data (NBL27
    once tip-off happens, NBL26 until then). Returns {id, name, year, live}."""
    seasons = [s for s in _nbl_get("nbl/seasons", ttl=6 * 3600).get("data", [])
               if s.get("season_type") == "regular" and (s.get("name") or "").startswith("NBL")]
    seasons.sort(key=lambda s: int(s.get("year") or 0), reverse=True)
    for i, s in enumerate(seasons[:2]):
        # same query the site sends -- the API's Redis layer caches per query
        # shape and odd variants (limit=1, limit=200) come back poisoned/short
        rows = _nbl_leader_rows(s["id"])
        if rows:
            return {"id": s["id"], "name": s["name"], "year": s["year"], "live": i == 0}
    s = seasons[0]
    return {"id": s["id"], "name": s["name"], "year": s["year"], "live": False}


def _nbl_leader_rows(season_id: str) -> list:
    return _nbl_get(f"nbl/stats/leaders/for/season/id/{season_id}?limit=150&filter[period]=0&sort=-points",
                    ttl=3600).get("data", [])


def _nbl_pname(p: dict) -> str:
    return f'{p.get("first_name", "")} {p.get("last_name", "")}'.strip()


def _nbl_photo(p: dict):
    return p.get("image") or p.get("external_player_image")


NBL_LEADER_CATS = [("points_average", "Points"), ("rebounds_average", "Rebounds"),
                   ("assists_average", "Assists"), ("steals_average", "Steals"),
                   ("blocks_average", "Blocks"), ("three_points_made_average", "3PM")]


def _nbl_leaders_payload() -> dict:
    season = _nbl_season()
    rows = _nbl_leader_rows(season["id"])
    out = []
    for key, label in NBL_LEADER_CATS:
        # per-game leaders need a minimum sample — half the games of the busiest player
        maxg = max((r.get("games") or 0) for r in rows) if rows else 0
        eligible = [r for r in rows if (r.get("games") or 0) >= max(3, maxg // 2)]
        top = sorted(eligible, key=lambda r: r.get(key) or 0, reverse=True)[:10]
        out.append({"key": key, "label": label, "leaders": [{
            "id": (r.get("player") or {}).get("id"),
            "name": _nbl_pname(r.get("player") or {}),
            "club": NBL_ROSETTA_TO_ESPN.get((r.get("team") or {}).get("team_code", ""), (r.get("team") or {}).get("team_code", "")),
            "photo": _nbl_photo(r.get("player") or {}),
            "value": round(float(r.get(key) or 0), 1),
            "games": int(r.get("games") or 0),
            "avg": None,
        } for r in top if r.get(key)]})
    return {"season": season, "categories": out}


@app.get("/api/nbl/list/{abbr}")
def api_nbl_list(abbr: str):
    season = _nbl_season()
    ab = NBL_ESPN_TO_ROSETTA.get(abbr.upper(), abbr.upper())
    # roster route wants the Rosetta team uuid — read it off the standings/leaders
    teams = {}
    for r in _nbl_leader_rows(season["id"]):
        t = r.get("team") or {}
        if t.get("team_code"):
            teams[t["team_code"]] = t
    if ab not in teams:
        try:
            for row in _nbl_get(f"nbl/standings/{season['year']}/regular").get("data", []):
                t = row.get("team") or {}
                if t.get("team_code"):
                    teams.setdefault(t["team_code"], t)
        except requests.HTTPError:
            pass
    team = teams.get(ab)
    if not team:
        raise HTTPException(status_code=404, detail=f"Unknown club {abbr}")
    roster = _nbl_get(f"nbl/players/for/team/{team['id']}/in/season/{season['year']}", ttl=3600).get("data", [])
    stats = {(r.get("player") or {}).get("id"): r for r in _nbl_leader_rows(season["id"])}
    f1 = lambda v: round(float(v), 1) if v not in (None, "") else None
    players = []
    for entry in roster:
        p = entry.get("player") or {}
        s = stats.get(p.get("id")) or {}
        players.append({
            "id": p.get("id"), "name": _nbl_pname(p), "photo": _nbl_photo(p),
            "jersey": entry.get("jersey_number") or p.get("jersey_number"),
            "pos": entry.get("playing_position") or p.get("playing_position") or "",
            "games": int(s.get("games") or 0),
            "ppg": f1(s.get("points_average")), "rpg": f1(s.get("rebounds_average")),
            "apg": f1(s.get("assists_average")), "mpg": f1(s.get("minutes_average")),
            "fg": round(float(s["field_goals_percentage"]) * 100, 1) if s.get("field_goals_percentage") is not None else None,
        })
    players.sort(key=lambda r: (-(r["games"]), -(r["ppg"] or 0)))
    return {"season": season, "team": {"code": ab, "name": team.get("name"), "logo": team.get("team_logo_transparent") or team.get("team_logo"),
                                       "color": team.get("color_primary")}, "players": players}


_NBL_STAT_LINES = [
    ("points", "Points", "points_average"), ("rebounds", "Rebounds", "rebounds_average"),
    ("assists", "Assists", "assists_average"), ("steals", "Steals", "steals_average"),
    ("blocks", "Blocks", "blocks_average"), ("turnovers", "Turnovers", "turnovers_average"),
    ("minutes", "Minutes", "minutes_average"),
    ("field_goals_made", "Field goals made", "field_goals_made_average"),
    ("three_points_made", "3-pointers made", "three_points_made_average"),
    ("free_throws_made", "Free throws made", "free_throws_made_average"),
    ("efficiency", "Efficiency", "efficiency_average"), ("plus_minus", "Plus/minus", "plus_minus_average"),
]


@app.get("/api/nbl/player/{pid}")
def api_nbl_player(pid: str):
    career = _nbl_get(f"nbl/statistics/for/player/{pid}", ttl=3600).get("data", [])
    if not career:
        raise HTTPException(status_code=404, detail=f"Unknown player {pid}")
    career = [c for c in career if (c.get("season") or {}).get("season_type", "regular") == "regular"]
    career.sort(key=lambda c: int((c.get("season") or {}).get("year") or 0), reverse=True)
    latest = career[0]
    p = latest.get("player") or {}
    t = latest.get("team") or {}
    f1 = lambda v: round(float(v), 1) if v not in (None, "") else None
    pct = lambda v: round(float(v) * 100, 1) if v not in (None, "") else None
    seasons = [{
        "year": (c.get("season") or {}).get("year"),
        "label": (c.get("season") or {}).get("name") or f'{(c.get("season") or {}).get("year")}',
        "team": NBL_ROSETTA_TO_ESPN.get((c.get("team") or {}).get("team_code", ""), (c.get("team") or {}).get("team_code", "")),
        "games": int(c.get("games") or 0),
        "ppg": f1(c.get("points_average")), "rpg": f1(c.get("rebounds_average")), "apg": f1(c.get("assists_average")),
        "spg": f1(c.get("steals_average")), "bpg": f1(c.get("blocks_average")), "mpg": f1(c.get("minutes_average")),
        "fg": pct(c.get("field_goals_percentage")), "tp": pct(c.get("three_points_percentage")), "ft": pct(c.get("free_throws_percentage")),
    } for c in career]
    lines = [{"label": lbl, "total": int(latest.get(k) or 0), "avg": f1(latest.get(ak))}
             for k, lbl, ak in _NBL_STAT_LINES if latest.get(k) not in (None, 0)]
    return {"player": {
        "id": pid, "name": _nbl_pname(p), "photo": _nbl_photo(p),
        "jersey": p.get("jersey_number"), "pos": p.get("playing_position", ""),
        "club": NBL_ROSETTA_TO_ESPN.get(t.get("team_code", ""), t.get("team_code", "")), "clubName": t.get("name", ""), "color": t.get("color_primary"),
        "seasonLabel": (latest.get("season") or {}).get("name") or (latest.get("season") or {}).get("year"),
        "games": int(latest.get("games") or 0),
        "ppg": f1(latest.get("points_average")), "rpg": f1(latest.get("rebounds_average")),
        "apg": f1(latest.get("assists_average")), "fg": pct(latest.get("field_goals_percentage")),
    }, "stats": lines, "seasons": seasons}


# the player-page stat lines, in display order: (totals key, label, decimals)
_AFL_STAT_LINES = [
    ("disposals", "Disposals", 0), ("kicks", "Kicks", 0), ("handballs", "Handballs", 0),
    ("disposalEfficiency", "Disposal efficiency %", 1), ("metresGained", "Metres gained", 0),
    ("marks", "Marks", 0), ("contestedMarks", "Contested marks", 0), ("marksInside50", "Marks inside 50", 0),
    ("goals", "Goals", 0), ("behinds", "Behinds", 0), ("goalAssists", "Goal assists", 0),
    ("scoreInvolvements", "Score involvements", 0), ("inside50s", "Inside 50s", 0),
    ("tackles", "Tackles", 0), ("totalClearances", "Clearances", 0),
    ("contestedPossessions", "Contested possessions", 0), ("intercepts", "Intercepts", 0),
    ("rebound50s", "Rebound 50s", 0), ("hitouts", "Hitouts", 0),
    ("freesFor", "Frees for", 0), ("freesAgainst", "Frees against", 0),
    ("dreamTeamPoints", "Fantasy points", 0), ("ratingPoints", "AFL rating points", 1),
]


@app.get("/api/afl/player/{pid}")
def api_afl_player(pid: str):
    p = next((x for x in _afl_players() if x.get("playerId") == pid), None)
    if not p:
        raise HTTPException(status_code=404, detail=f"Unknown player {pid}")
    d = p.get("playerDetails") or {}
    tot, av = p.get("totals") or {}, p.get("averages") or {}
    draft = ""
    if d.get("draftPosition") and d.get("draftYear"):
        kind = {"nationalDraft": "national draft", "rookieDraft": "rookie draft",
                "preseasonDraft": "pre-season draft"}.get(d.get("draftType"), d.get("draftType") or "draft")
        draft = f'Pick {d["draftPosition"]} · {d["draftYear"]} {kind}'
    def fmt_n(v, dec):
        if v in (None, ""):
            return ""
        if not isinstance(v, (int, float)):
            return str(v)
        out = f"{v:,.{dec}f}"
        if dec:                       # trim only decimal zeros, never whole digits
            out = out.rstrip("0").rstrip(".")
        return out
    stats = [{"label": lbl, "total": fmt_n(tot.get(k), dec), "avg": fmt_n(av.get(k), 1)}
             for k, lbl, dec in _AFL_STAT_LINES if tot.get(k) not in (None, 0) or av.get(k)]
    return {"player": {
        "id": pid, "name": _afl_name(p),
        "photo": d.get("photoURL"),
        "club": _afl_abbr(p), "clubName": (p.get("team") or {}).get("teamName", ""),
        "pos": _afl_pos(d), "age": d.get("age"),
        "height": f'{d["heightCm"]} cm' if d.get("heightCm") else "",
        "jumper": d.get("jumperNumber"),
        "draft": draft, "debut": d.get("debutYear"),
        "from": d.get("recruitedFrom", ""), "state": d.get("stateOfOrigin", ""),
        "games": int(p.get("gamesPlayed") or 0),
        "goals": int(tot.get("goals") or 0),
        "dispAvg": av.get("disposals"), "marksAvg": av.get("marks"),
        "tacklesAvg": av.get("tackles"), "rating": tot.get("ratingPoints"),
    }, "stats": stats}


ROSTER_GROUP_LABELS = {
    "offense": "Offense", "defense": "Defense", "specialTeam": "Special teams",
    "injuredReserveOrOut": "Injured reserve / out", "suspended": "Suspended",
    "practiceSquad": "Practice squad",
}


# ESPN's NBL team-detail endpoint 400s for every club (its team LIST works),
# so NBL club pages are built from the league's own feed. ESPN codes and
# Rosetta codes differ for four clubs.
NBL_ESPN_TO_ROSETTA = {"HWK": "ILL", "PNX": "SEM", "NZL": "NZL", "BRI": "BRI"}
NBL_ROSETTA_TO_ESPN = {v: k for k, v in NBL_ESPN_TO_ROSETTA.items()}


def _nbl_team_page(abbr: str) -> dict:
    ab = abbr.upper()
    code = NBL_ESPN_TO_ROSETTA.get(ab, ab)
    season = _nbl_season()
    rows = _nbl_get(f"nbl/standings/{season['year']}/regular").get("data", [])
    row = next((r for r in rows if (r.get("team") or {}).get("team_code") == code), None)
    if not row:
        raise HTTPException(status_code=404, detail=f"Unknown team {abbr}")
    t = row["team"]
    won, lost, pos = row.get("won") or 0, row.get("lost") or 0, row.get("position")
    ordinal = lambda n: f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
    # ESPN logo where it has one (matches the rest of the site), else the NBL's
    espn_logo = (_get_json(f"{_site('nbl')}/teams", ttl=86400)["sports"][0]["leagues"][0]["teams"])
    logo = next(((e["team"].get("logos") or [{}])[0].get("href") for e in espn_logo if e["team"]["abbreviation"] == ab), None) \
        or t.get("team_logo_transparent") or t.get("team_logo")
    return {
        "team": {
            "abbr": ab, "displayName": t.get("name", ""), "location": "", "name": t.get("name", ""),
            "color": (t.get("color_primary") or "#222").lstrip("#"), "altColor": (t.get("color_secondary") or "").lstrip("#") or None,
            "logo": logo,
            "record": f"{won}–{lost}" + ("" if season["live"] else f" · {season['name']}"),
            "standing": f"{ordinal(pos)} in the NBL" if pos else "",
            "division": "", "nextEvent": None,
        },
        "groups": [],
        "source": "NBL official stats · cached 15 min",
    }


def _nrl_team_page(team_id: str) -> dict:
    lad = api_ladder("nrl")["ladder"]
    teams = {e["team"]["id"]: e["team"] for e in _get_json(f"{_site('nrl')}/teams", ttl=86400)["sports"][0]["leagues"][0]["teams"]}
    t = teams.get(team_id)
    if not t:
        raise HTTPException(status_code=404, detail=f"Unknown team {team_id}")
    row = next((r for r in lad if (r.get("logo") or "").endswith(f"/{team_id}.png")), None)
    logos = t.get("logos") or []
    ordinal = lambda n: f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
    return {
        "team": {"abbr": team_id, "displayName": t.get("displayName", ""), "location": t.get("location", ""), "name": t.get("name", ""),
                 "color": t.get("color"), "altColor": t.get("alternateColor"), "logo": logos[0]["href"] if logos else None,
                 "record": f'{row["wins"]}–{row["losses"]}' + (f'–{row["draws"]}' if row and row.get("draws") not in ("", "0", None) else "") if row else "",
                 "standing": f'{ordinal(row["rank"])} on the ladder · {row["points"]} pts' if row else "",
                 "division": "", "nextEvent": None},
        "groups": [],
        "source": "ESPN public API · cached 6 h",
    }


@app.get("/api/team/{abbr}")
def api_team(abbr: str, league: str = "nfl"):
    slug = abbr.lower()
    site = _site(league)
    if league == "nbl":
        return _nbl_team_page(abbr)
    if league == "nrl":
        return _nrl_team_page(abbr)
    try:
        detail = _get_json(f"{site}/teams/{slug}", ttl=21600)["team"]
    except requests.HTTPError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown team {abbr}") from exc
    try:
        # ESPN publishes rosters for the NFL but not (yet) for the AFL or NBL
        roster = _get_json(f"{site}/teams/{slug}/roster", ttl=21600)
    except requests.HTTPError:
        roster = {"athletes": []}

    logos = detail.get("logos") or []
    rec_items = (detail.get("record") or {}).get("items") or [{}]
    division = next((n for n, ab in {"nfl": DIVISIONS, "nba": NBA_DIVISIONS, "mlb": MLB_DIVISIONS}.get(league, [])
                     if detail.get("abbreviation") in ab), "")

    next_event = None
    ne = detail.get("nextEvent") or []
    if ne:
        next_event = {"name": ne[0].get("name", ""), "shortName": ne[0].get("shortName", ""),
                      "date": ne[0].get("date", "")}

    groups = []
    athletes = roster.get("athletes", [])
    if athletes and "items" not in athletes[0]:
        # flat roster (NBA): one group, sorted by position then jersey
        athletes = [{"position": "roster", "items": athletes}]
    for g in athletes:
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
                "aussie": _is_aussie(a.get("birthPlace"), a.get("fullName", ""), league) if league in ("nfl", "nba", "mlb", "epl") else False,
            })
        players.sort(key=lambda p: (p["pos"], int(p["jersey"]) if str(p["jersey"]).isdigit() else 999))
        groups.append({"key": g.get("position", ""),
                       "label": ROSTER_GROUP_LABELS.get(g.get("position", ""), g.get("position", "").title()),
                       "players": players})
    if league in ("nba", "epl") and groups:
        groups[0]["label"] = "The squad" if league == "epl" else "The roster"

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
def api_player(pid: str, league: str = "nfl"):
    web = f"{ESPN_WEB_BASE}/{_cfg(league)['path']}"
    try:
        bio = _get_json(f"{web}/athletes/{pid}", ttl=21600)
        stats = _get_json(f"{web}/athletes/{pid}/stats", ttl=21600)
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
        overview = _get_json(f"{web}/athletes/{pid}/overview", ttl=3600)
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


@app.get("/api/events")
def api_events():
    """The cross-code major-events calendar (data/events.json), upcoming first."""
    try:
        d = json.loads((DATA / "events.json").read_text(encoding="utf-8"))
    except Exception:
        return {"events": []}
    now = datetime.now(timezone.utc).isoformat()
    ev = sorted((e for e in d.get("events", []) if e.get("time")), key=lambda e: e["time"])
    return {"events": [e | {"past": e["time"] < now} for e in ev]}


@app.get("/api/christmas")
def api_christmas():
    try:
        return json.loads((DATA / "christmas.json").read_text(encoding="utf-8"))
    except Exception:
        return {"teams": []}


# ---------- news aggregation: the biggest stories, every outlet ----------
# One feed is a wire service; many feeds is an editor. Same principle as the
# AFL build's movement tracker — sweep everyone, rank what matters.

GNEWS = "https://news.google.com/rss/search?q={}&hl=en-AU&gl=AU&ceid=AU:en"

# Two tiers, same idea as the AFL build's movement tracker:
#   outlet — named publishers with clean feeds, and crucially with photography
#   sweep  — a Google News query that catches every masthead without a usable
#            feed (News Corp, Nine, Seven, club sites, the paywalled ones)
NEWS_FEEDS = {
    "nfl": [
        ("outlet", "The Athletic", "https://theathletic.com/nfl/?rss=1"),
        ("outlet", "CBS Sports", "https://www.cbssports.com/rss/headlines/nfl/"),
        ("outlet", "Pro Football Talk", "https://profootballtalk.nbcsports.com/feed/"),
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/nfl/rss"),
        ("outlet", "Yahoo Sports", "https://sports.yahoo.com/nfl/rss.xml"),
        ("outlet", "BBC Sport", "https://feeds.bbci.co.uk/sport/american-football/rss.xml"),
        ("sweep", "", GNEWS.format("NFL%20when:3d")),
    ],
    "afl": [
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/australian-rules-football/rss"),
        ("outlet", "The Age", "https://www.theage.com.au/rss/sport/afl.xml"),
        ("outlet", "Sydney Morning Herald", "https://www.smh.com.au/rss/sport/afl.xml"),
        ("outlet", "Zero Hanger", "https://zerohanger.com/feed/"),
        ("outlet", "The Roar", "https://www.theroar.com.au/afl/feed/"),
        ("sweep", "", GNEWS.format("AFL%20when:2d")),
    ],
    "nbl": [
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/basketball/rss"),
        ("sweep", "", GNEWS.format("NBL%20basketball%20Australia%20when:7d")),
    ],
    "cfb": [
        ("outlet", "The Athletic", "https://theathletic.com/college-football/?rss=1"),
        ("outlet", "CBS Sports", "https://www.cbssports.com/rss/headlines/college-football/"),
        ("sweep", "", GNEWS.format("%22college%20football%22%20when:2d")),
    ],
    "cricket": [
        ("outlet", "ESPNcricinfo", "https://www.espncricinfo.com/rss/content/story/feeds/0.xml"),
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/cricket/rss"),
        ("outlet", "Sydney Morning Herald", "https://www.smh.com.au/rss/sport/cricket.xml"),
        ("sweep", "", GNEWS.format("cricket%20Australia%20when:2d")),
    ],
    "tennis": [
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/tennis/rss"),
        ("outlet", "BBC Sport", "https://feeds.bbci.co.uk/sport/tennis/rss.xml"),
        ("sweep", "", GNEWS.format("tennis%20when:2d")),
    ],
    "f1": [
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/formulaone/rss"),
        ("outlet", "BBC Sport", "https://feeds.bbci.co.uk/sport/formula1/rss.xml"),
        ("outlet", "The Athletic", "https://theathletic.com/formula-1/?rss=1"),
        ("sweep", "", GNEWS.format("%22Formula%201%22%20OR%20F1%20Piastri%20when:2d")),
    ],
    "golf": [
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/golf/rss"),
        ("outlet", "BBC Sport", "https://feeds.bbci.co.uk/sport/golf/rss.xml"),
        ("outlet", "The Athletic", "https://theathletic.com/golf/?rss=1"),
        ("sweep", "", GNEWS.format("golf%20PGA%20when:2d")),
    ],
    "ufc": [
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/mma/rss"),
        ("sweep", "", GNEWS.format("UFC%20when:2d")),
    ],
    "la2028": [
        ("sweep", "", GNEWS.format("%22LA%202028%22%20OR%20%22LA28%22%20OR%20%222028%20Olympics%22%20when:7d")),
        ("sweep", "", GNEWS.format("Australian%20Olympic%20team%20when:7d")),
    ],
    "epl": [
        ("outlet", "The Guardian", "https://www.theguardian.com/football/premierleague/rss"),
        ("outlet", "BBC Sport", "https://feeds.bbci.co.uk/sport/football/rss.xml"),
        ("outlet", "The Athletic", "https://theathletic.com/football/?rss=1"),
        ("sweep", "", GNEWS.format("%22Premier%20League%22%20when:2d")),
    ],
    "mlb": [
        ("outlet", "The Athletic", "https://theathletic.com/mlb/?rss=1"),
        ("outlet", "CBS Sports", "https://www.cbssports.com/rss/headlines/mlb/"),
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/mlb/rss"),
        ("sweep", "", GNEWS.format("MLB%20baseball%20when:2d")),
    ],
    "nba": [
        ("outlet", "The Athletic", "https://theathletic.com/nba/?rss=1"),
        ("outlet", "CBS Sports", "https://www.cbssports.com/rss/headlines/nba/"),
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/nba/rss"),
        ("sweep", "", GNEWS.format("NBA%20when:2d")),
    ],
    "nrl": [
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/rugbyleague/rss"),
        ("outlet", "Sydney Morning Herald", "https://www.smh.com.au/rss/sport/nrl.xml"),
        ("outlet", "Zero Tackle", "https://www.zerotackle.com/feed/"),
        ("sweep", "", GNEWS.format("NRL%20when:2d")),
    ],
    "racing": [
        # racing.com's newsroom is pulled via its GraphQL (art on every story) — see rc.news()
        ("outlet", "Just Horse Racing", "https://www.justhorseracing.com.au/feed/"),
        ("outlet", "The Guardian", "https://www.theguardian.com/sport/horse-racing/rss"),
        ("sweep", "", GNEWS.format("horse%20racing%20Australia%20when:2d")),
        ("sweep", "", GNEWS.format("(Melbourne%20Cup%20OR%20Caulfield%20OR%20Randwick%20OR%20Everest%20OR%20jockey%20OR%20trainer)%20racing%20when:3d")),
    ],
}


NEWS_RELEVANCE = {
    # "NFL" turns up in music and business copy; insist on football context.
    "nfl": re.compile(
        r"\bNFL\b|football|quarterback|touchdown|Super Bowl|preseason|training camp|"
        r"\bQB\b|draft|roster|Chiefs|Eagles|49ers|Rams|Cowboys|Patriots|Packers|Ravens", re.I),
    "afl": re.compile(
        r"\bAFL\b|\bAFLW\b|footy|Brownlow|premiership|Magpies|Blues|Demons|Tigers|Cats|"
        r"Bombers|Hawks|Swans|Giants|Suns|Lions|Dockers|Eagles|Crows|Power|Saints|Bulldogs|"
        r"Kangaroos|marking|goal|final", re.I),
    "nbl": re.compile(
        r"\bNBL|Boomers|Opals|36ers|Taipans|Bullets|Breakers|JackJumpers|"
        r"Hawks|Kings|Melbourne United|Phoenix|Wildcats|Australian basketball", re.I),
    "cfb": re.compile(r"college football|\bCFB\b|NCAA|Heisman|Playoff|Buckeyes|Bulldogs|Longhorns|Crimson Tide|Ducks|Nittany|Fighting Irish|"
                      r"Sooners|Tigers|Wolverines|Trojans|Volunteers|Aggies|Hurricanes|Seminoles|Gators|Razorbacks|Cornhuskers|Badgers|SEC|Big Ten|Big 12|ACC|punter", re.I),
    "cricket": re.compile(r"cricket|Test|\bODI\b|T20|BBL|Big Bash|Ashes|Sheffield Shield|Cummins|Smith|Head|Starc|Lyon|Perry|Healy|Lanning|Cricinfo|wicket|innings|"
                          r"Australia|England|India|Pakistan|Sri Lanka|New Zealand|South Africa|West Indies|Bangladesh|Afghanistan|Gardner|Mooney|Boland|Khawaja|Carey|Marsh|Green|Labuschagne", re.I),
    "tennis": re.compile(r"tennis|\bATP\b|\bWTA\b|Grand Slam|Wimbledon|US Open|Roland|Australian Open|Cincinnati|de Minaur|Sinner|Alcaraz|Djokovic|Sabalenka|Swiatek|Gauff|Kyrgios|Popyrin|Kasatkina|Kokkinakis|Purcell|Ebden|Hijikata", re.I),
    "f1": re.compile(r"Formula|\bF1\b|Grand Prix|Piastri|Norris|Verstappen|Hamilton|Leclerc|Russell|Antonelli|McLaren|Ferrari|Red Bull|Mercedes|Aston Martin|Williams|Alpine|Haas|Sauber|Audi|Cadillac|Zandvoort|Monza|Melbourne|pole|podium|paddock", re.I),
    "golf": re.compile(r"golf|\bPGA\b|LPGA|LIV|Masters|Open Championship|Ryder|Presidents Cup|Scheffler|McIlroy|Cam Smith|Jason Day|Min Woo|Minjee|Hannah Green|Adam Scott|Grace Kim|Lucas Herbert|birdie|leaderboard|major", re.I),
    "ufc": re.compile(r"\bUFC\b|\bMMA\b|Octagon|Volkanovski|Whittaker|Della Maddalena|Tuivasa|Hooker|Dana White|title fight|Fight Night|knockout|submission|Topuria|Makhachev|Jones|Pereira|Adesanya|Strickland", re.I),
    "la2028": re.compile(r"Olympic|LA28|LA 2028|Los Angeles|Paralympic|Brisbane 2032|AOC|Dolphins|swimming|athletics|Games", re.I),
    "epl": re.compile(r"Premier League|\bEPL\b|Arsenal|Liverpool|Chelsea|Man(chester)? (City|United|Utd)|Tottenham|Spurs|Newcastle|"
                      r"Aston Villa|Everton|Brighton|Fulham|Brentford|Crystal Palace|West Ham|Wolves|Bournemouth|Nottingham Forest|"
                      r"Leeds|Sunderland|Burnley|Coventry|Hull|Ipswich|Socceroos|Guardiola|Slot|Arteta|Salah|Haaland|Saka|transfer", re.I),
    "mlb": re.compile(r"\bMLB\b|baseball|World Series|Yankees|Dodgers|Mets|Red Sox|Cubs|Braves|Phillies|Astros|Mariners|Padres|Giants|"
                      r"Cardinals|Brewers|Orioles|Blue Jays|Rays|Tigers|Guardians|Twins|Royals|Rangers|Angels|Athletics|Rockies|"
                      r"Diamondbacks|Marlins|Nationals|Reds|Pirates|White Sox|Ohtani|Judge|Bazzana|pennant|wild card", re.I),
    "nba": re.compile(r"\bNBA\b|\bWNBA\b|Lakers|Celtics|Warriors|Knicks|Thunder|Nuggets|Bucks|Cavaliers|Cavs|Heat|Suns|Mavericks|Mavs|"
                      r"Timberwolves|Pacers|76ers|Sixers|Rockets|Spurs|Clippers|Kings|Grizzlies|Pelicans|Hawks|Bulls|Pistons|Magic|Nets|"
                      r"Raptors|Wizards|Hornets|Jazz|Trail Blazers|Blazers|LeBron|Giddey|Boomers|Daniels|Curry|Wembanyama|Jokic|Doncic|"
                      r"Summer League|training camp|preseason|playoff|play-in|All-Star|draft|free agen|trade", re.I),
    "nrl": re.compile(
        r"\bNRL|rugby league|Origin|Broncos|Bulldogs|Cowboys|Dolphins|Dragons|Eels|Knights|Panthers|Rabbitohs|"
        r"Raiders|Roosters|Sea Eagles|Sharks|Storm|Titans|Warriors|Wests Tigers|Dally M|Kangaroos|Kiwis|footy", re.I),
    # "racing" alone catches F1/V8s/greyhounds — insist on the thoroughbred vocabulary
    "racing": re.compile(
        r"horse|jockey|trainer|stakes|Cup\b|Group ?[123]|Listed|Randwick|Flemington|Caulfield|Rosehill|"
        r"Moonee Valley|The Valley|Everest|Sandown|Doomben|Eagle Farm|Morphettville|Ascot|Belmont|"
        r"thoroughbred|filly|colt|gelding|mare|stayer|sprinter|barrier|punter|Guineas|Derby|Oaks|"
        r"Cox Plate|Golden Eagle|Magic Millions|hoop|saddle|stewards|track|form guide|TAB", re.I),
}


# outlets that pass the relevance regex but cover the wrong hemisphere
NEWS_BLOCK_SOURCES = {
    "racing": ("Racing Post", "ITVX", "ITV", "The Mirror", "Sporting Life", "At The Races", "Sky Sports Racing",
               "BBC", "Daily Mail", "The Sun", "Irish", "Telegraph", "Express"),
}

# daily tips/odds boilerplate isn't news
NEWS_BLOCK_HEADLINES = {
    "racing": re.compile(r"Tips and Best Bets|Best Bets\s*[–-]|Tips\s*[–-]\s*\w+$|^\d{1,2}/\d{1,2}/\d{4}", re.I),
}

_IMG_TAGS = ("content", "thumbnail", "enclosure", "image")
_IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)', re.I)
_TAG_RE = re.compile(r"<[^>]+>")


def _feed_image(item) -> str | None:
    """RSS puts art in half a dozen places depending on the publisher."""
    for t in item.iter():
        tag = t.tag.split("}")[-1]
        if tag in _IMG_TAGS:
            url = t.get("url") or t.get("href")
            if url and any(url.lower().split("?")[0].endswith(e) for e in (".jpg", ".jpeg", ".png", ".webp")):
                return url
            if url and ("image" in (t.get("type") or "") or tag == "thumbnail"):
                return url
    for field in ("description", "{http://purl.org/rss/1.0/modules/content/}encoded"):
        blob = item.findtext(field) or ""
        m = _IMG_RE.search(blob)
        if m:
            return m.group(1)
    return None


def _clean(text: str, limit: int = 200) -> str:
    return _TAG_RE.sub("", text or "").replace("&nbsp;", " ").strip()[:limit]


def _parse_feed(kind: str, source: str, url: str) -> list[dict]:
    try:
        r = requests.get(url, timeout=8, headers={"User-Agent": "Mozilla/5.0 (compatible; ArmchairExperts/1.0)"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception:
        return []
    out = []
    cap = 25 if kind == "sweep" else 12
    for it in root.findall(".//item")[:cap]:
        title = _clean(it.findtext("title") or "", 170)
        link = (it.findtext("link") or "").strip()
        if not title or not link:
            continue
        src = source
        if kind == "sweep":
            # Google News names the publisher in a <source> node and again as a
            # " - Publisher" suffix on the headline; keep the former, drop the latter.
            node = it.find("source")
            src = (node.text if node is not None else "") or "Google News"
            if src and title.endswith(" - " + src):
                title = title[: -len(" - " + src)].rstrip(" -")
        out.append({
            "headline": title,
            "description": "" if kind == "sweep" else _clean(it.findtext("description") or "", 180),
            "image": _feed_image(it),
            "link": link,
            "source": src,
            "published": it.findtext("pubDate") or "",
        })
    return out


def _pub_ts(s: str) -> float:
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(s.strip(), fmt).timestamp()
        except (ValueError, AttributeError):
            continue
    return 0.0


def _dedupe_key(headline: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", "", headline.lower()).split()
    return " ".join(w for w in words if len(w) > 3)[:60]


# ESPN news paths for the codes that aren't in LEAGUES_CFG (tour sports, cricket)
NEWS_PATHS = {"tennis": "tennis/atp", "f1": "racing/f1", "golf": "golf/pga", "ufc": "mma/ufc", "cricket": "cricket/8044"}


def _espn_api_stories(league: str) -> list[dict]:
    """ESPN's JSON feed — its RSS has no art, but this does."""
    path = NEWS_PATHS.get(league)
    if league == "la2028":
        return []
    try:
        payload = _get_json(f"{ESPN_BASE}/{path}/news" if path else f"{_site(league)}/news", {"limit": "24"}, ttl=900)
    except requests.RequestException:
        return []
    out = []
    for a in payload.get("articles", []):
        imgs = a.get("images") or []
        img = next((i.get("url") for i in imgs if i.get("url")), None)
        link = ((a.get("links") or {}).get("web") or {}).get("href", "")
        if not (a.get("headline") and link):
            continue
        out.append({
            "headline": a["headline"], "description": (a.get("description") or "")[:180],
            "image": img, "link": link, "source": "ESPN", "published": a.get("published", ""),
        })
    return out


def _aggregate_news(league: str) -> list[dict]:
    cache_key = f"news:{league}"
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < 900:
        return hit[1]

    stories = []
    feeds = NEWS_FEEDS.get(league, [])
    with ThreadPoolExecutor(max_workers=min(10, len(feeds) + 1)) as ex:
        futures = [ex.submit(_parse_feed, kind, name, url) for kind, name, url in feeds]
        futures.append(ex.submit(rc.news if league == "racing" else _espn_api_stories, *(() if league == "racing" else (league,))))
        for f in as_completed(futures, timeout=20):
            try:
                stories.extend(f.result() or [])
            except Exception:
                continue

    rel = NEWS_RELEVANCE.get(league)
    block = NEWS_BLOCK_SOURCES.get(league, ())
    seen, merged = {}, []
    for s in stories:
        if rel and not rel.search(s["headline"] + " " + s.get("description", "")):
            continue
        if any(b.lower() in (s.get("source") or "").lower() for b in block):
            continue
        hb = NEWS_BLOCK_HEADLINES.get(league)
        if hb and hb.search(s["headline"]):
            continue
        k = _dedupe_key(s["headline"])
        if not k:
            continue
        if k in seen:
            # same story from two outlets — keep whichever has art
            if not seen[k].get("image") and s.get("image"):
                seen[k]["image"] = s["image"]
            continue
        seen[k] = s
        merged.append(s)

    for s in merged:
        s["ts"] = _pub_ts(s.get("published", ""))
    # freshest first, but a story with art outranks a bare headline of similar age
    merged.sort(key=lambda s: (s["ts"] + (43200 if s.get("image") else 0)), reverse=True)
    _cache[cache_key] = (time.time(), merged)
    return merged


@app.get("/api/featured")
def featured(league: str = "nfl"):
    """The biggest stories across every outlet — hero carousel + image grid.

    Editorial pins ride at the front; after that it's freshness with a nudge
    for stories that brought art, so the page always has pictures.
    """
    if league != "racing" and league not in NEWS_PATHS and league != "la2028":
        _cfg(league)
    stories = []
    for pin in ((_load_experts().get("featured_pins") or []) if league == "nfl" else []):
        if pin.get("headline") and pin.get("image"):
            stories.append({"headline": pin["headline"], "description": pin.get("description", ""),
                            "image": pin["image"], "link": pin.get("link", ""),
                            "source": pin.get("source", "Armchair Experts"),
                            "published": "", "pinned": True})
    stories += _aggregate_news(league)

    withart = [s for s in stories if s.get("image")]
    noart = [s for s in stories if not s.get("image")]
    lead = withart[:5]                       # the carousel needs pictures
    grid = (withart[5:17] + noart)[:12]      # the grid takes art first, then the rest
    outlets = sorted({s["source"] for s in stories if s.get("source")})
    return {"stories": lead, "more": grid, "outlets": outlets[:12],
            "count": len(stories), "source": "aggregated"}


# ---------- video layer: Cam's YouTube channel, self-updating ----------
# Channel RSS needs no API key and carries id/title/thumb/description/views.
# Upload a video → it's on the site within 15 minutes. No CMS.

YT_CHANNEL = "UCvgkN-LsaA6TLIrQYq_REkg"  # Armchair Experts with Cam Luke and Adam Cooney
YT_NS = {"a": "http://www.w3.org/2005/Atom", "m": "http://search.yahoo.com/mrss/",
         "yt": "http://www.youtube.com/xml/schemas/2015"}

# Light keyword tagger so each league hub can show its own videos.
VIDEO_TAGS = [
    ("nfl", re.compile(r"NFL|MCG|California|Super Bowl|Patriots|Rams|49ers|Siposs|Hollins|Gurley|quarterback", re.I)),
    ("afl", re.compile(r"AFL|Demons|Cats|Blues|Magpies|Bombers|Hawks|Swans|Crows|Lions|Suns|Dockers|Eagles|Power|Saints|Bulldogs|Tigers|Giants|Kangaroos|Brownlow|Coleman|Norm Smith|Harley Reid|wildcard|ladder|finals|footy", re.I)),
    ("nba", re.compile(r"NBA|Giddey|Daniels|Boomers|LeBron|Lakers|Celtics|Warriors|Thunder", re.I)),
    ("epl", re.compile(r"Premier League|EPL|Arsenal|Liverpool|Chelsea|Man City|Man United|Tottenham|Socceroos", re.I)),
    ("cricket", re.compile(r"cricket|Ashes|BBL|Big Bash|Test match|Cummins|Starc|Head", re.I)),
    ("cfb", re.compile(r"college football|NCAA|Heisman|punter", re.I)),
    ("tennis", re.compile(r"tennis|Australian Open|Wimbledon|de Minaur|Kyrgios", re.I)),
    ("f1", re.compile(r"Formula 1|F1|Grand Prix|Piastri", re.I)),
    ("golf", re.compile(r"golf|Masters|PGA|Cam Smith|Min Woo", re.I)),
    ("ufc", re.compile(r"UFC|MMA|Volkanovski|Whittaker|Della Maddalena", re.I)),
    ("la2028", re.compile(r"Olympic|LA 2028|LA28|Brisbane 2032", re.I)),
    ("mlb", re.compile(r"MLB|baseball|World Series|Yankees|Dodgers|Bazzana", re.I)),
    ("nbl", re.compile(r"NBL|basketball|hoops", re.I)),
    ("nrl", re.compile(r"NRL|rugby league|Origin|Panthers|Storm|Broncos|Roosters|Rabbitohs|Sea Eagles|Bulldogs|Sharks|Raiders|Warriors|Dolphins|Cowboys|Titans|Knights|Eels|Dragons|Wests Tigers", re.I)),
    ("racing", re.compile(r"racing|Melbourne Cup|Cox Plate|Caulfield|Flemington|Randwick|Everest|jockey|trainer|Group 1|Stakes|Guineas|Derby|Oaks|punt|tips|Spring Carnival", re.I)),
]


def _tag_video(title: str, desc: str) -> str:
    # The title decides; the description only breaks ties — channel boilerplate
    # mentions the NFL series on every upload, which mis-tags AFL episodes.
    for tag, rx in VIDEO_TAGS:
        if rx.search(title):
            return tag
    for tag, rx in VIDEO_TAGS:
        if rx.search(desc):
            return tag
    return "general"


def _fetch_videos() -> list[dict]:
    hit = _cache.get("videos")
    if hit and time.time() - hit[0] < 900:
        return hit[1]
    try:
        r = requests.get(f"https://www.youtube.com/feeds/videos.xml?channel_id={YT_CHANNEL}",
                         timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception:
        return hit[1] if hit else []
    out = []
    for e in root.findall("a:entry", YT_NS):
        vid = e.findtext("yt:videoId", namespaces=YT_NS)
        title = e.findtext("a:title", namespaces=YT_NS) or ""
        if not vid or not title:
            continue
        g = e.find("m:group", YT_NS)
        desc = (g.findtext("m:description", namespaces=YT_NS) or "") if g is not None else ""
        stats = g.find("m:community/m:statistics", YT_NS) if g is not None else None
        series = "cali" if re.search(r"California to the MCG", title, re.I) else ""
        out.append({
            "id": vid,
            "title": title,
            "published": e.findtext("a:published", namespaces=YT_NS) or "",
            "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            "description": desc[:220],
            "views": int(stats.get("views")) if stats is not None and stats.get("views") else 0,
            "league": _tag_video(title, desc),
            "series": series,
            "url": f"https://www.youtube.com/watch?v={vid}",
        })
    _cache["videos"] = (time.time(), out)
    return out


@app.get("/api/videos")
def api_videos(league: str = ""):
    vids = _fetch_videos()
    if league:
        vids = [v for v in vids if v["league"] == league.lower()]
    return {"videos": vids, "channel": "Armchair Experts with Cam Luke and Adam Cooney"}


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


# ---------------------------------------------------------------------------
# RACING — see api/racing.py. Same shell as the ESPN codes, different feed.
# ---------------------------------------------------------------------------
@app.get("/api/racing/meetings")
def api_racing_meetings(date: str | None = None):
    try:
        return rc.meetings(date)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"racing feed: {exc}") from exc


@app.get("/api/racing/race/{meet}/{number}")
def api_racing_race(meet: str, number: int):
    try:
        return rc.race(meet, number)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown race")
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"racing feed: {exc}") from exc


@app.get("/api/racing/next")
def api_racing_next():
    try:
        return {"races": rc.next_to_jump()}
    except requests.RequestException:
        return {"races": []}


@app.get("/api/racing/premierships")
def api_racing_premierships(entity: str = "Jockey", state: str | None = None, meetType: str | None = None,
                            season: str | None = None, size: int = 20):
    return rc.premierships(entity, state or None, meetType or None, season, size)


@app.get("/api/racing/features")
def api_racing_features():
    out = rc.features()
    try:
        out["week"] = rc.week_black_type()
    except Exception:
        out["week"] = []
    return out


@app.get("/api/tour/{league}")
def api_tour(league: str):
    if league not in gs.TOURS:
        raise HTTPException(status_code=404, detail=f"Unknown tour {league}")
    try:
        return gs.tour(league)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"feed unavailable: {exc}") from exc


@app.get("/api/cricket")
def api_cricket():
    try:
        return gs.cricket()
    except requests.RequestException:
        return {"matches": [], "ladder": [], "season": {}}


@app.get("/api/la2028")
def api_la2028():
    return gs.la2028()


@app.get("/api/racing/weekend")
def api_racing_weekend():
    try:
        return rc.weekend_results()
    except requests.RequestException:
        return {"races": []}


@app.get("/api/racing/jockey/{pid}")
def api_racing_jockey(pid: str):
    try:
        return rc.jockey(pid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown jockey")


@app.get("/api/racing/trainer/{pid}")
def api_racing_trainer(pid: str):
    try:
        return rc.trainer(pid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown trainer")


@app.get("/api/racing/horse/{pid}")
def api_racing_horse(pid: str):
    try:
        return rc.horse(pid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown horse")


app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")
