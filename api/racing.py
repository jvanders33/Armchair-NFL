"""Racing — the fourth code, on the same shell as the NFL/AFL/NBL.

Data: racing.com's own GraphQL layer (Champion Data racing feed behind
graphql.rmdprod.racing.com; editorial + premierships behind
graphql.api.racing.com). Plain GETs with the site's public client keys —
the same requests the racing.com form guide makes. National coverage:
every TAB meeting in every state, fields, odds, results, profiles.

Nothing here is Victoria-only except the "watch live" default (Racing.com
carries Victorian vision free); the feature-race spine is national.
"""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

DATA = Path(__file__).resolve().parent.parent / "data"

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
RC_FORM = "https://graphql.rmdprod.racing.com/"           # Champion Data racing feed
RC_FORM_KEY = "da2-6nsi4ztsynar3l3frgxf77q5fe"
RC_DXP = "https://graphql.api.racing.com/"                # editorial, premierships
RC_DXP_KEY = "da2-r5s52y73i5c7vi6vxflvfdufsa"
_HDR = {"User-Agent": _UA, "Origin": "https://www.racing.com", "Referer": "https://www.racing.com/"}
STATES = "VIC|NSW|QLD|SA|WA|ACT|NT|TAS"

_cache: dict[str, tuple[float, object]] = {}


def _gql(host: str, key: str, query: str, variables: dict | None = None, ttl: int = 300):
    ck = host + query + json.dumps(variables or {}, sort_keys=True)
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    params = {"query": query}
    if variables is not None:
        params["variables"] = json.dumps(variables)
    r = requests.get(host, params=params, headers={**_HDR, "x-api-key": key}, timeout=25)
    r.raise_for_status()
    body = r.json()
    if body.get("errors") and not body.get("data"):
        raise RuntimeError(body["errors"][0].get("message", "GraphQL error")[:200])
    data = body.get("data") or {}
    _cache[ck] = (time.time(), data)
    return data


def form(query, variables=None, ttl=300):
    return _gql(RC_FORM, RC_FORM_KEY, query, variables, ttl)


def dxp(query, variables=None, ttl=900):
    return _gql(RC_DXP, RC_DXP_KEY, query, variables, ttl)


# ---------- queries (trimmed to what the shell renders) ----------
Q_MEETINGS = """query M($states: String! $daysBack: Int! $daysForward: Int! $userDate: String!) {
  GetRaceMeetingsByStateNew(states: $states daysBack: $daysBack daysForward: $daysForward userDate: $userDate) {
    id venue date state isTrial isJumpOut meetUrl sortOrder } }"""

Q_RACES = """query R($meetCode: ID!) { getRacesForMeet(meetCode: $meetCode) {
  id raceNumber raceStatus distance time class group name
  meet { meetUrl trackCondition trackRating railPosition weather state }
  formRaceEntries { id raceEntryNumber horseName horseCountry barrierNumber weight scratched emergency
    horseCode jockeyName jockeyCode trainerName trainerCode silkUrl finish finishAbv margin startingPrice
    apprenticeCanClaim apprenticeAllowedClaim jockeyUrl trainerUrl horseUrl
    horse { lastFive stats { starts firsts seconds thirds } }
    odds { providerCode oddsWin oddsPlace oddsIsFavouriteWin } } } }"""

Q_MEETING = """query G($meetCode: ID!) { getMeeting(id: $meetCode) {
  id venue venueName venueAbbr state firstRaceTime isTab meetUrl trackCondition trackRating railPosition
  weatherText weatherAirTemp weatherRainChance date status } }"""

Q_NEXT = """query N($states: String!) { nextToJump: GetNextToJumpByState(states: $states) {
  id time group raceStatus raceNumber resultsString meet { id venue state meetUrl isTrial isJumpOut date } } }"""

Q_JOCKEY = """query J($id: ID!) { getJockeyProfile(id: $id) {
  id age ridingWeight fullName urlSegment careerWins group1Wins winPercent recentWinPercent placePercent
  currentWins prizeMoney } }"""

Q_TRAINER = """query T($id: ID!) { getTrainerProfile(id: $id) {
  id location fullName urlSegment careerWins group1Wins winPercent currentWins placePercent based prizeMoney
  recentWinPercent } }"""

Q_HORSE = """query H($horseId: ID!) { getHorseProfile(id: $horseId) {
  id name age sex owners damHorseName sireHorseName careerWinPercent careerPlacePercent careerPrizeMoney
  silkUrl group1Wins country lastFive lastStartsSummary colour foalDate rating currentGear horseStatus
  trainer { fullName id urlSegment: urlSegmentWithId }
  stats { firsts seconds thirds starts key } } }"""

_ENTRY_FIELDS = """id horseCode meetCode raceNumber raceStatus raceEntryNumber barrierNumber weight
  isTrial isJumpOut group finish finishAbv margin startingPrice commentShort silkUrl trackCondition
  venueName venueAbbr raceDate raceDistance totalPrizeMoney time
  race { id name distance runnersCount raceNumber meetCode time nameForm status meet { id venue meetUrl } }
  jockey { id name urlSegment: urlSegmentWithId } horse { id name urlSegment: urlSegmentWithId }
  trainer { id name urlSegment: urlSegmentWithId }"""

Q_HORSE_RUNS = "query HR($horseCode: ID!, $pageSize: Int) { GetRaceEntryItemByHorsePaged(horseCode: $horseCode limit: $pageSize) { %s } }" % _ENTRY_FIELDS
Q_JOCKEY_RIDES = "query JR($jockeyCode: ID!, $pageSize: Int) { GetRaceEntryItemByJockeyPaged(jockeyCode: $jockeyCode limit: $pageSize) { %s } }" % _ENTRY_FIELDS
Q_TRAINER_RUNS = "query TR($trainerCode: ID!, $pageSize: Int) { GetRaceEntryItemByTrainerPaged(trainerCode: $trainerCode limit: $pageSize) { %s } }" % _ENTRY_FIELDS

Q_NEWS = """query GetNewsList { getNewsList(sites: ["RDC"], limit: 30, ignoreSiteFilter: true) {
  id name short_title description article_type type image_url thumbnail published article_date page_url tags
  authors { name } } }"""


# ---------- helpers ----------
def _f(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _money(s: str | None) -> int:
    return int(re.sub(r"[^\d]", "", s or "0") or 0)


GROUP_RANK = {"Group 1": 4, "Group 2": 3, "Group 3": 2, "Listed": 1}
METRO = {"Flemington", "Caulfield", "Moonee Valley", "The Valley", "Sandown", "Randwick", "Rosehill", "Rosehill Gardens",
         "Royal Randwick", "Canterbury", "Warwick Farm", "Kensington", "Eagle Farm", "Doomben", "Morphettville",
         "Morphettville Parks", "Ascot", "Belmont", "Canberra", "Hobart", "Launceston", "Gold Coast", "Sunshine Coast"}


def _is_metro(venue: str) -> bool:
    v = (venue or "")
    return any(m.lower() in v.lower() for m in METRO)


def _watch_score(race: dict, venue: str, field: int, dt: datetime) -> float:
    """Same idea as the NFL model: what deserves the armchair.
    Black-type status leads, then metro venue, Saturday, field size, and a
    nudge for the feature-race hours."""
    score = 40.0
    score += {4: 42, 3: 30, 2: 22, 1: 14}.get(GROUP_RANK.get(race.get("group") or "", 0), 0)
    if _is_metro(venue):
        score += 12
    if dt.weekday() == 5:
        score += 6
    score += min(10, max(0, field - 8)) * 0.8
    cls = (race.get("class") or "").upper()
    if "MDN" in cls:
        score -= 6
    return round(score, 1)


def _tier(score: float) -> int:
    return 1 if score >= 82 else (2 if score >= 62 else 3)


def _iso(s: str | None) -> str:
    """Champion Data times come as '2026-08-17T04:00:00.000Z' or with 7-digit fractions."""
    if not s:
        return ""
    s = s.replace("Z", "")
    s = re.sub(r"\.\d+$", "", s)
    return s + "Z"


def _dt(s: str | None) -> datetime | None:
    try:
        return datetime.strptime(_iso(s), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _mel_today() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Australia/Melbourne")).strftime("%Y-%m-%d")
    except Exception:
        return (datetime.utcnow() + timedelta(hours=10)).strftime("%Y-%m-%d")


def _fin(v):
    """Finishing position, or None. The feed uses codes >= 100 for scratchings,
    late scratchings and non-finishers — those aren't placings."""
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if 0 < n < 100 else None


def _entry(e: dict) -> dict:
    h = e.get("horse") or {}
    st = (h.get("stats") or [{}])[0] or {}
    odds = e.get("odds") or []
    win = next((o for o in odds if o.get("oddsWin")), None)
    fav = any(o.get("oddsIsFavouriteWin") for o in odds)
    last5 = h.get("lastFive")
    if isinstance(last5, str):
        try:
            last5 = "".join(str(x) for x in json.loads(last5))
        except (ValueError, TypeError):
            last5 = last5.replace('"', "").replace("[", "").replace("]", "").replace(",", "")
    return {
        "no": e.get("raceEntryNumber"), "horse": e.get("horseName"), "horseId": e.get("horseCode"),
        "country": e.get("horseCountry") or "",
        "jockey": e.get("jockeyName") or "", "jockeyId": e.get("jockeyCode"),
        "trainer": e.get("trainerName") or "", "trainerId": e.get("trainerCode"),
        "barrier": e.get("barrierNumber"), "weight": e.get("weight"),
        "scratched": bool(e.get("scratched")), "emergency": bool(e.get("emergency")),
        "silk": e.get("silkUrl"), "last5": last5 or "",
        "record": f'{st.get("starts", "0")}: {st.get("firsts", "0")}-{st.get("seconds", "0")}-{st.get("thirds", "0")}' if st else "",
        "win": (win or {}).get("oddsWin"), "place": (win or {}).get("oddsPlace"), "fav": fav,
        "finish": _fin(e.get("finish")), "finishAbv": e.get("finishAbv") if _fin(e.get("finish")) else None,
        "margin": e.get("margin"), "sp": e.get("startingPrice"),
        "claim": e.get("apprenticeAllowedClaim") if e.get("apprenticeCanClaim") else None,
    }


def _race_summary(r: dict, venue: str) -> dict:
    entries = [e for e in (r.get("formRaceEntries") or []) if not e.get("scratched")]
    dt = _dt(r.get("time"))
    field = len(entries)
    score = _watch_score(r, venue, field, dt or datetime.now(timezone.utc))
    top = sorted(([e for e in entries if any(o.get("oddsWin") for o in (e.get("odds") or []))]),
                 key=lambda e: _f(re.sub(r"[^\d.]", "", next((o["oddsWin"] for o in e["odds"] if o.get("oddsWin")), "999")), 999))[:3]
    done = (r.get("raceStatus") or "").lower() in ("paying", "final", "closed", "interim", "resulted")
    placings = sorted([e for e in (r.get("formRaceEntries") or []) if _fin(e.get("finish")) and _fin(e["finish"]) <= 3],
                      key=lambda e: int(e["finish"]))
    return {
        "id": r.get("id"), "number": r.get("raceNumber"), "name": r.get("name"),
        "distance": r.get("distance"), "time": _iso(r.get("time")),
        "group": None if (r.get("group") in (None, "ungrouped")) else r.get("group"),
        "class": r.get("class"), "status": r.get("raceStatus"), "runners": field,
        "watch": {"score": score, "tier": _tier(score)},
        "favs": [{"horse": e.get("horseName"), "no": e.get("raceEntryNumber"), "silk": e.get("silkUrl"),
                  "win": next((o["oddsWin"] for o in e["odds"] if o.get("oddsWin")), None), "jockey": e.get("jockeyName")} for e in top],
        "placings": [{"finish": e.get("finish"), "horse": e.get("horseName"), "no": e.get("raceEntryNumber"),
                      "silk": e.get("silkUrl"), "jockey": e.get("jockeyName"), "sp": e.get("startingPrice"), "margin": e.get("margin")}
                     for e in placings] if done or placings else [],
        "done": done,
    }


# ---------- public API ----------
def meetings(date: str | None = None) -> dict:
    """Every non-trial meeting on a date, with its races summarised and a
    watchability rank — the racing slate. Cached 5 min (fields/odds move)."""
    date = date or _mel_today()
    ck = f"slate:{date}"
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    today = datetime.strptime(_mel_today(), "%Y-%m-%d")
    target = datetime.strptime(date, "%Y-%m-%d")
    delta = (target - today).days
    back, fwd = (abs(delta), 0) if delta < 0 else (0, delta)
    ms = form(Q_MEETINGS, {"states": STATES, "daysBack": back, "daysForward": fwd, "userDate": date}, ttl=600)
    ms = [m for m in (ms.get("GetRaceMeetingsByStateNew") or [])
          if (m.get("date") or "").startswith(date) and not m.get("isTrial") and not m.get("isJumpOut")]

    def load(m):
        try:
            rs = form(Q_RACES, {"meetCode": m["id"]}, ttl=300).get("getRacesForMeet") or []
        except Exception:
            rs = []
        rs.sort(key=lambda r: r.get("raceNumber") or 0)
        races = [_race_summary(r, m["venue"]) for r in rs]
        meta = (rs[0].get("meet") or {}) if rs else {}
        first = min((r["time"] for r in races if r["time"]), default="")
        feature = max(races, key=lambda r: r["watch"]["score"]) if races else None
        return {
            "id": m["id"], "venue": m["venue"], "state": m["state"], "date": date,
            "url": m.get("meetUrl"), "metro": _is_metro(m["venue"]),
            "track": meta.get("trackCondition"), "rating": meta.get("trackRating"), "rail": meta.get("railPosition"),
            "weather": meta.get("weather"),
            "first": first, "races": races, "raceCount": len(races),
            "feature": feature,
            "watch": feature["watch"] if feature else {"score": 0, "tier": 3},
            "groupRaces": sum(1 for r in races if r["group"]),
            "done": bool(races) and all(r["done"] for r in races),
        }

    with ThreadPoolExecutor(max_workers=8) as ex:
        out = list(ex.map(load, ms))
    out = [m for m in out if m["raceCount"]]
    out.sort(key=lambda m: (-m["watch"]["score"], not m["metro"], m["first"]))
    payload = {"date": date, "meetings": out, "count": len(out),
               "raceOfTheDay": max((r | {"venue": m["venue"], "meetId": m["id"], "state": m["state"]}
                                    for m in out for r in m["races"]), key=lambda r: r["watch"]["score"], default=None)}
    _cache[ck] = (time.time(), payload)
    return payload


def race(meet_code: str, number: int) -> dict:
    rs = form(Q_RACES, {"meetCode": meet_code}, ttl=120).get("getRacesForMeet") or []
    r = next((x for x in rs if x.get("raceNumber") == number), None)
    if not r:
        raise KeyError("race")
    try:
        meet = form(Q_MEETING, {"meetCode": meet_code}, ttl=600).get("getMeeting") or {}
    except Exception:
        meet = {}
    venue = meet.get("venue") or (r.get("meet") or {}).get("venue") or ""
    entries = [_entry(e) for e in (r.get("formRaceEntries") or [])]
    entries.sort(key=lambda e: (e["scratched"], e["no"] or 99))
    summ = _race_summary(r, venue)
    return {
        "race": summ | {"venue": venue, "meetId": meet_code, "state": meet.get("state") or (r.get("meet") or {}).get("state"),
                        "url": (r.get("meet") or {}).get("meetUrl")},
        "meeting": {"venue": venue, "state": meet.get("state"), "track": meet.get("trackCondition"), "rating": meet.get("trackRating"),
                    "rail": meet.get("railPosition"), "weather": meet.get("weatherText"), "temp": meet.get("weatherAirTemp"),
                    "url": meet.get("meetUrl")},
        "field": entries,
        "others": [{"number": x.get("raceNumber"), "name": x.get("name"), "time": _iso(x.get("time")), "status": x.get("raceStatus"),
                    "group": None if x.get("group") in (None, "ungrouped") else x.get("group")} for x in sorted(rs, key=lambda x: x.get("raceNumber") or 0)],
    }


def next_to_jump(limit: int = 8) -> list[dict]:
    d = form(Q_NEXT, {"states": STATES}, ttl=60)
    out = []
    for r in d.get("nextToJump") or []:
        m = r.get("meet") or {}
        if m.get("isTrial") or m.get("isJumpOut"):
            continue
        out.append({"meetId": m.get("id"), "venue": m.get("venue"), "state": m.get("state"), "number": r.get("raceNumber"),
                    "time": _iso(r.get("time")), "status": r.get("raceStatus"),
                    "group": None if r.get("group") in (None, "ungrouped") else r.get("group")})
    out.sort(key=lambda r: r["time"])
    return out[:limit]


def _prem_query(entity: str, state: str | None, meet_type: str | None, season: str, page: int, size: int) -> str:
    f = [f'entityType: "{entity}"', f'rdcmSeason: "{season}"', f"pageIndex: {page}", f"pageSize: {size}"]
    if state:
        f.append(f'australianState: "{state}"')
    if meet_type:
        f.append(f'meetType: "{meet_type}"')
    return ("query P { getMiniPremiershipStanding(filters: { %s }) { entityType ranks { entityCode entityName rank starts wins prizeMoney urlSegmentWithId } } }"
            % " ".join(f))


def _season_code() -> str:
    """Racing seasons run Aug 1 – Jul 31 and are named by the closing year: 2026/27 = "2027"."""
    now = datetime.utcnow() + timedelta(hours=10)
    return str(now.year + 1 if now.month >= 8 else now.year)


def premierships(entity: str = "Jockey", state: str | None = None, meet_type: str | None = None,
                 season: str | None = None, size: int = 20) -> dict:
    season = season or _season_code()
    ranks: list = []
    # a null field on any row fails the whole page — page in tens and skip a bad page
    for page in range(0, max(1, (size + 9) // 10)):
        try:
            d = dxp(_prem_query(entity, state, meet_type, season, page, 10), ttl=1800)
            ranks += (d.get("getMiniPremiershipStanding") or {}).get("ranks") or []
        except Exception:
            continue
    rows = [{"rank": r.get("rank"), "id": r.get("entityCode"), "name": r.get("entityName"), "starts": r.get("starts"),
             "wins": r.get("wins"), "prize": r.get("prizeMoney"), "prizeN": _money(r.get("prizeMoney")),
             "slug": r.get("urlSegmentWithId")} for r in ranks if r]
    rows.sort(key=lambda r: r["rank"] or 999)
    lbl = f"{int(season) - 1}/{str(season)[-2:]}"
    return {"entity": entity, "state": state or "AUS", "meetType": meet_type or "All", "season": season, "label": lbl,
            "rows": rows[:size]}


def news() -> list[dict]:
    """racing.com's own newsroom — every story carries art."""
    try:
        d = dxp(Q_NEWS, ttl=900)
    except Exception:
        return []
    out = []
    for a in d.get("getNewsList") or []:
        url = a.get("page_url") or ""
        if url and not url.startswith("http"):
            url = "https://www.racing.com" + url
        if not (a.get("name") and url):
            continue
        out.append({"headline": a.get("short_title") or a["name"], "description": (a.get("description") or "")[:180],
                    "image": a.get("image_url") or a.get("thumbnail"), "link": url, "source": "Racing.com",
                    "published": a.get("published") or a.get("article_date") or ""})
    return out


def _runs(rows: list) -> list[dict]:
    out = []
    for e in rows or []:
        rc = e.get("race") or {}
        out.append({
            "date": (e.get("raceDate") or rc.get("time") or "")[:10], "time": _iso(rc.get("time") or e.get("time")),
            "venue": e.get("venueName") or (rc.get("meet") or {}).get("venue"), "meetId": e.get("meetCode"),
            "number": e.get("raceNumber"), "race": rc.get("name"), "distance": e.get("raceDistance") or rc.get("distance"),
            "group": None if e.get("group") in (None, "ungrouped") else e.get("group"),
            "finish": _fin(e.get("finish")), "finishAbv": e.get("finishAbv") if _fin(e.get("finish")) else None,
            "margin": e.get("margin"), "sp": e.get("startingPrice"),
            "runners": rc.get("runnersCount"), "barrier": e.get("barrierNumber"), "weight": e.get("weight"),
            "track": e.get("trackCondition"), "prize": e.get("totalPrizeMoney"),
            "horse": (e.get("horse") or {}).get("name"), "horseId": (e.get("horse") or {}).get("id"),
            "jockey": (e.get("jockey") or {}).get("name"), "jockeyId": (e.get("jockey") or {}).get("id"),
            "trainer": (e.get("trainer") or {}).get("name"), "trainerId": (e.get("trainer") or {}).get("id"),
            "silk": e.get("silkUrl"), "comment": e.get("commentShort"), "status": e.get("raceStatus"),
            "trial": bool(e.get("isTrial") or e.get("isJumpOut")),
        })
    out.sort(key=lambda r: r["time"] or r["date"], reverse=True)
    return out


def jockey(pid: str) -> dict:
    p = form(Q_JOCKEY, {"id": pid}, ttl=3600).get("getJockeyProfile") or {}
    if not p:
        raise KeyError("jockey")
    try:
        rides = _runs(form(Q_JOCKEY_RIDES, {"jockeyCode": pid, "pageSize": 30}, ttl=600).get("GetRaceEntryItemByJockeyPaged"))
    except Exception:
        rides = []
    return {"profile": {"id": p.get("id"), "name": p.get("fullName"), "age": p.get("age"), "weight": p.get("ridingWeight"),
                        "careerWins": p.get("careerWins"), "g1": p.get("group1Wins"), "winPct": p.get("winPercent"),
                        "placePct": p.get("placePercent"), "recentWinPct": p.get("recentWinPercent"),
                        "seasonWins": p.get("currentWins"), "prize": p.get("prizeMoney"), "slug": p.get("urlSegment"),
                        "url": f'https://www.racing.com/jockeys/{p.get("urlSegment")}' if p.get("urlSegment") else None},
            "rides": rides}


def trainer(pid: str) -> dict:
    p = form(Q_TRAINER, {"id": pid}, ttl=3600).get("getTrainerProfile") or {}
    if not p:
        raise KeyError("trainer")
    try:
        runs = _runs(form(Q_TRAINER_RUNS, {"trainerCode": pid, "pageSize": 30}, ttl=600).get("GetRaceEntryItemByTrainerPaged"))
    except Exception:
        runs = []
    return {"profile": {"id": p.get("id"), "name": p.get("fullName"), "based": p.get("based") or p.get("location"),
                        "careerWins": p.get("careerWins"), "g1": p.get("group1Wins"), "winPct": p.get("winPercent"),
                        "placePct": p.get("placePercent"), "recentWinPct": p.get("recentWinPercent"),
                        "seasonWins": p.get("currentWins"), "prize": p.get("prizeMoney"), "slug": p.get("urlSegment"),
                        "url": f'https://www.racing.com/trainers/{p.get("urlSegment")}' if p.get("urlSegment") else None},
            "runs": runs}


def horse(pid: str) -> dict:
    p = form(Q_HORSE, {"horseId": pid}, ttl=3600).get("getHorseProfile") or {}
    if not p:
        raise KeyError("horse")
    try:
        runs = _runs(form(Q_HORSE_RUNS, {"horseCode": pid, "pageSize": 30}, ttl=600).get("GetRaceEntryItemByHorsePaged"))
    except Exception:
        runs = []
    st = {s.get("key"): s for s in (p.get("stats") or []) if s.get("key")}
    career = (p.get("stats") or [{}])[0] if p.get("stats") else {}
    tr = p.get("trainer") or {}
    return {"profile": {"id": p.get("id"), "name": p.get("name"), "age": p.get("age"), "sex": p.get("sex"), "colour": p.get("colour"),
                        "country": p.get("country"), "sire": p.get("sireHorseName"), "dam": p.get("damHorseName"),
                        "owners": p.get("owners"), "silk": p.get("silkUrl"), "g1": p.get("group1Wins"),
                        "winPct": p.get("careerWinPercent"), "placePct": p.get("careerPlacePercent"),
                        "prize": p.get("careerPrizeMoney"), "rating": p.get("rating"), "gear": p.get("currentGear"),
                        "status": p.get("horseStatus"), "last5": p.get("lastFive"), "summary": p.get("lastStartsSummary"),
                        "record": f'{career.get("starts", "0")}: {career.get("firsts", "0")}-{career.get("seconds", "0")}-{career.get("thirds", "0")}' if career else "",
                        "trainer": tr.get("fullName"), "trainerId": tr.get("id"),
                        "url": f'https://www.racing.com/horses/{pid}'},
            "stats": [{"key": k, **{x: v.get(x) for x in ("starts", "firsts", "seconds", "thirds")}} for k, v in st.items()],
            "runs": runs}


def features() -> dict:
    """The curated feature-race spine (data/racing.json) with the next major
    flagged for the countdown card, plus this week's black-type races from
    the live feed."""
    try:
        spine = json.loads((DATA / "racing.json").read_text(encoding="utf-8"))
    except Exception:
        spine = {"majors": []}
    now = datetime.now(timezone.utc)
    majors = []
    for m in spine.get("majors", []):
        dt = _dt(m.get("time"))
        majors.append(m | {"past": bool(dt and dt < now)})
    nxt = next((m for m in majors if not m["past"]), None)
    hero = next((m for m in majors if m.get("hero") and not m["past"]), None) or nxt
    return {"majors": majors, "next": nxt, "hero": hero, "season": spine.get("season", ""), "note": spine.get("note", "")}


def week_black_type(days: int = 7) -> list[dict]:
    """Group and Listed races in the next `days` days, nationally."""
    ms = form(Q_MEETINGS, {"states": STATES, "daysBack": 0, "daysForward": days, "userDate": _mel_today()}, ttl=1800)
    ms = [m for m in (ms.get("GetRaceMeetingsByStateNew") or []) if not m.get("isTrial") and not m.get("isJumpOut")]
    # black type lives at metro tracks — skip the bush to keep this cheap
    ms = [m for m in ms if _is_metro(m["venue"])]

    def load(m):
        try:
            rs = form(Q_RACES, {"meetCode": m["id"]}, ttl=1800).get("getRacesForMeet") or []
        except Exception:
            return []
        return [{"meetId": m["id"], "venue": m["venue"], "state": m["state"], "date": (m.get("date") or "")[:10],
                 "number": r.get("raceNumber"), "name": r.get("name"), "distance": r.get("distance"),
                 "time": _iso(r.get("time")), "group": r.get("group"), "status": r.get("raceStatus"),
                 "runners": len([e for e in (r.get("formRaceEntries") or []) if not e.get("scratched")])}
                for r in rs if r.get("group") and r.get("group") != "ungrouped"]
    with ThreadPoolExecutor(max_workers=8) as ex:
        out = [x for chunk in ex.map(load, ms) for x in chunk]
    out.sort(key=lambda r: (-GROUP_RANK.get(r["group"], 0), r["time"]))
    return out
