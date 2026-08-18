"""Branded social cards, rendered on the server: 1200×630, the site's crimson/black
identity, the episode title in Anton, the show and date, the episode art on the
right. Served at /og/episode/{slug}.png and used as og:image on episode pages —
so a shared link unfurls as an Armchair Experts card, not a raw thumbnail.
"""
import io
import time
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

FONTS = Path(__file__).resolve().parent / "fonts"
W, H = 1200, 630
GROUND, CARD, ACCENT, GOLD, INK, MUTED = (15, 4, 7), (30, 12, 19), (245, 41, 75), (255, 176, 32), (249, 243, 245), (176, 150, 158)
_cache: dict[str, tuple[float, bytes]] = {}


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def _wrap(draw, text, font, max_w, max_lines):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
            if len(lines) == max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) == max_lines and len(" ".join(lines)) < len(text):
        lines[-1] = lines[-1].rstrip(".,") + "…"
    return lines


def _art(url: str | None) -> Image.Image | None:
    if not url:
        return None
    try:
        r = requests.get(url, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        im = Image.open(io.BytesIO(r.content)).convert("RGB")
        return im
    except Exception:
        return None


def episode_card(ep: dict) -> bytes:
    key = "ep:" + ep["slug"]
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    im = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(im)
    # right-hand art panel, 16:9 cover crop
    art = _art(ep.get("thumb") or ep.get("image"))
    ax = 700
    if art:
        aw, ah = W - ax, H
        r = max(aw / art.width, ah / art.height)
        art = art.resize((int(art.width * r) + 1, int(art.height * r) + 1), Image.LANCZOS)
        left, top = (art.width - aw) // 2, (art.height - ah) // 2
        art = art.crop((left, top, left + aw, top + ah))
        im.paste(art, (ax, 0))
        # fade the art into the ground on its left edge
        fade = Image.new("L", (aw, ah), 0)
        fd = ImageDraw.Draw(fade)
        for x in range(0, 200):
            fd.line([(x, 0), (x, ah)], fill=int(255 * (1 - x / 200)))
        im.paste(Image.new("RGB", (aw, ah), GROUND), (ax, 0), fade)
    # accent bar + wordmark
    d.rectangle([0, 0, W, 10], fill=ACCENT)
    d.text((64, 44), "ARMCHAIR·EXPERTS", font=_font("Anton-Regular.ttf", 34), fill=INK)
    d.text((64, 88), "EVERY SPORT. ONE ARMCHAIR.", font=_font("BarlowCondensed-SemiBold.ttf", 20), fill=ACCENT)
    # show + episode
    show = (ep.get("show") or {}).get("title", "Armchair Experts")
    num = f"  ·  EPISODE {ep['number']}" if ep.get("number") else ""
    d.text((64, 160), (show + num).upper(), font=_font("BarlowCondensed-SemiBold.ttf", 24), fill=GOLD)
    # title
    tf = _font("Anton-Regular.ttf", 64)
    lines = _wrap(d, ep.get("title", ""), tf, 600 if art else 1060, 4)
    y = 200
    for ln in lines:
        d.text((64, y), ln.upper(), font=tf, fill=INK)
        y += 70
    # meta
    meta = []
    if ep.get("published"):
        try:
            from datetime import datetime
            meta.append(datetime.fromisoformat(ep["published"].replace("Z", "+00:00")).strftime("%d %B %Y").lstrip("0"))
        except (ValueError, TypeError):
            pass
    if ep.get("duration"):
        meta.append(ep["duration"])
    hosts = (ep.get("show") or {}).get("hosts", "")
    if hosts:
        meta.append(hosts)
    d.text((64, min(y + 14, H - 110)), "  ·  ".join(m for m in meta if m), font=_font("Inter-Regular.ttf", 22), fill=MUTED)
    # listen chip
    cy = H - 74
    d.rounded_rectangle([64, cy - 22, 64 + 250, cy + 22], radius=12, fill=ACCENT)
    d.polygon([(86, cy - 11), (86, cy + 11), (104, cy)], fill=(255, 255, 255))
    d.text((116, cy - 15), "LISTEN NOW", font=_font("BarlowCondensed-SemiBold.ttf", 26), fill=(255, 255, 255))
    d.text((334, cy - 13), "armchair-nfl.vercel.app", font=_font("Inter-Regular.ttf", 20), fill=MUTED)
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True)
    data = out.getvalue()
    _cache[key] = (time.time(), data)
    return data
