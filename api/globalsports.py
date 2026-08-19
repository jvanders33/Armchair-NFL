"""The Global column — tour sports (tennis, F1, golf, UFC), cricket, LA 2028.

Tour sports don't have fixtures and ladders; they have EVENTS (a tournament,
a Grand Prix weekend, a card) made of COMPETITIONS (matches, sessions, fights,
a leaderboard) between ATHLETES who carry a country flag. ESPN's scoreboard
gives all four sports that same shape, so one normaliser feeds one hub.

Cricket is the exception: ESPN has no cross-competition cricket feed, but its
cricket ids are Cricinfo series ids, so a small editable list of current
competitions (data/cricket.json) is polled and merged.
"""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ESPN = "https://site.api.espn.com/apis/site/v2/sports"
ESPN_V2 = "https://site.web.api.espn.com/apis/v2/sports"
_UAS = ("curl/8.9.1", "python-requests/2.32")
_cache: dict[str, tuple[float, object]] = {}


def _get(url: str, params: dict | None = None, ttl: int = 600):
    key = url + "?" + json.dumps(params or {}, sort_keys=True)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    last = None
    for ua in _UAS:
        r = requests.get(url, params=params, timeout=20, headers={"User-Agent": ua})
        if r.status_code == 403:
            last = r
            continue
        r.raise_for_status()
        data = r.json()
        _cache[key] = (time.time(), data)
        return data
    last.raise_for_status()


# ---------------------------------------------------------------------------
# Tour sports
# ---------------------------------------------------------------------------
TOURS = {
    "tennis": {"name": "Tennis", "feeds": [("ATP", "tennis/atp"), ("WTA", "tennis/wta")], "unit": "match"},
    "f1": {"name": "Formula 1", "feeds": [("F1", "racing/f1")], "unit": "session"},
    "golf": {"name": "Golf", "feeds": [("PGA Tour", "golf/pga"), ("LPGA", "golf/lpga")], "unit": "leaderboard"},
    "ufc": {"name": "UFC", "feeds": [("UFC", "mma/ufc")], "unit": "fight"},
}
AUS = "Australia"


def _flag(a: dict) -> dict:
    f = a.get("flag") or {}
    return {"country": f.get("alt", ""), "href": f.get("href")}


def _athlete(x: dict) -> dict:
    a = x.get("athlete") or {}
    fl = _flag(a)
    recs = x.get("records") or []
    return {
        "id": a.get("id"), "name": a.get("displayName") or a.get("shortName", ""),
        "short": a.get("shortName", ""), "country": fl["country"], "flag": fl["href"],
        "aussie": fl["country"] == AUS,
        "headshot": (a.get("headshot") or {}).get("href") if isinstance(a.get("headshot"), dict) else a.get("headshot"),
        "seed": x.get("seed"), "winner": bool(x.get("winner")),
        "score": x.get("score"), "order": x.get("order"),
        "status": (x.get("status") or {}).get("displayValue") if isinstance(x.get("status"), dict) else None,
        "linescores": [l.get("value") for l in (x.get("linescores") or []) if l.get("value") is not None],
        "record": recs[0].get("summary") if recs else None,
        "team": ((x.get("team") or {}).get("displayName")) or ((a.get("team") or {}).get("displayName")) or None,
        "teamLogo": ((x.get("team") or {}).get("logo")) or ((x.get("team") or {}).get("logos") or [{}])[0].get("href"),
    }


def _comp(c: dict, unit: str) -> dict:
    st = (c.get("status") or {}).get("type") or {}
    ctype = c.get("type") or {}
    return {
        "id": c.get("id"),
        "label": (c.get("round") or {}).get("displayName") or ctype.get("text") or ctype.get("abbreviation") or "",
        "weight": ctype.get("abbreviation") if unit == "fight" else None,
        "date": c.get("date") or c.get("startDate"),
        "state": st.get("state", "pre"), "detail": st.get("shortDetail") or st.get("description", ""),
        "venue": (c.get("venue") or {}).get("fullName"),
        "note": ((c.get("notes") or [{}])[0].get("headline")) if c.get("notes") else None,
        "competitors": [_athlete(x) for x in c.get("competitors", [])],
    }


def _event(e: dict, feed_label: str, unit: str) -> dict:
    st = (e.get("status") or {}).get("type") or {}
    comps = []
    for g in e.get("groupings") or []:            # tennis: draws
        gname = (g.get("grouping") or {}).get("displayName", "")
        for c in g.get("competitions", []):
            d = _comp(c, unit)
            d["draw"] = gname
            comps.append(d)
    if not comps:
        comps = [_comp(c, unit) for c in e.get("competitions", [])]
    return {
        "id": e.get("id"), "feed": feed_label, "name": e.get("name", ""), "short": e.get("shortName", ""),
        "major": bool(e.get("major")),
        "date": e.get("date"), "endDate": e.get("endDate"),
        "venue": (e.get("venue") or {}).get("fullName") or (e.get("circuit") or {}).get("fullName") or "",
        "state": st.get("state", "pre"), "detail": st.get("shortDetail") or st.get("description", ""),
        "competitions": comps,
    }


def _tour_events(path: str, label: str, unit: str, window_days: int = 0) -> list[dict]:
    params = {}
    if window_days:
        today = datetime.now(timezone.utc)
        params["dates"] = f'{today.strftime("%Y%m%d")}-{(today + timedelta(days=window_days)).strftime("%Y%m%d")}'
    payload = _get(f"{ESPN}/{path}/scoreboard", params, ttl=600)
    return [_event(e, label, unit) for e in payload.get("events", [])]


def _f1_standings() -> dict:
    year = datetime.now().year
    try:
        d = _get(f"{ESPN_V2}/racing/f1/standings", {"season": str(year)}, ttl=1800)
    except requests.RequestException:
        return {}
    out = {}
    for ch in d.get("children", []):
        rows = []
        for e in (ch.get("standings") or {}).get("entries", []):
            st = {s["name"]: s.get("displayValue") for s in e.get("stats", [])}
            who = e.get("athlete") or e.get("team") or {}
            fl = _flag(who) if e.get("athlete") else {"country": "", "href": None}
            rows.append({"rank": int(st.get("rank") or 0), "name": who.get("displayName", ""),
                         "points": st.get("championshipPts", ""), "country": fl["country"], "flag": fl["href"],
                         "aussie": fl["country"] == AUS,
                         "logo": ((who.get("logos") or [{}])[0].get("href")) if e.get("team") else None})
        rows.sort(key=lambda r: r["rank"] or 99)
        out["drivers" if "Driver" in ch.get("name", "") else "constructors"] = rows
    return out


def tour(league: str) -> dict:
    """The hub payload for a tour sport: the events in play (current or next),
    the competitions inside them, standings where the sport has them, and
    every Australian in the field."""
    cfg = TOURS[league]
    ck = f"tour:{league}"
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    events = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for evs in ex.map(lambda f: _tour_events(f[1], f[0], cfg["unit"], 45 if league == "ufc" else 0), cfg["feeds"]):
            events.extend(evs)
    if league == "ufc":
        # ESPN's default UFC day is whatever's next (often a Contender Series
        # week) — surface the next real card first, keep the rest as the run-in
        events = [e for e in events if not e["name"].startswith("Dana White")] or events
        events.sort(key=lambda e: e["date"] or "")
    # Aussies across every competition in the events shown
    # one row per Australian, carrying their LATEST competition in the events shown
    by_name: dict[str, dict] = {}
    for e in events:
        for c in e["competitions"]:
            for a in c["competitors"]:
                if a["aussie"]:
                    prev = by_name.get(a["name"])
                    if not prev or (c["date"] or "") >= (prev.get("compDate") or ""):
                        by_name[a["name"]] = {**a, "event": e["short"] or e["name"], "eventId": e["id"], "compLabel": c["label"], "compDate": c["date"], "compState": c["state"]}
    aussies = list(by_name.values())
    payload = {"league": league, "name": cfg["name"], "unit": cfg["unit"], "events": events, "aussies": aussies}
    if league == "f1":
        payload["standings"] = _f1_standings()
    _cache[ck] = (time.time(), payload)
    return payload


# ---------------------------------------------------------------------------
# Cricket — ESPN cricket ids are Cricinfo series ids; poll the current list
# ---------------------------------------------------------------------------
def _cricket_cfg() -> dict:
    try:
        return json.loads((DATA / "cricket.json").read_text(encoding="utf-8"))
    except Exception:
        return {"competitions": []}


def cricket() -> dict:
    ck = "cricket"
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    cfg = _cricket_cfg()

    def load(comp):
        try:
            payload = _get(f"{ESPN}/cricket/{comp['id']}/scoreboard", ttl=600)
        except requests.RequestException:
            return []
        out = []
        for e in payload.get("events", []):
            c = (e.get("competitions") or [{}])[0]
            st = (e.get("status") or {}).get("type") or {}
            teams = []
            for x in c.get("competitors", []):
                t = x.get("team") or {}
                teams.append({"abbr": t.get("abbreviation", ""), "name": t.get("displayName") or t.get("name", ""),
                              "logo": t.get("logo") or ((t.get("logos") or [{}])[0].get("href")),
                              "score": x.get("score") or "", "home": x.get("homeAway") == "home", "winner": bool(x.get("winner")),
                              "innings": [l.get("value") for l in (x.get("linescores") or [])]})
            out.append({
                "id": e.get("id"), "competition": comp.get("name", ""), "compId": comp["id"], "kind": comp.get("kind", ""),
                "name": e.get("name", ""), "short": e.get("shortName", ""), "date": e.get("date"),
                "venue": (c.get("venue") or {}).get("fullName", ""),
                "state": st.get("state", "pre"), "detail": st.get("detail") or st.get("shortDetail") or st.get("description", ""),
                "note": ((c.get("notes") or [{}])[0].get("headline")) if c.get("notes") else None,
                "teams": teams,
                "australia": any("Australia" in (t["name"] or "") for t in teams),
            })
        return out

    with ThreadPoolExecutor(max_workers=8) as ex:
        matches = [m for chunk in ex.map(load, cfg.get("competitions", [])) for m in chunk]
    matches.sort(key=lambda m: (m["state"] != "in", m["date"] or ""))
    # BBL ladder when the season is on
    ladder = []
    try:
        d = _get("https://site.api.espn.com/apis/v2/sports/cricket/8044/standings", ttl=1800)
        entries = (d.get("standings") or {}).get("entries") or ((d.get("children") or [{}])[0].get("standings") or {}).get("entries") or []
        for e in entries:
            st = {s["name"]: s.get("displayValue") for s in e.get("stats", [])}
            t = e.get("team") or {}
            ladder.append({"rank": int(st.get("rank") or 0), "name": t.get("displayName") or t.get("name"), "abbr": t.get("abbreviation"),
                           "logo": ((t.get("logos") or [{}])[0].get("href")), "played": st.get("matchesPlayed"), "won": st.get("matchesWon"),
                           "lost": st.get("matchesLost"), "points": st.get("matchPoints"), "nrr": st.get("netRunRate")})
        ladder.sort(key=lambda r: r["rank"] or 99)
    except requests.RequestException:
        pass
    payload = {"matches": matches, "ladder": ladder, "season": cfg.get("season", {})}
    _cache[ck] = (time.time(), payload)
    return payload


# ---------------------------------------------------------------------------
# LA 2028 — editorial + countdown; no live feed until the schedule is set
# ---------------------------------------------------------------------------
def la2028() -> dict:
    try:
        return json.loads((DATA / "la2028.json").read_text(encoding="utf-8"))
    except Exception:
        return {"opening": "2028-07-14T00:00:00Z"}
