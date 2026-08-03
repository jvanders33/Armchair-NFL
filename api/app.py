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
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = ROOT / "data"

ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
CACHE_TTL = 600  # seconds; the slate changes slowly, live scores are fine at 10 min for v1

app = FastAPI(title="Armchair Experts API")

_cache: dict[str, tuple[float, dict]] = {}


def _fetch_scoreboard(year: int | None, seasontype: int | None, week: int | None) -> dict:
    params = {}
    if year:
        params["dates"] = str(year)  # ESPN takes the season year via `dates`, not `year`
    if seasontype:
        params["seasontype"] = str(seasontype)
    if week:
        params["week"] = str(week)
    key = json.dumps(params, sort_keys=True)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    r = requests.get(ESPN_SCOREBOARD, params=params, timeout=15,
                     headers={"User-Agent": "Mozilla/5.0 (ArmchairExperts prototype)"})
    r.raise_for_status()
    data = r.json()
    _cache[key] = (time.time(), data)
    return data


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


def _watch_score(spread, over_under, home_rec, away_rec, slot, has_aussie) -> float:
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
    return round(score, 1)


def _tier(score: float) -> int:
    return 1 if score >= 62 else (2 if score >= 48 else 3)


# ---------- normalisation ----------

def _load_aussies() -> list[dict]:
    try:
        return json.loads((DATA / "aussies.json").read_text(encoding="utf-8"))["players"]
    except Exception:
        return []


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
        score = _watch_score(spread, ou, h["record"], a["record"], slot, bool(game_aussies))

        status = ev.get("status", {}).get("type", {})
        bc = (comp.get("broadcasts") or [{}])[0].get("names", [])
        venue = comp.get("venue", {})

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

    return {
        "season": {"year": season.get("year"), "type": st},
        "week": {"number": wk.get("number")},
        "calendar": _calendar(payload),
        "gotw": gotw,
        "games": games,
        "source": "ESPN public scoreboard API · odds by ESPN BET/DraftKings · cached 10 min",
    }


@app.get("/api/aussies")
def api_aussies():
    return {"players": _load_aussies()}


@app.get("/api/debug")
def debug():
    """List what actually made it into the deployed bundle (Vercel gotcha-hunter)."""
    out = []
    for p in sorted(ROOT.rglob("*")):
        if p.is_file() and "__pycache__" not in str(p) and ".git" not in p.parts:
            out.append(str(p.relative_to(ROOT)))
    return {"root": str(ROOT), "files": out[:400]}


app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")
