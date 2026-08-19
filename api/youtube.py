"""The channel's uploads, from whichever YouTube surface is answering today.

YouTube's channel RSS (feeds/videos.xml) is the clean source — exact publish
times, descriptions, view counts — but it started 404ing for every channel in
Aug 2026. The channel's /videos page still ships the same list inside
ytInitialData (lockupViewModel entries), with relative dates ("6 days ago") and
no descriptions. We take RSS when it answers and fall back to the page, marking
scraped dates with a tolerance so episode matching can stay honest about the
precision it has. Whatever we last got is kept as a stale fallback for a day.
"""
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

CHANNEL = "UCvgkN-LsaA6TLIrQYq_REkg"  # Armchair Experts with Cam Luke and Adam Cooney
NS = {"a": "http://www.w3.org/2005/Atom", "m": "http://search.yahoo.com/mrss/",
      "yt": "http://www.youtube.com/xml/schemas/2015"}
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
_cache: dict[str, tuple[float, list]] = {}
TTL, STALE = 900, 86400


def _rss() -> list[dict]:
    r = requests.get(f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL}",
                     timeout=10, headers={"User-Agent": UA})
    r.raise_for_status()
    root = ET.fromstring(r.content)
    out = []
    for e in root.findall("a:entry", NS):
        vid = e.findtext("yt:videoId", namespaces=NS)
        title = e.findtext("a:title", namespaces=NS) or ""
        if not vid or not title:
            continue
        g = e.find("m:group", NS)
        desc = (g.findtext("m:description", namespaces=NS) or "") if g is not None else ""
        stats = g.find("m:community/m:statistics", NS) if g is not None else None
        out.append({
            "id": vid, "title": title,
            "published": e.findtext("a:published", namespaces=NS) or "",
            "tolerance": 0,
            "description": desc,
            "views": int(stats.get("views")) if stats is not None and stats.get("views") else 0,
            "duration": "",
        })
    if not out:
        raise ValueError("empty feed")
    return out


_REL = re.compile(r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago", re.I)
_UNIT = {"second": 1 / 86400, "minute": 1 / 1440, "hour": 1 / 24, "day": 1, "week": 7, "month": 30, "year": 365}


def _rel_date(text: str) -> tuple[str, float]:
    """'6 days ago' → (ISO timestamp, tolerance in days). Unknown → ('', 999)."""
    m = _REL.search(text or "")
    if not m:
        return "", 999
    n, unit = int(m.group(1)), m.group(2).lower()
    days = n * _UNIT[unit]
    dt = datetime.now(timezone.utc) - timedelta(days=days)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ"), max(_UNIT[unit], 1 / 24)


def _views(text: str) -> int:
    m = re.search(r"([\d.,]+)\s*([KMB])?\s*views?", text or "", re.I)
    if not m:
        return 0
    n = float(m.group(1).replace(",", ""))
    return int(n * {"K": 1e3, "M": 1e6, "B": 1e9}.get((m.group(2) or "").upper(), 1))


def _walk(o, out):
    if isinstance(o, dict):
        if "lockupViewModel" in o:
            out.append(o["lockupViewModel"])
        for v in o.values():
            _walk(v, out)
    elif isinstance(o, list):
        for v in o:
            _walk(v, out)


def _scrape() -> list[dict]:
    r = requests.get(f"https://www.youtube.com/channel/{CHANNEL}/videos", timeout=15,
                     headers={"User-Agent": UA, "Accept-Language": "en-AU,en;q=0.9",
                              "Cookie": "CONSENT=YES+1; SOCS=CAI"})
    r.raise_for_status()
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", r.text, re.S)
    if not m:
        raise ValueError("no ytInitialData")
    lockups: list = []
    _walk(json.loads(m.group(1)), lockups)
    out, seen = [], set()
    for lv in lockups:
        vid = lv.get("contentId")
        if not vid or vid in seen or lv.get("contentType") not in (None, "LOCKUP_CONTENT_TYPE_VIDEO"):
            continue
        md = (lv.get("metadata") or {}).get("lockupMetadataViewModel") or {}
        title = ((md.get("title") or {}).get("content") or "").strip()
        if not title:
            continue
        parts = []
        for row in (((md.get("metadata") or {}).get("contentMetadataViewModel") or {}).get("metadataRows") or []):
            for p in row.get("metadataParts") or []:
                parts.append(((p.get("text") or {}).get("content") or ""))
        joined = " • ".join(parts)
        pub, tol = _rel_date(joined)
        dur = ""
        for ov in ((lv.get("contentImage") or {}).get("thumbnailViewModel") or {}).get("overlays") or []:
            for b in (ov.get("thumbnailBottomOverlayViewModel") or {}).get("badges") or []:
                t = (b.get("thumbnailBadgeViewModel") or {}).get("text") or ""
                if re.match(r"^\d+:\d\d(:\d\d)?$", t):
                    dur = t
        seen.add(vid)
        out.append({"id": vid, "title": title, "published": pub, "tolerance": tol,
                    "description": "", "views": _views(joined), "duration": dur})
    if not out:
        raise ValueError("no lockups")
    return out


def videos() -> list[dict]:
    """Newest first. Each: id, title, published (ISO or ''), tolerance (days of
    date uncertainty; 0 = exact), description, views, duration."""
    hit = _cache.get("videos")
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    for fn in (_rss, _scrape):
        try:
            out = fn()
            _cache["videos"] = (time.time(), out)
            return out
        except Exception:
            continue
    if hit and time.time() - hit[0] < STALE:
        return hit[1]
    return []
