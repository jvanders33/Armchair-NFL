"""The podcast — the emotional centre of the site.

Episodes come from the show's real RSS (Omny/iHeart; the feed Apple Podcasts
lists) and are matched to the YouTube uploads (channel RSS) so every episode
carries audio AND video where both exist. Nothing here is sample data: if the
feed is unreachable, callers get the last good copy or an empty list, and the
UI says so.
"""
import html
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import requests

FEED_URL = ("https://www.omnycontent.com/d/playlist/fa326977-3de5-4283-9b8b-af3500c58607/"
            "79013d11-dac9-4dbf-a99b-b432000d168d/6ec95aea-3b38-4770-9254-b432000d16a4/podcast.rss")
APPLE_ID = "1883991744"
YT_CHANNEL = "UCvgkN-LsaA6TLIrQYq_REkg"
NS = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
      "content": "http://purl.org/rss/1.0/modules/content/",
      "yt": "http://www.youtube.com/xml/schemas/2015", "media": "http://search.yahoo.com/mrss/",
      "atom": "http://www.w3.org/2005/Atom"}

# Where to follow — real links only. Add Spotify / socials when Cam confirms the handles.
PLATFORMS = [
    {"key": "youtube", "label": "YouTube", "url": f"https://www.youtube.com/channel/{YT_CHANNEL}?sub_confirmation=1", "verb": "Subscribe"},
    {"key": "apple", "label": "Apple Podcasts", "url": f"https://podcasts.apple.com/au/podcast/id{APPLE_ID}", "verb": "Follow"},
    {"key": "iheart", "label": "iHeart", "url": "https://www.iheart.com/podcast/1300-armchair-experts-with-cam-330865149/", "verb": "Follow"},
    {"key": "rss", "label": "RSS", "url": FEED_URL, "verb": "Feed"},
]

_cache: dict[str, tuple[float, object]] = {}


def _get(url: str, ttl: int = 900) -> str:
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0 (ArmchairExperts site)"})
    r.raise_for_status()
    _cache[url] = (time.time(), r.text)
    return r.text


def _slug(s: str) -> str:
    s = re.sub(r"[’'‘]", "", s.lower())
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80] or "episode"


def _words(s: str) -> set:
    return {w for w in re.sub(r"[^a-z0-9 ]", " ", s.lower()).split() if len(w) > 2 and w not in
            ("the", "and", "with", "for", "armchair", "experts", "cam", "luke", "adam", "cooney", "episode", "podcast")}


def _strip_html(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", s or "")).replace("\xa0", " ").strip()


def _topics(desc_html: str) -> list[str]:
    """Omny descriptions are chapter bullets — pull them as topics."""
    items = re.findall(r"<li[^>]*>(.*?)</li>", desc_html or "", flags=re.S | re.I)
    out = [_strip_html(i) for i in items]
    return [t for t in out if t][:14]


def _summary(desc_html: str) -> str:
    """Readable summary: the prose outside the chapter list if there is any,
    else the first topics joined — never the bullets mashed into one line."""
    prose = _strip_html(re.sub(r"<ul[^>]*>.*?</ul>|<ol[^>]*>.*?</ol>", " ", desc_html or "", flags=re.S | re.I))
    prose = re.sub(r"See\s+omnystudio\.com/listener\s+for privacy information\.?", "", prose, flags=re.I).strip()
    if len(prose) >= 40:
        return prose[:600]
    tops = _topics(desc_html)
    if tops:
        return "In this episode: " + " · ".join(tops[:6]) + ("…" if len(tops) > 6 else "")
    return _strip_html(desc_html)[:600]


def _show_key(title: str) -> str:
    t = title.lower()
    if "cali" in t and "g" in t or "california" in t or "mcg" in t:
        return "cali"
    if re.search(r"\bnfl\b|super bowl|gurley|patriots|rams|49ers|quarterback", t):
        return "nfl"
    if re.search(r"\bnbl\b|basketball", t):
        return "nbl"
    if re.search(r"racing|cup|caulfield|flemington|jockey|stakes", t):
        return "racing"
    return "afl"


ROLE_WORDS = {"NE", "Patriots", "WR", "QB", "RB", "TE", "GM", "NFL", "Au", "NZ", "Minister", "Sport", "Major", "Events",
              "Coach", "Captain", "Star", "Legend", "Rams", "49ers", "Former", "Ex", "The"}


def _guest(title: str, show_key: str) -> dict | None:
    """Guest from an interview-style title, e.g. "'Cali to the G' - NE Patriots WR
    Mack Hollins" → Mack Hollins. Series prefix stripped, role suffix after a
    second dash dropped, then the last Firstname Lastname pair. Only for the
    interview series; the AFL show titles are topics, not guests."""
    if show_key != "cali":
        return None
    t = re.sub(r"^\s*['‘’\"]?\s*cali\s+to\s+the\s+g\s*['‘’\"]?\s*[-–:]?\s*", "", title, flags=re.I).strip()
    seg = re.split(r"\s+[-–]\s+", t)[0]
    words = [w for w in re.findall(r"[A-Z][A-Za-z'’-]+", seg)]
    cand = [w for w in words if w not in ROLE_WORDS]
    if len(cand) < 2:
        return None
    name = f"{cand[-2]} {cand[-1]}"
    role = seg.replace(name, "").strip(" -,") or (re.split(r"\s+[-–]\s+", t)[1] if len(re.split(r"\s+[-–]\s+", t)) > 1 else "")
    return {"name": name, "slug": _slug(name), "role": role}


HOSTS = [
    {"slug": "cam-luke", "name": "Cam Luke", "role": "Host", "bio": "Seven years fronting Armchair Experts on Channel Seven; now the voice of the independent brand across AFL, NFL, NBL and racing. On radio daily."},
    {"slug": "adam-cooney", "name": "Adam Cooney", "role": "Co-host, The AFL Show", "bio": "2008 Brownlow medallist and Western Bulldogs great — the second chair on The AFL Show."},
]

SHOW_META = {
    "afl": {"slug": "the-afl-show", "title": "The AFL Show", "sport": "AFL", "hosts": "Cam Luke & Adam Cooney",
            "cadence": "Weekly, in season", "desc": "Sharp AFL analysis with a Brownlow medallist in the second chair — the show that built the audience.",
            "hub": "#/afl"},
    "cali": {"slug": "cali-to-the-g", "title": "Cali to the 'G", "sport": "NFL", "hosts": "Cam Luke",
             "cadence": "Series · daily re-release Sep 1–10", "desc": "The story of the NFL's arrival in Australia — players, decision-makers and legends, building to the MCG.",
             "hub": "#/nfl"},
    "nfl": {"slug": "the-nfl-weekly", "title": "The NFL Weekly", "sport": "NFL", "hosts": "Cam Luke + co-host to be announced",
            "cadence": "Weekly from Week 1 · September", "desc": "Game-by-game through the season — what mattered, what's next, and what to watch in Australian time.",
            "hub": "#/nfl"},
    "nbl": {"slug": "the-nbl-show", "title": "The NBL Show", "sport": "NBL", "hosts": "Cam Luke + rotating guests",
            "cadence": "Weekly from tip-off", "desc": "The NBL, every week of the season.", "hub": "#/nbl"},
    "racing": {"slug": "the-racing-slate", "title": "The Racing Slate", "sport": "Racing", "hosts": "Cam Luke",
               "cadence": "Spring carnival", "desc": "The spring, race by race.", "hub": "#/racing"},
}


def _youtube_videos() -> list[dict]:
    try:
        xml = _get(f"https://www.youtube.com/feeds/videos.xml?channel_id={YT_CHANNEL}")
    except requests.RequestException:
        return []
    root = ET.fromstring(xml)
    out = []
    for e in root.findall("atom:entry", NS):
        vid = e.findtext("yt:videoId", namespaces=NS)
        title = e.findtext("atom:title", namespaces=NS) or ""
        pub = e.findtext("atom:published", namespaces=NS) or ""
        out.append({"id": vid, "title": title, "published": pub, "words": _words(title)})
    return out


def _match_video(ep: dict, videos: list[dict]) -> str | None:
    """Same upload as the audio episode: best word overlap, must share ≥45% and be
    within ~4 days. Falls back to None — an audio-only episode is fine."""
    best, best_score = None, 0.0
    ep_dt = datetime.fromisoformat(ep["published"].replace("Z", "+00:00"))
    for v in videos:
        if not v["words"] or not ep["words"]:
            continue
        inter = len(v["words"] & ep["words"])
        score = inter / max(1, min(len(v["words"]), len(ep["words"])))
        try:
            vdt = datetime.fromisoformat(v["published"].replace("Z", "+00:00"))
            if abs((vdt - ep_dt).total_seconds()) > 4 * 86400:
                score *= 0.5
        except ValueError:
            pass
        if score > best_score:
            best, best_score = v, score
    return best["id"] if best and best_score >= 0.45 else None


def episodes() -> dict:
    """All episodes, newest first, with the show they belong to and any matching
    YouTube upload. 15-minute cache; last good copy on feed failure."""
    ck = "episodes"
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < 900:
        return hit[1]
    try:
        xml = _get(FEED_URL)
    except requests.RequestException:
        stale = _cache.get(ck + ":last")
        return {**(stale[1] if stale else {"episodes": [], "show": {}}), "status": "stale"}
    root = ET.fromstring(xml)
    ch = root.find("channel")
    img = ch.find("itunes:image", NS)
    show = {
        "title": ch.findtext("title") or "Armchair Experts",
        "author": ch.findtext("itunes:author", namespaces=NS) or "",
        "link": ch.findtext("link") or "",
        "art": img.get("href") if img is not None else ch.findtext("image/url"),
        "desc": _strip_html(ch.findtext("description") or ""),
    }
    videos = _youtube_videos()
    out, seen = [], set()
    for it in ch.findall("item"):
        title = (it.findtext("title") or "").strip()
        guid = it.findtext("guid") or title
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(timezone.utc)
        except (TypeError, ValueError):
            pub = datetime.now(timezone.utc)
        enc = it.find("enclosure")
        dur = it.findtext("itunes:duration", namespaces=NS) or ""
        secs = int(dur) if dur.isdigit() else sum(int(x) * 60 ** i for i, x in enumerate(reversed(dur.split(":")))) if dur else 0
        desc_html = it.findtext("content:encoded", namespaces=NS) or it.findtext("description") or ""
        eimg = it.find("itunes:image", NS)
        slug = _slug(title)
        if slug in seen:
            slug = f"{slug}-{pub.strftime('%Y%m%d')}"
        seen.add(slug)
        ep = {
            "id": guid, "slug": slug, "title": title,
            "published": pub.isoformat().replace("+00:00", "Z"),
            "durationSec": secs, "duration": f"{secs // 60} min" if secs else "",
            "number": it.findtext("itunes:episode", namespaces=NS),
            "season": it.findtext("itunes:season", namespaces=NS),
            "audio": enc.get("url") if enc is not None else None,
            "link": it.findtext("link") or "",
            "image": eimg.get("href") if eimg is not None else show["art"],
            "summary": _summary(desc_html),
            "topics": _topics(desc_html),
            "words": _words(title),
        }
        ep["showKey"] = _show_key(title)
        ep["show"] = SHOW_META[ep["showKey"]]
        ep["guest"] = _guest(title, ep["showKey"])
        ep["videoId"] = _match_video(ep, videos)
        ep["thumb"] = f"https://i.ytimg.com/vi/{ep['videoId']}/hqdefault.jpg" if ep["videoId"] else ep["image"]
        del ep["words"]
        out.append(ep)
    out.sort(key=lambda e: e["published"], reverse=True)
    for i, ep in enumerate(out):
        ep["prev"] = out[i + 1]["slug"] if i + 1 < len(out) else None      # older
        ep["next"] = out[i - 1]["slug"] if i > 0 else None                # newer
    payload = {"show": show, "platforms": PLATFORMS, "episodes": out,
               "count": len(out), "updated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
               "status": "live", "source": "Podcast RSS (Omny/iHeart) + YouTube channel feed"}
    _cache[ck] = (time.time(), payload)
    _cache[ck + ":last"] = (time.time(), payload)
    return payload


def episode(slug: str) -> dict | None:
    return next((e for e in episodes()["episodes"] if e["slug"] == slug), None)


def people() -> list[dict]:
    """Hosts (curated) + guests (derived from interview episodes), each with
    the episodes they appear in."""
    eps = episodes()["episodes"]
    out = [{**h, "kind": "host", "episodes": [e["slug"] for e in eps if e["showKey"] in ("afl", "cali", "nfl") and (h["slug"] != "adam-cooney" or e["showKey"] == "afl")][:60]} for h in HOSTS]
    guests: dict[str, dict] = {}
    for e in eps:
        g = e.get("guest")
        if not g:
            continue
        rec = guests.setdefault(g["slug"], {"slug": g["slug"], "name": g["name"], "role": g["role"], "kind": "guest", "episodes": []})
        rec["episodes"].append(e["slug"])
        if not rec["role"] and g["role"]:
            rec["role"] = g["role"]
    return out + sorted(guests.values(), key=lambda x: x["name"])


def person(slug: str) -> dict | None:
    return next((p for p in people() if p["slug"] == slug), None)


def shows() -> list[dict]:
    """Every show with its episode count and latest episode."""
    eps = episodes()["episodes"]
    out = []
    for key, meta in SHOW_META.items():
        mine = [e for e in eps if e["showKey"] == key]
        out.append({**meta, "key": key, "count": len(mine), "latest": mine[0] if mine else None,
                    "status": "live" if mine else ("soon" if key in ("nfl", "nbl") else "soon")})
    return out
