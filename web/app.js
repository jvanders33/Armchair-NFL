/* Armchair Experts — the Australian NFL platform.
   Hash-routed SPA: #/ (What to Watch) · #/teams · #/team/{abbr} · #/player/{id}
   Live data via /api/* (ESPN public feeds, normalised + cached server-side). */
(function () {
  "use strict";

  // Where the games actually are in Australia (2026). No exclusive partner --
  // every real option, free-to-air first. Verified Aug 2026: Seven holds NFL
  // FTA incl. the MCG game; ESPN via Kayo; NFL Game Pass on DAZN for every
  // game. AFL: Seven + Fox Footy/Kayo. NBL: Nine FTA + ESPN via Kayo.
  const WATCH = {
    // every: true = carries every game of the code; free: true = free-to-air. Selected-game
    // free-to-air is real but not confirmable per game from our feeds, so it's shown as
    // "free · selected games", never as the primary claim for a specific fixture.
    nfl: [
      { key: "kayo", label: "Kayo", sub: "ESPN · most games", url: "https://kayosports.com.au/sports/nfl", every: false },
      { key: "gamepass", label: "Game Pass", sub: "every game", url: "https://www.dazn.com/en-AU/l/nfl-game-pass", every: true },
      { key: "7plus", label: "7plus", sub: "free · selected games", url: "https://7plus.com.au/nfl", free: true },
    ],
    afl: [
      { key: "kayo", label: "Kayo", sub: "Fox Footy · every game", url: "https://kayosports.com.au/sports/afl", every: true },
      { key: "7plus", label: "7plus", sub: "free · selected games", url: "https://7plus.com.au/afl", free: true },
    ],
    nbl: [
      { key: "kayo", label: "Kayo", sub: "ESPN · every game", url: "https://kayosports.com.au/sports/basketball", every: true },
      { key: "9now", label: "9Now", sub: "free · two games a week", url: "https://www.9now.com.au", free: true },
    ],
    // Racing.com carries Victorian racing free; Seven has Sydney's carnival days; Sky Racing is the national channel
    nrl: [
      { key: "kayo", label: "Kayo", sub: "Fox League · every game", url: "https://kayosports.com.au/sports/nrl", every: true },
      { key: "9now", label: "9Now", sub: "free · selected games", url: "https://www.9now.com.au", free: true },
    ],
    nba: [
      { key: "leaguepass", label: "League Pass", sub: "every game", url: "https://www.nba.com/watch/league-pass-stream", every: true },
      { key: "kayo", label: "Kayo", sub: "ESPN · selected games", url: "https://kayosports.com.au/sports/basketball" },
    ],
    epl: [
      { key: "stan", label: "Stan Sport", sub: "every match", url: "https://www.stan.com.au/sport", every: true },
      { key: "9now", label: "9Now", sub: "free · marquee matches", url: "https://www.9now.com.au", free: true },
    ],
    mlb: [
      { key: "mlbtv", label: "MLB.TV", sub: "every game", url: "https://www.mlb.com/tv", every: true },
      { key: "kayo", label: "Kayo", sub: "ESPN · selected games", url: "https://kayosports.com.au/sports/baseball" },
    ],
    cfb: [
      { key: "kayo", label: "Kayo", sub: "ESPN · selected games", url: "https://kayosports.com.au/sports/american-football" },
    ],
    cricket: [
      { key: "7plus", label: "7plus", sub: "free · every international and BBL match", url: "https://7plus.com.au/cricket", free: true, every: true },
      { key: "kayo", label: "Kayo", sub: "Fox Cricket · every match", url: "https://kayosports.com.au/sports/cricket", every: true },
    ],
    tennis: [
      { key: "stan", label: "Stan Sport", sub: "Grand Slams", url: "https://www.stan.com.au/sport" },
      { key: "9now", label: "9Now", sub: "Australian Open · free", url: "https://www.9now.com.au" },
    ],
    f1: [
      { key: "kayo", label: "Kayo", sub: "Fox Sports · every session", url: "https://kayosports.com.au/sports/motor" },
      { key: "10play", label: "10 Play", sub: "Australian GP · free", url: "https://10play.com.au" },
    ],
    golf: [
      { key: "kayo", label: "Kayo", sub: "Fox Sports", url: "https://kayosports.com.au/sports/golf" },
    ],
    ufc: [
      { key: "kayo", label: "Kayo", sub: "every card", url: "https://kayosports.com.au/sports/ufc" },
    ],
    racing: [
      { key: "racingcom", label: "Racing.com", sub: "free · Victoria", url: "https://www.racing.com/videos/watch-live" },
      { key: "7plus", label: "7plus", sub: "free · Sydney carnival days", url: "https://7plus.com.au/horse-racing" },
      { key: "sky", label: "Sky Racing", sub: "Foxtel · TAB app", url: "https://www.skyracing.com.au/" },
    ],
  };
  const watchOpts = () => WATCH[league] || WATCH.nfl;

  const TZ_LABEL = {
    "Australia/Sydney": "Sydney",
    "Australia/Brisbane": "Brisbane",
    "Australia/Perth": "Perth",
  };
  const TIER_LABEL = { 1: "Must-watch", 2: "Worth it", 3: "Deep cut" };
  const STAR_KEY = "wtw_watchlist_v1";
  const TZ_KEY = "wtw_tz";

  let tz = localStorage.getItem(TZ_KEY) || "Australia/Sydney";
  let sort = "watch";
  let weekView = null; // null = ESPN "current"; else {year, seasontype, week} or {date} for nightly leagues
  let aussiesFor = null; // which league the aussies[] array belongs to
  let hubData = null;
  let aussies = [];

  const $ = (id) => document.getElementById(id);
  const view = $("view");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const _cache = new Map();
  // Funnel analytics: one beacon per audience action. Same payload a real sink
  // (Vercel Analytics / Plausible / GA4) would take — swap the transport, keep the calls.
  function track(event, label, extra) {
    try {
      const body = JSON.stringify({ event, label: label || "", route: location.hash || location.pathname, ts: Date.now(), ...(extra || {}) });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      else fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
      if (window.va) window.va("event", { name: event, data: { label } });
    } catch { /* analytics must never break the page */ }
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-track]");
    if (a) track(a.getAttribute("data-track"), a.getAttribute("data-label") || a.textContent.trim().slice(0, 48));
  });
  const SITE = location.origin;
  async function share(title, url, event) {
    track(event || "share", title);
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      toast("Link copied · " + esc(url.replace(/^https?:\/\//, "")));
    } catch { toast("Copy this link: " + esc(url)); }
  }
  const timeAgoShort = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`; };
  const epDate = (iso) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  async function fetchJSON(url) {
    if (_cache.has(url)) return _cache.get(url);
    const r = await fetch(url);
    if (!r.ok) throw new Error("API " + r.status);
    const d = await r.json();
    _cache.set(url, d);
    return d;
  }

  const fmt = (iso) => {
    const d = new Date(iso);
    const wd = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: tz }).format(d).toUpperCase();
    const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: tz }).format(d);
    const tm = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
      .format(d).toUpperCase().replace(" ", "");
    return { wd, day, tm };
  };


  // ---------- motion: scroll-reveal + count-up (skipped for reduced-motion) ----------
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let revealObs = null;

  function countUp(el) {
    const raw = el.textContent.trim();
    const m = raw.match(/^([^0-9]*)([0-9][0-9,.]*)(.*)$/);
    if (!m) return;
    const target = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(target) || target === 0) return;
    const hasComma = m[2].includes(","), dec = (m[2].split(".")[1] || "").length;
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
      let v = (target * eased).toFixed(dec);
      if (hasComma) v = Number(v).toLocaleString(undefined, { minimumFractionDigits: dec });
      el.textContent = m[1] + v + m[3];
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function armMotion() {
    if (REDUCED) return;
    if (revealObs) revealObs.disconnect();
    revealObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add("rev-in");
        if (en.target.matches(".stat")) {
          const v = en.target.querySelector(".stat-v");
          if (v && !v.dataset.counted) { v.dataset.counted = "1"; countUp(v); }
        }
        revealObs.unobserve(en.target);
      });
    }, { threshold: 0.15 });
    const els = document.querySelectorAll(".game, .story, .stat, .show-card, .team-card, .vid-card, .pod-card, .lg-card, .xmas-card, .t5-item");
    els.forEach((el) => { el.classList.add("rev"); revealObs.observe(el); });
    // Safety net: if observer deliveries stall (throttled tabs, odd embeds),
    // nothing may ever un-hide — reveal whatever's left after 2s.
    setTimeout(() => els.forEach((el) => el.classList.add("rev-in")), 2000);
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(html) {
    const el = $("toast");
    el.innerHTML = html;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
  }

  // =====================================================================
  // THE PODCAST — home, episodes, episode page, show page, follow strip
  // =====================================================================
  const PLAT_ICON = { youtube: "▶", apple: "", iheart: "♥", rss: "◉", spotify: "●" };
  function followStrip(platforms, compact) {
    const ps = platforms || [];
    return `<section class="follow${compact ? " compact" : ""}" aria-label="Follow Armchair Experts">
      <div class="fl-h"><b>Never miss an episode</b><span>Follow Armchair Experts wherever you listen.</span></div>
      <div class="fl-row">
        ${ps.map((p) => `<a class="fl-btn fl-${esc(p.key)}" href="${esc(p.url)}" target="_blank" rel="noopener" data-track="click_follow_platform" data-label="${esc(p.key)}">${PLAT_ICON[p.key] || ""} ${esc(p.verb)} on ${esc(p.label)}</a>`).join("")}
        <a class="fl-btn fl-mail" href="#/leagues" data-track="click_follow_platform" data-label="newsletter">✉ Get the weekly wrap</a>
      </div>
      ${compact ? "" : `<div class="fl-note">Spotify, Instagram, TikTok and X links land here as soon as the handles are confirmed — nothing is faked in the meantime.</div>`}
    </section>`;
  }
  const epThumb = (e) => e.thumb || e.image || "/img/logo-badge.png";
  function episodeCard(e, opts) {
    const o = opts || {};
    return `<a class="ep-card${o.big ? " big" : ""}" href="#/episode/${esc(e.slug)}" data-track="click_episode" data-label="${esc(e.slug)}">
      <span class="ep-art"><img src="${esc(epThumb(e))}" alt="" loading="lazy">${e.videoId ? '<span class="ep-play">▶</span>' : '<span class="ep-play audio">♪</span>'}</span>
      <span class="ep-body">
        <span class="ep-show">${esc(e.show.title)}${e.number ? ` · Ep ${esc(e.number)}` : ""}</span>
        <span class="ep-t">${esc(e.title)}</span>
        <span class="ep-m">${esc(epDate(e.published))}${e.duration ? " · " + esc(e.duration) : ""}</span>
      </span>
    </a>`;
  }
  let audioEl = null;
  function playAudio(url, title) {
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.controls = true; audioEl.preload = "none"; audioEl.className = "site-audio";
      const dock = document.createElement("div"); dock.id = "audio-dock"; dock.setAttribute("aria-live", "polite");
      dock.innerHTML = `<span class="ad-now">Now playing</span><span class="ad-title" id="ad-title"></span>`;
      dock.appendChild(audioEl); document.body.appendChild(dock);
    }
    if (audioEl.src !== url) audioEl.src = url;
    $("ad-title").textContent = title;
    document.body.classList.add("has-audio");
    audioEl.play().catch(() => {});
    track("click_listen", title);
  }

  // ---------- HOME: podcast first ----------
  async function showHome() {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Loading the latest episode…</div></div>`;
    let eps = null, err = null;
    try { eps = await fetchJSON("/api/episodes?limit=12"); } catch (e) { err = e; }
    const latest = eps && eps.episodes && eps.episodes[0];
    const platforms = (eps && eps.platforms) || [];
    view.innerHTML = `
      <section class="home-hero" aria-labelledby="home-h1">
        <div class="shell hh-grid">
          <div class="hh-copy">
            <div class="hh-eyebrow">The latest from Armchair Experts</div>
            ${latest ? `
              <div class="hh-show">${esc(latest.show.title)}${latest.number ? ` · Episode ${esc(latest.number)}` : ""}</div>
              <h1 id="home-h1" class="hh-title">${esc(latest.title)}</h1>
              <p class="hh-desc">${esc(latest.summary.slice(0, 220))}${latest.summary.length > 220 ? "…" : ""}</p>
              <div class="hh-meta">${esc(latest.show.hosts)} · ${esc(epDate(latest.published))}${latest.duration ? " · " + esc(latest.duration) : ""}</div>
              <div class="hh-actions">
                ${latest.audio ? `<button class="watch big" id="hh-listen" data-track="click_listen_hero" data-label="${esc(latest.slug)}">▶ Listen now</button>` : ""}
                ${latest.videoId ? `<a class="watch ghost" href="#/watch/${esc(latest.videoId)}" data-track="click_watch_video" data-label="${esc(latest.slug)}">Watch on YouTube</a>` : ""}
                <a class="watch ghost" href="#/episode/${esc(latest.slug)}" data-track="click_episode" data-label="${esc(latest.slug)}">Episode page</a>
                <button class="watch ghost" id="hh-share" data-track="share_episode" data-label="${esc(latest.slug)}">Share</button>
              </div>` : `
              <h1 id="home-h1" class="hh-title">Every sport. One armchair.</h1>
              <p class="hh-desc">The voice of sports fans in Australia.</p>
              <div class="hh-meta">${err ? "The episode feed didn't answer just now — the shows are still on YouTube and Apple below." : ""}</div>`}
          </div>
          <div class="hh-art">${latest ? `<a href="#/episode/${esc(latest.slug)}"><img src="${esc(epThumb(latest))}" alt="${esc(latest.title)}"></a>` : `<img src="/img/logo-badge.png" alt="Armchair Experts">`}</div>
        </div>
      </section>
      <div class="shell">
        ${followStrip(platforms)}
        <section id="home-week" aria-labelledby="hw-h"><div class="section-h" style="margin-top:32px" id="hw-h">This week in sport <span class="n" id="hw-note">· loading</span></div><div class="hw-grid" id="hw-grid"><div class="loading">Finding what's worth watching…</div></div></section>
        ${eps && eps.episodes && eps.episodes.length > 1 ? `
        <div class="section-h" style="margin-top:32px">Latest episodes <span class="n">· <a href="#/episodes">all ${eps.count} →</a></span></div>
        <div class="ep-grid">${eps.episodes.slice(1, 7).map((e) => episodeCard(e)).join("")}</div>` : ""}
        <section id="home-take"></section>
        <div class="wr-teaser"><a class="wr-teaser-in" href="#/wrap"><b>The Weekly Wrap</b><span>The week in five minutes — episodes, games worth watching, the stories, what's coming. Read it →</span></a><a class="wr-teaser-in" href="#/people"><b>Hosts &amp; guests</b><span>Cam, Cooney, and everyone who's sat in the guest chair →</span></a><a class="wr-teaser-in" href="#/watch"><b>Watch</b><span>Every episode, interview and clip on the channel, playable here →</span></a></div>
        <section id="home-moments"></section>
        <div class="section-h" style="margin-top:34px">Go deeper <span class="n">· every code, every fixture, every player</span></div>
        <div class="deep-row">
          <a class="deep-chip hot" href="#/aussies">🇦🇺 Aussies Abroad</a>
          ${["afl", "nrl", "cricket", "nbl", "racing", "nfl", "nba", "epl", "mlb", "cfb", "tennis", "f1", "golf", "ufc", "la2028"].map((k) => `<a class="deep-chip" href="#/${k}"><img src="${LG_LOGO(k)}" alt="">${esc((LEAGUE_UI[k] || {}).label || k.toUpperCase())}</a>`).join("")}
        </div>
        <p class="panel-note" style="margin-top:8px">${eps ? `Episodes from the show's podcast feed and YouTube channel · updated ${timeAgoShort(eps.updated)}` : ""}</p>
      </div>`;
    if (latest && latest.audio) $("hh-listen")?.addEventListener("click", () => playAudio(latest.audio, latest.title));
    if (latest) $("hh-share")?.addEventListener("click", () => share(latest.title, `${SITE}/episode/${latest.slug}`, "share_episode"));
    track("view_home", latest ? latest.slug : "no-episode");
    homeWeek(); homeTake(); homeMoments();
    armMotion();
  }

  // This week in sport — the repeat-visit engine, compact: two Games of the Week + the next calendar moments
  let homeLiveTimer = null;
  async function homeWeek() {
    const grid = $("hw-grid"), note = $("hw-note"); if (!grid) return;
    const [nfl, afl, ev] = await Promise.all([
      fetchJSON("/api/schedule?league=nfl").catch(() => null),
      fetchJSON("/api/schedule?league=afl").catch(() => null),
      fetchJSON("/api/events").catch(() => null),
    ]);
    const cards = [];
    const gameCard = (lg, d) => {
      if (!d || !d.games || !d.games.length) return;
      const live = d.games.filter((x) => x.status.state !== "post");
      const pool = live.length ? live : d.games;
      const g = pool.find((x) => x.id === (d.experts || {}).gotw) || pool.find((x) => x.id === d.gotw) || pool[0];
      const k = fmt(g.date);
      const opts = WATCH[lg] || [];
      const why = typeof g.expertCall === "string" ? g.expertCall : (g.expertCall && (g.expertCall.quote || g.expertCall.text)) || "";
      cards.push(`<article class="hw-card">
        <div class="hw-top"><span class="sc-sport">${esc((LEAGUE_UI[lg] || {}).name || lg)}</span>${statusBadge(g)}</div>
        <div class="hw-teams"><img src="${esc(g.away.logo)}" alt=""><b>${esc(g.away.name)}</b><i>${lg === "nfl" ? "at" : "v"}</i><img src="${esc(g.home.logo)}" alt=""><b>${esc(g.home.name)}</b></div>
        <div class="hw-when">${k.wd} ${k.day} · ${k.tm} ${TZ_LABEL[tz]}</div>
        <div class="hw-why"><b>Why watch?</b> ${esc(why || whyPlain(g, lg))}</div>
        <div class="hw-watch">${opts[0] ? `<a class="watch sm" href="${esc(opts[0].url)}" target="_blank" rel="noopener" data-track="click_event_watch_provider" data-label="${esc(lg + ":" + opts[0].key)}">▶ Watch on ${esc(opts[0].label)}</a>` : ""}${opts.length > 1 ? `<span class="watch-also">also on ${opts.slice(1).map((w) => esc(w.label)).join(" · ")}</span>` : ""}</div>
      </article>`);
    };
    gameCard("nfl", nfl); gameCard("afl", afl);
    const upcoming = ((ev && ev.events) || []).filter((e) => !e.past).slice(0, 2);
    upcoming.forEach((e) => {
      const k = fmt(e.time);
      const lg = (e.code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const opts = WATCH[lg] || [];
      cards.push(`<article class="hw-card">
        <div class="hw-top"><span class="sc-sport">${esc(e.code || "")}</span><span class="badge-final">${esc(k.wd)} ${esc(k.day)}</span></div>
        <div class="hw-title">${esc(e.name)}</div>
        <div class="hw-when">${k.tm} ${TZ_LABEL[tz]}</div>
        <div class="hw-why"><b>Why watch?</b> ${esc(e.sub || "")}</div>
        <div class="hw-watch">${e.href ? `<a class="watch sm ghost" href="${esc(e.href)}">Open the hub →</a>` : ""}${opts[0] ? `<span class="watch-also">on ${opts.map((w) => esc(w.label)).join(" · ")}</span>` : ""}</div>
      </article>`);
    });
    grid.innerHTML = cards.length ? cards.join("") : `<div class="panel roster-empty"><p>The fixture feeds didn't answer just now — the leagues below still work. <a href="#/" onclick="location.reload()">Try again</a>.</p></div>`;
    if (note) note.textContent = cards.length ? `· updated ${timeAgoShort(new Date().toISOString())} · times in ${TZ_LABEL[tz]}` : "· unavailable";
    // live: while any featured game is in play, refresh this module every minute (scores/status)
    clearInterval(homeLiveTimer);
    const anyLive = [nfl, afl].some((d) => d && (d.games || []).some((g) => g.status.state === "in"));
    if (anyLive) homeLiveTimer = setInterval(() => { if (!$("hw-grid") || document.hidden) return; _cache.delete("/api/schedule?league=nfl"); _cache.delete("/api/schedule?league=afl"); homeWeek(); }, 60000);
  }
  // plain-language why-watch (no betting jargon)
  function whyPlain(g, lg) {
    const bits = [];
    if (g.homeWinProb != null) { const p = Math.round(Math.max(g.homeWinProb, 1 - g.homeWinProb) * 100); bits.push(p <= 58 ? "a genuine coin-flip" : p <= 68 ? "a close contest on paper" : "one side is favoured, but upsets happen"); }
    if (g.slot && /Night|Kickoff/.test(g.slot)) bits.push("the prime-time slot");
    if (g.watch && g.watch.tier === 1) bits.push("the game of the round");
    if (lg === "afl") bits.push("finals places on the line");
    return bits.length ? bits.join(" · ").replace(/^./, (c) => c.toUpperCase()) + "." : "The pick of the round.";
  }
  async function homeTake() {
    const el = $("home-take"); if (!el) return;
    const d = await fetchJSON("/api/schedule?league=nfl").catch(() => null);
    const g = d && d.games ? d.games.find((x) => x.expertCall) : null;
    if (!g) { el.innerHTML = ""; return; }
    const c = typeof g.expertCall === "string" ? g.expertCall : (g.expertCall.quote || g.expertCall.text || "");
    const by = (d.experts && d.experts.show && d.experts.show.hosts) || "The Experts";
    el.innerHTML = `<div class="section-h" style="margin-top:32px">The Experts' take <span class="n">· this week</span></div>
      <blockquote class="take"><p>${esc(c)}</p><footer>— ${esc(by)} · on ${esc(g.away.name)} at ${esc(g.home.name)} · <a href="#/nfl">the NFL hub →</a></footer></blockquote>`;
  }
  async function homeMoments() {
    const el = $("home-moments"); if (!el) return;
    const ev = await fetchJSON("/api/events").catch(() => null);
    const items = ((ev && ev.events) || []).filter((e) => !e.past).slice(2, 6);
    if (!items.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="section-h" style="margin-top:32px">Coming up <span class="n">· the moments that matter · <a href="#/landing">the full calendar →</a></span></div>
      <div class="cal-row">${items.map((e) => { const k = fmt(e.time); return `<a class="cal-card" href="${esc(e.href || "#/leagues")}"><span class="cal-when">${esc(k.wd)} ${esc(k.day)}</span><b>${esc(e.name)}</b><i>${esc(e.code || "")}</i></a>`; }).join("")}</div>`;
  }

  // ---------- EPISODES list ----------
  async function showEpisodes(showKey) {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Loading episodes…</div></div>`;
    try {
      const d = await fetchJSON("/api/episodes?limit=100");
      const shows = [...new Map(d.episodes.map((e) => [e.showKey, e.show])).entries()];
      const eps = showKey ? d.episodes.filter((e) => e.showKey === showKey) : d.episodes;
      view.innerHTML = `<div class="shell">
        ${pageHero("The podcast", `Every <em>episode</em>.`, `${d.count} episodes across the shows — listen here, watch on YouTube, or follow wherever you listen.`)}
        ${followStrip(d.platforms, true)}
        <div class="ep-search"><input type="search" id="ep-q" placeholder="Search episodes — a guest, a club, a topic…" aria-label="Search episodes"><span class="ep-q-n" id="ep-q-n"></span></div>
        <div class="ep-filters" role="tablist">
          <a class="fg-tab" href="#/episodes" aria-pressed="${!showKey}">All</a>
          ${shows.map(([k, s]) => `<a class="fg-tab" href="#/episodes/${esc(k)}" aria-pressed="${showKey === k}">${esc(s.title)}</a>`).join("")}
        </div>
        <div class="ep-grid" id="ep-grid">${eps.map((e) => episodeCard(e)).join("")}</div>
        <p class="panel-note" style="margin-top:12px">Source: the show's podcast feed and YouTube channel · updated ${timeAgoShort(d.updated)}</p>
      </div>`;
      const q = $("ep-q");
      if (q) q.addEventListener("input", () => {
        const s = q.value.trim().toLowerCase();
        const hits = !s ? eps : eps.filter((e) => (e.title + " " + (e.topics || []).join(" ") + " " + (e.guest ? e.guest.name : "") + " " + e.show.title).toLowerCase().includes(s));
        $("ep-grid").innerHTML = hits.length ? hits.map((e) => episodeCard(e)).join("") : `<div class="panel roster-empty"><p>No episodes match "${esc(q.value)}".</p></div>`;
        $("ep-q-n").textContent = s ? `${hits.length} of ${eps.length}` : "";
        if (s.length > 2) track("search_episodes", s.slice(0, 40));
      });
      track("view_episodes", showKey || "all");
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load episodes (${esc(err.message)}). <a href="#/episodes" onclick="location.reload()">Try again</a>.</div></div>`;
    }
  }

  // ---------- EPISODE page ----------
  async function showEpisode(slug) {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Loading episode…</div></div>`;
    try {
      const d = await fetchJSON("/api/episodes/" + encodeURIComponent(slug));
      const e = d.episode;
      document.title = `${e.title} — Armchair Experts`;
      view.innerHTML = `
        <div class="team-hero ep-hero"><div class="shell">
          <a class="crumb" href="#/show/${esc(e.show.slug)}">← ${esc(e.show.title)}</a>
          <div class="th-row">
            <img class="ep-hero-art" src="${esc(epThumb(e))}" alt="">
            <div>
              <div class="th-loc">${esc(e.show.title)}${e.number ? ` · Episode ${esc(e.number)}` : ""}${e.season ? ` · Season ${esc(e.season)}` : ""}</div>
              <h1 class="th-name ep-h1">${esc(e.title)}</h1>
              <div class="th-meta">With <a class="ppl-link" href="#/people/cam-luke">Cam Luke</a>${e.showKey === "afl" ? ' &amp; <a class="ppl-link" href="#/people/adam-cooney">Adam Cooney</a>' : ""}${e.guest ? ` · Guest: <a class="ppl-link" href="#/people/${esc(e.guest.slug)}">${esc(e.guest.name)}</a>${e.guest.role ? ` <i>(${esc(e.guest.role)})</i>` : ""}` : ""} · Published ${esc(epDate(e.published))}${e.duration ? " · " + esc(e.duration) : ""}</div>
              <div class="hh-actions">
                ${e.audio ? `<button class="watch big" id="ep-listen">▶ Listen now</button>` : ""}
                ${e.videoId ? `<a class="watch ghost" href="#/watch/${esc(e.videoId)}" data-track="click_watch_video" data-label="${esc(e.slug)}">Watch on YouTube</a>` : ""}
                <button class="watch ghost" id="ep-share">Share</button>
              </div>
            </div>
          </div>
        </div></div>
        <div class="shell">
          <div class="ep-cols">
            <div>
              ${e.videoId ? `<div class="ep-video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(e.videoId)}" title="${esc(e.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : ""}
              <div class="section-h" style="margin-top:22px">About this episode</div>
              <p class="ep-summary">${esc(e.summary || e.show.desc)}</p>
              ${e.topics && e.topics.length ? `<div class="section-h" style="margin-top:22px">In this episode</div><ul class="ep-topics">${e.topics.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
            </div>
            <aside class="ep-side">
              ${followStrip(d.platforms, true)}
              <div class="ep-related">
                <div class="ldr-h">Related</div>
                <a class="ep-rel" href="${esc(e.show.hub)}">${esc(e.show.sport)} · what to watch this week →</a>
                <a class="ep-rel" href="#/show/${esc(e.show.slug)}">More from ${esc(e.show.title)} →</a>
                ${e.next ? `<a class="ep-rel" href="#/episode/${esc(e.next)}">Next episode →</a>` : ""}
                ${e.prev ? `<a class="ep-rel" href="#/episode/${esc(e.prev)}">← Previous episode</a>` : ""}
              </div>
            </aside>
          </div>
        </div>`;
      $("ep-listen")?.addEventListener("click", () => playAudio(e.audio, e.title));
      $("ep-share")?.addEventListener("click", () => share(e.title, `${SITE}/episode/${e.slug}`, "share_episode"));
      track("view_episode", e.slug);
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load this episode (${esc(err.message)}). <a href="#/episodes">All episodes →</a></div></div>`;
    }
  }

  // ---------- SHOW page ----------
  async function showShowPage(slug) {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Loading the show…</div></div>`;
    try {
      const [ps, all] = await Promise.all([fetchJSON("/api/podcast/shows"), fetchJSON("/api/episodes?limit=100")]);
      const sh = ps.shows.find((x) => x.slug === slug);
      if (!sh) throw new Error("Unknown show");
      const eps = all.episodes.filter((e) => e.showKey === sh.key);
      const latest = eps[0];
      document.title = `${sh.title} — Armchair Experts`;
      view.innerHTML = `
        <div class="team-hero ep-hero"><div class="shell">
          <a class="crumb" href="#/shows">← Shows</a>
          <div class="th-row">
            ${latest ? `<img class="ep-hero-art" src="${esc(epThumb(latest))}" alt="">` : ""}
            <div>
              <div class="th-loc">${esc(sh.sport)} · ${esc(sh.cadence)} · <span class="sc-status ${sh.count ? "live" : "coming"}">${sh.count ? "● Live" : "Launching soon"}</span></div>
              <h1 class="th-name">${esc(sh.title)}</h1>
              <div class="th-meta">${esc(sh.desc)}</div>
              <div class="th-meta">Hosts: ${esc(sh.hosts)}</div>
            </div>
          </div>
        </div></div>
        <div class="shell">
          ${followStrip(ps.platforms, true)}
          ${latest ? `<div class="section-h" style="margin-top:28px">Latest episode</div>${episodeCard(latest, { big: true })}` : `<div class="panel roster-empty" style="margin-top:22px"><p>No episodes yet — follow the feed and it'll land here the day it drops.</p></div>`}
          ${eps.length > 1 ? `<div class="section-h" style="margin-top:28px">Episodes <span class="n">· ${eps.length}</span></div><div class="ep-grid">${eps.slice(1).map((e) => episodeCard(e)).join("")}</div>` : ""}
          <div class="section-h" style="margin-top:28px">Related</div>
          <div class="ep-related"><a class="ep-rel" href="${esc(sh.hub)}">${esc(sh.sport)} · what to watch this week →</a><a class="ep-rel" href="#/episodes">Every episode across the shows →</a></div>
        </div>`;
      track("view_show", sh.slug);
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load this show (${esc(err.message)}). <a href="#/shows">All shows →</a></div></div>`;
    }
  }

  // ---------- THE WEEKLY WRAP: the digest as a page (and, later, the email body) ----------
  async function showWrap() {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Assembling the wrap…</div></div>`;
    try {
      const w = await fetchJSON("/api/wrap");
      const gameRow = (x) => { const g = x.game; const k = fmt(g.date); const opts = WATCH[x.league] || []; const primary = opts.find((o) => o.every) || opts[0];
        return `<div class="wr-game"><span class="sc-sport">${esc(x.name)}</span><b>${esc(g.away.name)} ${x.league === "nfl" ? "at" : "v"} ${esc(g.home.name)}</b><span class="wr-when">${k.wd} ${k.day} · ${k.tm} ${TZ_LABEL[tz]}</span>${primary ? `<a class="watch sm ghost" href="${esc(primary.url)}" target="_blank" rel="noopener" data-track="click_event_watch_provider" data-label="${esc(x.league + ":" + primary.key)}">▶ ${esc(primary.label)}</a>` : ""}<a class="wr-more" href="#/${x.league}">hub →</a></div>`; };
      view.innerHTML = `<div class="shell">
        ${pageHero("The Weekly Wrap", `Five minutes<br><em>with your coffee</em>.`, `The week from Armchair Experts — the episodes, the games worth your time, the stories, and what's coming. Assembled ${timeAgoShort(w.generated)}.`)}
        <div class="wr-actions"><button class="watch ghost" id="wr-share">Share this wrap</button><a class="watch ghost" href="#/leagues" data-track="click_follow_platform" data-label="newsletter">✉ Get it by email (coming soon)</a></div>
        <div class="section-h" style="margin-top:28px">This week's episodes</div>
        <div class="ep-grid">${w.episodes.map((e) => episodeCard(e)).join("")}</div>
        <div class="section-h" style="margin-top:30px">Worth watching this week</div>
        <div class="wr-games">${w.games.map(gameRow).join("")}</div>
        <div class="section-h" style="margin-top:30px">The stories</div>
        <div class="wr-news">${w.news.map((n) => `<div class="wr-newscol"><div class="ldr-h">${esc(n.name)}</div>${n.stories.map((s) => `<a class="wr-story" href="${esc(s.link)}" target="_blank" rel="noopener">${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : ""}<span><b>${esc(s.headline)}</b><i>${esc(s.source || "")}</i></span></a>`).join("")}</div>`).join("")}</div>
        <div class="section-h" style="margin-top:30px">Coming up</div>
        <div class="cal-row">${w.events.map((e) => { const k = fmt(e.time); return `<a class="cal-card" href="${esc(e.href || "#/leagues")}"><span class="cal-when">${esc(k.wd)} ${esc(k.day)}</span><b>${esc(e.name)}</b><i>${esc(e.code || "")}</i></a>`; }).join("")}</div>
        ${followStrip(w.platforms, true)}
      </div>`;
      $("wr-share")?.addEventListener("click", () => share("The Weekly Wrap — Armchair Experts", `${SITE}/wrap`, "share_wrap"));
      track("view_wrap");
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't assemble the wrap (${esc(err.message)}). <a href="#/wrap" onclick="location.reload()">Try again</a>.</div></div>`;
    }
  }

  // ---------- PEOPLE: hosts and guests ----------
  async function showPeople() {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Loading…</div></div>`;
    try {
      const d = await fetchJSON("/api/people");
      const hosts = d.people.filter((p) => p.kind === "host"), guests = d.people.filter((p) => p.kind === "guest");
      const av = (p, big) => p.photo ? `<img class="ppl-av${big ? " big" : ""} photo" src="${esc(p.photo)}" alt="${esc(p.name)}">` : `<span class="ppl-av${big ? " big" : ""}">${esc(p.name.split(" ").map((x) => x[0]).join("").slice(0, 2))}</span>`;
      const card = (p) => `<a class="ppl-card" href="#/people/${esc(p.slug)}">${av(p)}<span><b>${esc(p.name)}</b><i>${esc(p.role || (p.kind === "guest" ? "Guest" : ""))}</i><em>${p.episodes.length} episode${p.episodes.length === 1 ? "" : "s"}</em></span></a>`;
      view.innerHTML = `<div class="shell">
        ${pageHero("The people", `Hosts &amp; <em>guests</em>.`, "The voices on the show — and the people who've sat in the guest chair.")}
        <div class="section-h" style="margin-top:22px">The hosts</div><div class="ppl-grid">${hosts.map(card).join("")}</div>
        <div class="section-h" style="margin-top:28px">Guests <span class="n">· from the interview series</span></div><div class="ppl-grid">${guests.map(card).join("")}</div>
      </div>`;
      track("view_people");
    } catch (err) { view.innerHTML = `<div class="shell"><div class="loading">Couldn't load (${esc(err.message)}).</div></div>`; }
  }
  async function showPerson(slug) {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Loading…</div></div>`;
    try {
      const d = await fetchJSON("/api/people/" + encodeURIComponent(slug));
      const p = d.person;
      document.title = `${p.name} — Armchair Experts`;
      view.innerHTML = `
        <div class="team-hero ep-hero"><div class="shell">
          <a class="crumb" href="#/people">← Hosts &amp; guests</a>
          <div class="th-row">${p.photo ? `<img class="ppl-av big photo" src="${esc(p.photo)}" alt="${esc(p.name)}">` : `<span class="ppl-av big">${esc(p.name.split(" ").map((x) => x[0]).join("").slice(0, 2))}</span>`}
            <div><div class="th-loc">${esc(p.kind === "host" ? "Host" : "Guest")}${p.role ? " · " + esc(p.role) : ""}</div><h1 class="th-name">${esc(p.name)}</h1>${p.bio ? `<div class="th-meta">${esc(p.bio)}</div>` : ""}
              <div class="hh-actions"><button class="watch ghost" id="pp-share">Share</button></div></div></div>
        </div></div>
        <div class="shell">
          <div class="section-h" style="margin-top:24px">${p.kind === "host" ? "Episodes" : "On the show"} <span class="n">· ${d.episodes.length}</span></div>
          <div class="ep-grid">${d.episodes.map((e) => episodeCard(e)).join("")}</div>
          ${followStrip(d.platforms, true)}
        </div>`;
      $("pp-share")?.addEventListener("click", () => share(`${p.name} — Armchair Experts`, `${SITE}/people/${p.slug}`, "share_person"));
      track("view_person", p.slug);
    } catch (err) { view.innerHTML = `<div class="shell"><div class="loading">Couldn't load (${esc(err.message)}). <a href="#/people">All people →</a></div></div>`; }
  }

  // ---------- CLIPS: everything on the channel, newest first ----------
  async function showClips() {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Loading clips…</div></div>`;
    try {
      const d = await fetchJSON("/api/videos");
      const vids = d.videos || [];
      view.innerHTML = `<div class="shell">
        ${pageHero("Clips & video", `Straight from <em>the channel</em>.`, "Every upload from the Armchair Experts YouTube channel — episodes, interviews and clips — playable here.")}
        <div class="vid-rail wrap">${vids.map((v) => `<a class="vid-card" href="#/watch/${esc(v.id)}" data-track="click_watch_video" data-label="${esc(v.id)}"><span class="vc-thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span class="vc-play">▶</span></span><span class="vc-t">${esc(v.title)}</span><span class="vc-m">${timeAgo(v.published)}${v.views ? " · " + v.views.toLocaleString() + " views" : ""}${v.league ? " · " + esc(v.league.toUpperCase()) : ""}</span></a>`).join("")}</div>
        <p class="panel-note" style="margin-top:12px">Source: the channel's public feed (latest ${vids.length}) — a new upload appears here within 15 minutes.</p>
      </div>`;
      track("view_clips");
    } catch (err) { view.innerHTML = `<div class="shell"><div class="loading">Couldn't load clips (${esc(err.message)}).</div></div>`; }
  }

  // =====================================================================
  // WHAT TO WATCH (hub)
  // =====================================================================

  const hubHTML = () => `
    ${nflSubnav("watch")}
    <div class="ribbon">
      <div class="shell">
        <button class="wknav" id="wk-prev" aria-label="Previous week">‹</button>
        <span class="wk" id="wk-label">Loading…</span>
        <button class="wknav" id="wk-next" aria-label="Next week">›</button>
        <span class="sub" id="ribbon-sub">Every game, your kick-off time, one tap to stream.</span>
      </div>
    </div>
    <div class="ticker" id="ticker" hidden>
      <span class="tk-label">Headlines</span>
      <div class="tk-win"><div class="tk-track" id="tk-track"></div></div>
    </div>
    <div class="shell">
      <div id="loading" class="loading">Fetching the live slate…</div>
      <div id="content" hidden>
        <div class="hero-split${league === "nfl" ? "" : " hero-solo"}">
          <section id="lead"></section>
          ${league === "nfl" ? '<section id="rtg"></section>' : ""}
        </div>
        ${league === "nfl" ? '<section id="rtg-rail"></section>' : ""}
        <section id="vid-wrap"></section>
        <section id="news-wrap" hidden>
          <div class="section-h" style="margin-top:28px">The Big Stories <span class="n" id="news-note">· live from the wires</span></div>
          <div class="news-cols">
            <div class="news-grid" id="news"></div>
            <aside class="top5" id="top5"></aside>
          </div>
        </section>
        ${league === "afl" ? '<section id="finals-top" hidden></section>' : ""}
        ${league !== "nfl" ? '<section id="ladder-wrap" hidden></section>' : ""}
        ${league === "afl" ? '<section id="finals-wrap" hidden></section>' : ""}
        ${league === "afl" ? '<section id="form-wrap" hidden></section>' : ""}
        <div class="section-h" style="margin-top:30px">Game of the Week</div>
        <section class="gotw" id="gotw"></section>
        <div class="section-h" style="margin-top:30px">The Slate <span class="n" id="slate-count"></span></div>
        <div class="controls">
          <div class="seg" role="group" aria-label="Timezone">
            <span class="k">Times</span>
            <button data-tz="Australia/Sydney">Sydney</button>
            <button data-tz="Australia/Brisbane">Brisbane</button>
            <button data-tz="Australia/Perth">Perth</button>
          </div>
          <div class="seg" role="group" aria-label="Sort">
            <span class="k">Sort</span>
            <button data-sort="watch">Watchability</button>
            <button data-sort="time">Kick-off</button>
          </div>
          <span class="ctl-note" id="tz-note"></span>
          <a class="ctl-saved" href="#/saved" title="Games saved on this device">★ Saved</a>
        </div>
        <div class="slate" id="slate"></div>
        ${["nfl", "nba", "mlb", "cfb"].includes(league) ? `<div class="section-h" style="margin-top:32px">Aussies in ${league === "cfb" ? "College Football" : "the " + league.toUpperCase()} <span class="n" id="aus-note">· this week</span></div>
        <div class="aus" id="aus"></div>` : ""}

      </div>
    </div>`;

  // ---------- Road to the G (the deck's centrepiece, live from the feed) ----------
  let rtgTimer = null;

  function rtgStage(kick) {
    const now = Date.now(), t = new Date(kick).getTime();
    if (now > t + 4 * 864e5) return 2;               // wrap up
    if (now > t - 7 * 864e5) return 1;               // game week
    return 0;                                        // build up
  }

  function adventRailHTML(s) {
    if (!s || !(s.episodes || []).length) return "";
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
    return `<div class="rtg-rail">
      <div class="rtg-rail-h"><b class="rtg-rail-t">THE 10-DAY COUNTDOWN</b> — ${esc(s.sub || "")}</div>
      <div class="rtg-eps">
        ${s.episodes.map((e) => {
          const state = !e.drop ? "open" : (e.drop < today ? "open" : (e.drop === today ? "today" : "locked"));
          const dropLbl = e.drop ? "SEP " + parseInt(e.drop.slice(-2), 10) : "";
          const clickable = e.url && state !== "locked";
          const foot = state === "locked" ? "🔒 Unlocks " + dropLbl.replace("SEP", "Sep")
                     : state === "today" ? "● TODAY'S DROP" + (e.url ? " · ▶ Watch" : "")
                     : (e.url ? "▶ Watch" : "Out now · link soon");
          return `<a class="rtg-ep adv-${state}${clickable ? "" : " soon"}"
            ${clickable ? `href="${esc(e.url)}" target="_blank" rel="noopener"` : ""}>
            <span class="adv-d">${esc(dropLbl)}</span>
            <span class="n">EP ${esc(e.n)}</span>
            <span class="t">${esc(e.title)}</span>
            <span class="g">${esc(e.guest)}</span>
            <span class="s">${foot}</span>
          </a>`;
        }).join("")}
      </div>
    </div>`;
  }

  function renderRtg(rtg) {
    const el = $("rtg");
    if (!el) return;
    const hasEps = rtg && rtg.series && (rtg.series.episodes || []).length;
    if (!rtg || (!rtg.game && !hasEps)) { el.innerHTML = ""; return; }
    if (!rtg.game) {
      // feed hiccup: keep the advent countdown alive without the game banner
      el.innerHTML = `<div class="rtg">
        <div class="rtg-top"><span class="rtg-ey">🏟 ${esc(rtg.series.title || "Cali to the 'G")}</span></div>
        ${adventRailHTML(rtg.series)}
      </div>`;
      return;
    }
    const g = rtg.game, s = rtg.series || {};
    const stage = rtgStage(g.date);
    const stages = ["Build up", "Game week", "Wrap up"];
    const k = fmt(g.date);
    const mel = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Australia/Melbourne" }).format(new Date(g.date));
    const done = g.status.completed;
    const live = g.status.state === "in";

    let centre;
    if (done) {
      centre = `<div class="rtg-count"><div class="rtg-score tnum">${esc(g.away.abbr)} ${esc(g.away.score ?? "")} — ${esc(g.home.score ?? "")} ${esc(g.home.abbr)}</div><div class="rtg-cd-lbl">Final · history made at the G</div></div>`;
    } else if (live) {
      centre = `<div class="rtg-count"><div class="rtg-score"><span class="badge-live">● Live</span> ${esc(g.status.detail)}</div><div class="rtg-cd-lbl">The NFL is at the MCG right now</div></div>`;
    } else {
      centre = `<div class="rtg-count" data-kick="${esc(g.date)}">
        <div class="rtg-cd tnum" id="rtg-cd">—</div>
        <div class="rtg-cd-lbl">until kick-off · ${esc(mel)} AEST</div>
      </div>`;
    }

    el.innerHTML = `
      <div class="rtg rtg-tall">
        <div class="rtg-top">
          <span class="rtg-ey">🏟 ${esc(s.title || "Cali to the 'G")}</span>
        </div>
        ${(() => {
          const fa = g.faces && g.faces[g.away.abbr], fh = g.faces && g.faces[g.home.abbr];
          if (fa && fh) return `
        <div class="versus">
          <div class="vs-side">
            <img class="vs-face" src="${esc(fa.headshot)}" alt="${esc(fa.name)}">
            <span class="vs-nm">${esc(fa.name)}</span>
            <img class="vs-logo" src="${esc(g.away.logo)}" alt="">
          </div>
          <span class="vs-x">VS</span>
          <div class="vs-side">
            <img class="vs-face" src="${esc(fh.headshot)}" alt="${esc(fh.name)}">
            <span class="vs-nm">${esc(fh.name)}</span>
            <img class="vs-logo" src="${esc(g.home.logo)}" alt="">
          </div>
        </div>`;
          return "";
        })()}
        <div class="rtg-stack">
          ${!(g.faces && g.faces[g.away.abbr] && g.faces[g.home.abbr]) ? `<div class="rtg-mu">
            <img src="${esc(g.away.logo)}" alt="${esc(g.away.displayName)}">
            <span class="vs">vs</span>
            <img src="${esc(g.home.logo)}" alt="${esc(g.home.displayName)}">
          </div>` : ""}
          <div class="rtg-names">
            <div class="rtg-nm">${esc(g.away.name)} vs ${esc(g.home.name)}</div>
            <div class="rtg-venue">${esc(g.venue)} · the NFL's first game in Australia</div>
          </div>
          ${centre}
          <div class="watch-row">
            <a class="watch" target="_blank" rel="noopener" data-watch="${esc(g.away.abbr)}@${esc(g.home.abbr)}" data-plat="7plus"
               href="https://7plus.com.au/nfl?utm_source=armchair&utm_medium=rtg&utm_campaign=mcg">
               <span class="tv">▶</span> ${done ? "Replay free on 7plus" : "Watch it free on Seven · 7plus"}</a>
            <span class="watch-also">also on ${WATCH.nfl.slice(1).map((w) => `<a href="${esc(w.url)}" target="_blank" rel="noopener" data-watch="${esc(g.away.abbr)}@${esc(g.home.abbr)}" data-plat="${esc(w.key)}">${esc(w.label)}</a>`).join(" · ")}</span>
          </div>
          <div class="rtg-your-tz">${k.wd} ${k.day} · ${k.tm} ${TZ_LABEL[tz]}</div>
          <div class="rtg-arc">${stages.map((x, i) => `<b class="${i === stage ? "on" : ""}">${x}</b>`).join("<i>→</i>")}</div>
        </div>
      </div>`;
    const rail = $("rtg-rail");
    if (rail) rail.innerHTML = `<div class="rtg rtg-railonly">${adventRailHTML(s)}</div>`;

    bindWatch(el);
    clearInterval(rtgTimer);
    const cd = $("rtg-cd");
    if (cd) {
      const tick = () => {
        const ms = new Date(g.date).getTime() - Date.now();
        if (ms <= 0) { cd.textContent = "KICK-OFF"; clearInterval(rtgTimer); return; }
        const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5),
              m = Math.floor(ms % 36e5 / 6e4), sec = Math.floor(ms % 6e4 / 1e3);
        cd.textContent = `${d}d ${h}h ${m}m ${String(sec).padStart(2, "0")}s`;
      };
      tick();
      rtgTimer = setInterval(tick, 1000);
    }
  }

  // ---------- lead story (image-led, auto-rotating) ----------
  let leadTimer = null, leadIdx = 0, leadStories = [];

  function paintLead() {
    const el = $("lead");
    if (!el || !leadStories.length) return;
    const s = leadStories[leadIdx];
    el.innerHTML = `
      <a class="lead" href="${esc(s.link)}" target="_blank" rel="noopener">
        <img class="lead-img" src="${esc(s.image)}" alt="">
        <div class="lead-scrim"></div>
        <div class="lead-body">
          <span class="lead-tag">● Top story</span>
          <h2 class="lead-h">${esc(s.headline)}</h2>
          ${s.description ? `<p class="lead-d">${esc(s.description)}</p>` : ""}
          <span class="lead-src">${esc(s.source || "")} · read the story →</span>
        </div>
      </a>
      <div class="lead-dots">
        ${leadStories.map((_, i) => `<button class="lead-dot${i === leadIdx ? " on" : ""}" data-lead="${i}" aria-label="Story ${i + 1}"></button>`).join("")}
      </div>`;
    el.querySelectorAll("[data-lead]").forEach((b) => {
      b.addEventListener("click", () => {
        leadIdx = +b.getAttribute("data-lead");
        clearInterval(leadTimer);
        paintLead();
        leadTimer = setInterval(rotateLead, 7000);
      });
    });
  }

  function rotateLead() {
    if (!leadStories.length) return;
    leadIdx = (leadIdx + 1) % leadStories.length;
    paintLead();
  }

  function renderLead(featured) {
    clearInterval(leadTimer);
    leadStories = (featured && featured.stories) || [];
    leadIdx = 0;
    if (!leadStories.length) { const el = $("lead"); if (el) el.innerHTML = ""; return; }
    paintLead();
    leadTimer = setInterval(rotateLead, 7000);
  }

  // The case for watching, in order of what actually matters in the sport.
  // The Aussie angle is a footnote, not the headline — the game leads.
  function why(g) {
    // plain language — no lines, totals or betting shorthand
    const bits = [];
    const sp = g.odds && g.odds.spread != null ? Math.abs(g.odds.spread) : null;
    const ou = g.odds && g.odds.overUnder;
    const hot = (r) => { const [w, l] = (r || "0-0").split("-").map(Number); return w + l > 0 && w / (w + l) >= 0.65; };
    const cold = (r) => { const [w, l] = (r || "0-0").split("-").map(Number); return w + l > 2 && w / (w + l) <= 0.3; };
    if (g.status.state === "in") bits.push("live right now — " + g.status.detail);
    if (hot(g.home.record) && hot(g.away.record)) bits.push("two of the form teams in the league");
    else if (hot(g.home.record) || hot(g.away.record)) bits.push("one of the form teams is playing");
    if (sp !== null && sp <= 2.5) bits.push("expected to go down to the wire");
    else if (sp !== null && sp <= 4.5) bits.push("should be close");
    else if (sp !== null && sp >= 10) bits.push("one side is heavily favoured — an upset would be the story");
    if (ou && ou >= 48) bits.push("both teams like to score");
    if (/NFL Kickoff/.test(g.slot)) bits.push("the season opener, the only game on");
    else if (/Night Football/.test(g.slot)) bits.push("the prime-time game");
    else if (/Night/.test(g.slot) && league !== "nfl") bits.push("the night game");
    if (league === "afl" && hubData && hubData.week && hubData.week.number >= 22) bits.push("finals places on the line");
    if (league === "nrl" && hubData && hubData.week && hubData.week.number >= 24) bits.push("the run to the finals");
    if (!bits.length) bits.push(cold(g.home.record) && cold(g.away.record) ? "one for the completists" : "a solid game if you're around");
    let s = bits.join(" · ");
    s = s.charAt(0).toUpperCase() + s.slice(1) + ".";
    if (g.aussies.length) s += ` <span class="aus-note">🇦🇺 ${esc(g.aussies.map((a) => a.name).join(" & "))}</span>`;
    return s;
  }

  function teamHTML(t, big, showScore) {
    const score = showScore && t.score != null ? ` <span class="sc tnum">${esc(t.score)}</span>` : "";
    return `<a class="team" href="#/${league}/team/${esc(t.abbr)}">
      <img class="logo${big ? "" : " sm"}" src="${esc(t.logo)}" alt="${esc(t.displayName)} logo" loading="lazy">
      <div><div class="nm">${esc(t.name)}</div><div class="rec">${esc(t.record)}${score}</div></div>
    </a>`;
  }

  function meter(g) {
    if (g.homeWinProb == null) return "";
    const hp = Math.round(g.homeWinProb * 100), ap = 100 - hp;
    const hc = "#" + (g.home.color || "555"), ac = "#" + (g.away.color || "999");
    return `<div class="meter">
      <div class="lab"><span>${esc(g.away.abbr)} win</span><span>${esc(g.home.abbr)} win</span></div>
      <div class="bar"><span style="width:${ap}%;background:${ac}"></span><span style="width:${hp}%;background:${hc}"></span></div>
      <div class="pct"><span class="tnum">${ap}%</span><span class="tnum">${hp}%</span></div>
    </div>`;
  }

  function watchBtn(g, cls) {
    const wk = hubData && hubData.week ? hubData.week.number : "";
    const opts = watchOpts();
    const utm = `utm_source=armchair&utm_medium=wtw&utm_campaign=week${wk}&utm_content=${g.away.abbr}@${g.home.abbr}`;
    const verb = g.status.state === "post" ? "Replay" : "Watch";
    // confirmed for THIS game only where the provider carries every game (or the game is
    // known FTA, e.g. the MCG); everything else is "also available" — never over-claimed
    const primary = (g.ftaConfirmed && opts.find((w) => w.free)) || opts.find((w) => w.every) || opts[0];
    const rest = opts.filter((w) => w !== primary);
    const confirmed = !!primary.every || !!g.ftaConfirmed;
    return `<span class="watch-row">
      <a class="watch ${cls || ""}" target="_blank" rel="noopener" data-plat="${esc(primary.key)}" data-track="click_event_watch_provider" data-label="${esc(league + ":" + primary.key)}"
        href="${esc(primary.url)}${primary.url.includes("?") ? "&" : "?"}${utm}" data-watch="${esc(g.away.abbr)}@${esc(g.home.abbr)}">
        <span class="tv">▶</span> ${verb} on ${esc(primary.label)}</a>
      ${rest.map((w) => `<a class="watch-chip${w.free ? " free" : ""}" target="_blank" rel="noopener" data-plat="${esc(w.key)}" data-track="click_event_watch_provider" data-label="${esc(league + ":" + w.key)}" title="${esc(w.label)} · ${esc(w.sub)}"
        href="${esc(w.url)}${w.url.includes("?") ? "&" : "?"}${utm}" data-watch="${esc(g.away.abbr)}@${esc(g.home.abbr)}">${esc(w.label)}${w.free ? " · free" : ""}</a>`).join("")}
      <span class="prov-note">${confirmed ? "confirmed" : "provider for this game TBC"}${rest.some((w) => w.free) ? " · free-to-air shows selected games" : ""}</span>
    </span>`;
  }

  function statusBadge(g) {
    if (g.status.state === "in") return `<span class="badge-live">● Live</span>`;
    if (g.status.state === "post") return `<span class="badge-final">Final</span>`;
    return `<span class="tier t${g.watch.tier}">${TIER_LABEL[g.watch.tier]}</span>`;
  }

  function isExpertsPick(g) {
    return hubData.experts && hubData.experts.gotw === g.id;
  }

  function expertCallHTML(g) {
    if (!g.expertCall) return "";
    const hosts = (hubData.experts && hubData.experts.show && hubData.experts.show.hosts) || "The Experts";
    return `<blockquote class="ec">🎙 <span>${esc(g.expertCall)}</span><cite>— ${esc(hosts)}</cite></blockquote>`;
  }

  function renderGotw() {
    // the voice leads: the Experts' pick takes the marquee slot when they've made one
    const expertsPick = hubData.experts && hubData.games.find((x) => x.id === hubData.experts.gotw && x.status.state !== "post");
    const g = expertsPick || hubData.games.find((x) => x.id === hubData.gotw) || hubData.games[0];
    if (!g) { $("gotw").innerHTML = ""; return; }
    const k = fmt(g.date);
    const showScore = g.status.state !== "pre";
    $("gotw").innerHTML = `
      <div class="ey">★ Marquee · ${TZ_LABEL[tz]} prime viewing${isExpertsPick(g) ? ` · <span class="ec-badge">🎙 The Experts' pick</span>` : ""}</div>
      <div class="body">
        <div>
          <div class="matchup">${teamHTML(g.away, true, showScore)}<span class="at">at</span>${teamHTML(g.home, true, showScore)}</div>
          <p class="why">${why(g)}</p>
          ${expertCallHTML(g)}
          ${meter(g)}
          <div class="h2h" id="gotw-h2h" data-h2h="${esc(g.id)}"></div>
        </div>
        <div class="kick">
          <div>
            <div class="when">${k.wd} ${k.day}</div>
            <div class="big tnum">${k.tm}</div>
            <div class="slot">${esc(g.slot)}${g.broadcast ? " · " + esc(g.broadcast) : ""} · ${TZ_LABEL[tz]}</div>
          </div>
          ${watchBtn(g)}
        </div>
      </div>`;
    bindWatch($("gotw"));
    if (H2H_LEAGUES.includes(league)) loadH2H(g, $("gotw-h2h"), true).then(() => loadInjuries(g, $("gotw-h2h")));
  }

  // ---------- availability / injuries (NFL, NBA, MLB publish them) ----------
  const INJ_LEAGUES = ["nfl", "nba", "mlb"];
  const injCls = (st) => /out|ir|injured|60|reserve|suspend/i.test(st) ? "out" : /doubt|questionable|day-to-day|10-day|15-day|gtd/i.test(st) ? "q" : "";
  function injuriesHTML(teams, max) {
    const blocks = (teams || []).filter((tm) => tm.players && tm.players.length);
    if (!blocks.length) return "";
    return `<div class="inj"><span class="h2h-l">Availability</span>
      ${blocks.map((tm) => `<div class="inj-team"><b>${tm.logo ? `<img src="${esc(tm.logo)}" alt="">` : ""}${esc(tm.abbr || tm.name)}</b>
        ${tm.players.slice(0, max || 4).map((p) => `<span class="inj-row"><i class="inj-st ${injCls(p.status)}">${esc(p.status)}</i><span>${esc(p.name)}${p.pos ? ` <em>${esc(p.pos)}</em>` : ""}${p.injury ? ` · ${esc(p.injury)}` : ""}${p.returnDate ? ` · back ${esc(fmt(p.returnDate).day)}` : ""}</span></span>`).join("")}
        ${tm.players.length > (max || 4) ? `<span class="inj-more">+${tm.players.length - (max || 4)} more on the report</span>` : ""}</div>`).join("")}
      <span class="h2h-note">Source ESPN · injury reports change through the week</span></div>`;
  }
  async function loadInjuries(g, el) {
    if (!el || !INJ_LEAGUES.includes(league)) return;
    try {
      const d = await fetchJSON(`/api/injuries?league=${league}&event=${encodeURIComponent(g.id)}`);
      const html = injuriesHTML(d.teams, 4);
      if (html) { el.insertAdjacentHTML("beforeend", html); track("view_injuries", `${league}:${g.id}`); }
    } catch { /* quiet — availability is a bonus, not a blocker */ }
  }

  // ---------- head-to-head: recent meetings between the two clubs ----------
  const H2H_LEAGUES = ["nfl", "afl", "nrl", "nba", "mlb", "epl", "cfb"];
  async function loadH2H(g, el, auto) {
    if (!el) return;
    el.innerHTML = `<span class="h2h-l">Head-to-head</span><span class="h2h-note">loading…</span>`;
    try {
      const d = await fetchJSON(`/api/h2h?league=${league}&home=${encodeURIComponent(g.home.abbr)}&away=${encodeURIComponent(g.away.abbr)}&event=${encodeURIComponent(g.id)}`);
      const ms = d.meetings || [];
      if (!ms.length) { el.innerHTML = auto ? "" : `<span class="h2h-l">Head-to-head</span><span class="h2h-note">no recent meetings on record</span>`; return; }
      el.innerHTML = `<span class="h2h-l">Head-to-head</span>${d.headline ? `<b class="h2h-hd">${esc(d.headline)}</b>` : ""}
        <div class="h2h-rows">${ms.map((m) => { const k = fmt(m.date); const hw = +m.home.score > +m.away.score, aw = +m.away.score > +m.home.score;
          return `<span class="h2h-row"><i>${esc(k.day)} ${new Date(m.date).getFullYear()}</i><span class="${aw ? "won" : ""}">${m.away.logo ? `<img src="${esc(m.away.logo)}" alt="">` : ""}${esc(m.away.name)}</span><em class="tnum">${esc(m.away.score ?? "")}–${esc(m.home.score ?? "")}</em><span class="${hw ? "won" : ""}">${esc(m.home.name)}${m.home.logo ? `<img src="${esc(m.home.logo)}" alt="">` : ""}</span></span>`; }).join("")}</div>`;
      track("view_h2h", `${league}:${g.away.abbr}@${g.home.abbr}`);
    } catch { el.innerHTML = auto ? "" : `<span class="h2h-l">Head-to-head</span><span class="h2h-note">unavailable right now</span>`; }
  }

  function renderSlate() {
    let list = hubData.games.slice();
    if (sort === "watch") list.sort((a, b) => b.watch.score - a.watch.score || new Date(a.date) - new Date(b.date));
    else list.sort((a, b) => new Date(a.date) - new Date(b.date));

    const starred = new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]"));
    $("slate").innerHTML = list.map((g) => {
      const k = fmt(g.date);
      const showScore = g.status.state !== "pre";
      const aus = `<span></span>`;  // the Aussie note now rides quietly inside why()
      const on = starred.has(g.id);
      return `<article class="game" data-id="${esc(g.id)}">
        <div class="top">
          <span class="badges">${statusBadge(g)}${isExpertsPick(g) ? `<span class="ec-badge">🎙 Experts' pick</span>` : ""}</span>
          <button class="star" data-star="${esc(g.id)}" aria-pressed="${on}" title="${on ? "Saved on this device" : "Save this game on this device"}" aria-label="${on ? "Saved on this device" : "Save this game"}">${on ? "★" : "☆"}</button>
        </div>
        <div class="mu">${teamHTML(g.away, false, showScore)}<span class="at">at</span>${teamHTML(g.home, false, showScore)}</div>
        ${meter(g)}
        <div class="row">
          <div class="whenwrap"><span class="when tnum">${k.wd} ${k.day} · ${k.tm}</span><span class="slot">${esc(g.slot)}${g.broadcast ? " · " + esc(g.broadcast) : ""}</span></div>
        </div>
        <p class="why">${why(g)}</p>
        ${expertCallHTML(g)}
        ${H2H_LEAGUES.includes(league) ? `<button class="h2h-btn" data-h2h-btn="${esc(g.id)}" aria-expanded="false">${INJ_LEAGUES.includes(league) ? "Head-to-head &amp; availability" : "Head-to-head"} ▾</button><div class="h2h" data-h2h="${esc(g.id)}" hidden></div>` : ""}
        <div class="foot">${aus}${watchBtn(g, "sm ghost")}</div>
      </article>`;
    }).join("");
    $("slate").querySelectorAll("[data-h2h-btn]").forEach((b) => b.addEventListener("click", () => {
      const id = b.getAttribute("data-h2h-btn"); const box = $("slate").querySelector(`.h2h[data-h2h="${CSS.escape(id)}"]`); const g = hubData.games.find((x) => String(x.id) === id);
      const open = box.hidden; box.hidden = !open; b.setAttribute("aria-expanded", String(open)); b.textContent = (INJ_LEAGUES.includes(league) ? "Head-to-head & availability " : "Head-to-head ") + (open ? "▴" : "▾");
      if (open && g && !box.dataset.loaded) { box.dataset.loaded = "1"; loadH2H(g, box, false).then(() => loadInjuries(g, box)); }
    }));
    $("slate-count").textContent = "· " + list.length + (list.length === 1 ? " game" : " games");
    bindStars();
    bindWatch($("slate"));
  }

  function renderAussies() {
    if (!$("aus")) return;
    const byTeam = {};
    hubData.games.forEach((g) => {
      [g.home.abbr, g.away.abbr].forEach((ab) => { byTeam[ab] = g; });
    });
    const playing = [], off = [];
    aussies.forEach((p) => (byTeam[p.team] ? playing : off).push(p));
    const logoOf = (ab) => {
      const g = byTeam[ab];
      if (!g) return league === "cfb" ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${ab}.png` : `https://a.espncdn.com/i/teamlogos/${league === "nfl" ? "nfl" : league}/500/scoreboard/${ab.toLowerCase()}.png`;
      return g.home.abbr === ab ? g.home.logo : g.away.logo;
    };
    const card = (p) => {
      const g = byTeam[p.team];
      let ctx = league === "nba" || league === "mlb" ? "No game today" : "No game this week";
      if (g) {
        const opp = g.home.abbr === p.team ? "vs " + g.away.name : "at " + g.home.name;
        const k = fmt(g.date);
        ctx = `${opp} · ${k.wd} ${k.tm}`;
      }
      return `<div class="p">
        <div class="pos"><img src="${logoOf(p.team)}" alt="" loading="lazy">🇦🇺 ${esc(p.pos)} · ${esc(p.teamCode || p.team)}</div>
        <div class="pn">${esc(p.name)}</div>
        <div class="pt">${esc(ctx)}</div>
        <div class="pg">${esc(p.hook || (p.from ? "From " + p.from : ""))}</div>
      </div>`;
    };
    const list = playing.concat(off).slice(0, league === "nfl" ? 8 : 12);
    $("aus").innerHTML = list.map(card).join("");
    $("aus-note").textContent = playing.length ? "· this week" : "· off-week";
  }

  function timeAgo(pub) {
    const ms = Date.now() - new Date(pub).getTime();
    if (!isFinite(ms) || ms < 0) return "";
    const h = Math.floor(ms / 36e5);
    if (h < 1) return Math.max(1, Math.floor(ms / 6e4)) + "m ago";
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  function renderNews(featured) {
    const wrap = $("news-wrap");
    const stories = (featured && featured.more) || [];
    if (!stories.length) { wrap.hidden = true; return; }
    const pool = [...((featured && featured.stories) || []), ...stories];
    const top5 = pool.slice(0, 5);
    const t5 = $("top5");
    if (t5) t5.innerHTML = `<div class="t5-h">Top stories</div>` + top5.map((s, i) => `
      <a class="t5-item rev" href="${esc(s.link)}" target="_blank" rel="noopener">
        <span class="t5-n">${i + 1}</span>
        <span class="t5-body">
          <span class="t5-t">${esc(s.headline)}</span>
          <span class="t5-m">${esc(s.source || "")}</span>
        </span>
      </a>`).join("");
    $("news").innerHTML = stories.map((s) => `
      <a class="story${s.image ? "" : " no-art"}" href="${esc(s.link)}" target="_blank" rel="noopener">
        ${s.image ? `<span class="st-img"><img src="${esc(s.image)}" alt="" loading="lazy"></span>` : ""}
        <span class="st-body">
          <span class="st-t">${esc(s.headline)}</span>
          <span class="st-m">${esc(s.source || "")}${s.published ? " · " + timeAgo(s.published) : ""}</span>
        </span>
      </a>`).join("");
    const note = $("news-note");
    if (note && featured.outlets && featured.outlets.length) {
      note.textContent = `· ${featured.count} stories from ${featured.outlets.length}+ outlets`;
      note.title = featured.outlets.join(" · ");
    }
    const tk = $("ticker"), track = $("tk-track");
    if (tk && track) {
      const tkPool = pool.slice(0, 12);
      const run = tkPool.map((s) =>
        `<a class="tk-item" href="${esc(s.link)}" target="_blank" rel="noopener"><b>${esc((s.source || "wire").toUpperCase())}</b>${esc(s.headline)}</a><span class="tk-dot">\u25cf</span>`).join("");
      // the run is doubled so translateX(-50%) loops without a visible seam
      track.innerHTML = `<div class="tk-run">${run}</div><div class="tk-run" aria-hidden="true">${run}</div>`;
      track.style.setProperty("--tk-dur", Math.max(45, tkPool.length * 7) + "s");
      tk.hidden = false;
    }
    wrap.hidden = false;
  }

  // ---------- the ladder (AFL / NBL) — full table, finals + wildcard lines ----------
  // 2026 finals: the top six go straight through with the week off; 7th-10th
  // play the wildcard round (7v10, 8v9) for the last two spots in the eight.
  let leadersData = null, leadersSeason = null;

  function renderLadder(lad, leaders) {
    const wrap = $("ladder-wrap");
    if (!wrap) return;
    const rows = (lad && lad.ladder) || [];
    if (!rows.length) { wrap.hidden = true; return; }
    if (lad.groups && lad.groups.length) {
      // conference tables (NBA): playoffs line after 6, play-in after 10, per conference
      const linesG = {}; (lad.lines || []).forEach((l) => { linesG[l.after] = l; });
      const rowG = (r) => `
        <a class="lad-row${r.rank <= 6 ? " in-six" : (r.rank <= 10 && league === "nba") ? " in-wild" : ""}" href="#/${league}/team/${esc(r.abbr)}">
          <span class="lad-pos tnum">${r.rank}</span>
          <img class="lad-logo" src="${esc(r.logo || "")}" alt="" loading="lazy">
          <span class="lad-team">${esc(r.name)}</span>
          <span class="lad-rec tnum">${esc(r.wins)}–${esc(r.losses)}</span>
          <span class="lad-pct tnum">${esc(r.pct)}</span>
          <span></span><span></span>
        </a>${linesG[r.rank] ? `<div class="lad-cut ${esc(linesG[r.rank].kind)}"><span>${esc(linesG[r.rank].label)}</span></div>` : ""}`;
      wrap.innerHTML = `
        <div class="section-h" style="margin-top:30px">The Standings <span class="n">${league === "mlb" ? "· top six in each league make the postseason" : "· top six straight to the playoffs · 7–10 play in"}</span></div>
        <div class="ladder">
          ${lad.groups.map((g) => `<div class="lad-col">
            <div class="lad-head"><span></span><span></span><span>${esc(g.name)}</span><span>W–L</span><span>Win%</span><span></span><span></span></div>
            ${g.ladder.map(rowG).join("")}
          </div>`).join("")}
        </div>`;
      wrap.hidden = false;
      return;
    }
    leadersData = leaders && (leaders.categories || []).length ? leaders.categories : null;
    leadersSeason = leaders && leaders.season ? leaders.season : null;
    const lines = {};
    (lad.lines || []).forEach((l) => { lines[l.after] = l; });
    const wildTo = Math.max(...(lad.lines || []).map((l) => l.after), 0);
    const pctLbl = league === "afl" ? "%" : league === "nrl" ? "+/−" : league === "epl" ? "GD" : league === "cfb" ? "1st votes" : "Win%";
    const formDots = (f) => f ? `<span class="lf">${[...f].map((c) =>
      `<i class="${c === "W" ? "w" : c === "L" ? "l" : "d"}" title="${c}"></i>`).join("")}</span>` : "<span></span>";
    const posCls = (r) => r.rank <= (league === "nrl" ? 8 : league === "epl" ? 4 : league === "cfb" ? 12 : 6) ? " in-six" : (r.rank <= wildTo && league === "afl" ? " in-wild" : (league === "epl" && r.rank >= 18 ? " in-wild" : ""));
    const rowHTML = (r) => `
      <a class="lad-row${posCls(r)}" href="#/${league}/team/${esc(r.abbr)}">
        <span class="lad-pos tnum">${r.rank}</span>
        <img class="lad-logo" src="${esc(r.logo || "")}" alt="" loading="lazy">
        <span class="lad-team">${esc(r.name)}</span>
        <span class="lad-rec tnum">${esc(r.wins)}–${esc(r.losses)}${r.draws && r.draws !== "0" ? "–" + esc(r.draws) : ""}</span>
        <span class="lad-pct tnum">${esc(r.pct)}</span>
        <span class="lad-pts tnum">${esc(r.points || "")}</span>
        ${formDots(r.form)}
      </a>${lines[r.rank] ? `<div class="lad-cut ${esc(lines[r.rank].kind)}"><span>${esc(lines[r.rank].label)}</span></div>` : ""}`;
    const sub = league === "afl" ? "· live · top 6 straight through · 7–10 play the wildcard round" : league === "nrl" ? "· live · top eight play finals" : league === "epl" ? "· live · top four to the Champions League · bottom three go down" : league === "cfb" ? "· the poll · twelve-team playoff" : "· live";
    const title = league === "epl" ? "The Table" : league === "cfb" ? (lad.poll || "AP Top 25") : "The Ladder";
    wrap.innerHTML = `
      <div class="section-h" style="margin-top:30px">${title} <span class="n">${sub}</span></div>
      <div class="lad-wrap${leadersData ? "" : " solo"}">
        <div class="lad-col">
          <div class="lad-head"><span></span><span></span><span>Club</span><span>W–L</span><span>${pctLbl}</span><span>Pts</span><span>${rows.some((r) => r.form) ? "Form" : ""}</span></div>
          ${rows.map(rowHTML).join("")}
        </div>
        ${leadersData ? `<aside class="ldr" id="ldr"></aside>` : ""}
      </div>`;
    if (leadersData) paintLeaders(leadersData[0].key);
    wrap.hidden = false;
  }

  // ---------- finals bracket: Wildcard → Qualifying/Elimination → Semis → Prelims → GF ----------
  // Projected from the live ladder until the AFL fixes the matches; once real
  // clubs land it takes the slot above the ladder and the ladder becomes history.
  function renderFinals(f) {
    const top = $("finals-top"), below = $("finals-wrap");
    if (!top || !below) return;
    const rounds = (f && f.rounds) || [];
    if (!rounds.length) { top.hidden = below.hidden = true; return; }
    const live = !!f.live;
    const host = live ? top : below;
    const other = live ? below : top;
    other.hidden = true; other.innerHTML = "";
    // match codes in the AFL's own order: WF1-2, QF1-2 + EF1-2, SF1-2, PF1-2, GF
    const code = (rn, i) => rn === 25 ? `WF${i + 1}` : rn === 26 ? (i < 2 ? `QF${i + 1}` : `EF${i - 1}`)
                        : rn === 27 ? `SF${i + 1}` : rn === 28 ? `PF${i + 1}` : "GF";
    const seedLbl = (m) => m.label.replace(/ Vs /, " v ")
      .replace(/Lowest-ranked WF Winner/, "lowest WF winner").replace(/Highest-ranked WF Winner/, "highest WF winner");
    // placeholder dates are the AFL's week markers (Monday noon), not fixtures —
    // show the weekend window instead of a fake Monday time
    const weekend = (iso) => {
      const mon = new Date(iso);
      const fri = new Date(mon.getTime() + 4 * 864e5), sun = new Date(mon.getTime() + 6 * 864e5);
      const d = (x) => x.toLocaleDateString("en-AU", { day: "numeric", timeZone: "Australia/Melbourne" });
      const mo = (x) => x.toLocaleDateString("en-AU", { month: "short", timeZone: "Australia/Melbourne" });
      return `Fri–Sun ${d(fri)}–${d(sun)} ${mo(sun)} · TBC`;
    };
    const teamRow = (t, score, gb, won) => `
      <div class="fb-team${t.projected ? " proj" : ""}${t.abbr ? "" : " tbd"}${won ? " won" : ""}">
        ${t.logo ? `<img src="${esc(t.logo)}" alt="">` : `<span class="fb-blank"></span>`}
        <span class="fb-nm">${esc(t.abbr ? t.name : (t.seed || t.name).replace(/Lowest-ranked WF Winner/, "Lowest WF winner").replace(/Highest-ranked WF Winner/, "Highest WF winner"))}${t.projected ? `<i>${esc(t.seed)}</i>` : ""}</span>
        ${score != null ? `<span class="fb-sc tnum">${score}<i>${esc(gb || "")}</i></span>` : ""}
      </div>`;
    const matchCard = (m, rn, i) => {
      const done = m.status === "CONCLUDED";
      const hw = done && m.homeScore != null && m.homeScore > m.awayScore;
      const aw = done && m.awayScore != null && m.awayScore > m.homeScore;
      const placeholder = m.status === "PLACEHOLDER";
      const k = m.date && !placeholder ? fmt(m.date) : null;
      const when = k ? `${k.wd} ${k.day} · ${k.tm} ${TZ_LABEL[tz]}` : (m.date ? weekend(m.date) : "");
      const bothTbd = !m.home.abbr && !m.away.abbr;
      return `
        <div class="fb-match${done ? " done" : ""}${m.status === "LIVE" ? " live" : ""}${rn === 29 ? " gf" : ""}">
          <div class="fb-lbl">${rn === 29 ? "GRAND FINAL" : `<b>${code(rn, i)}</b>${bothTbd ? "" : ` · ${esc(seedLbl(m))}`}`}${m.status === "LIVE" ? ' <span class="badge-live">● Live</span>' : ""}</div>
          ${teamRow(m.home, m.homeScore, m.homeGB, hw)}
          ${teamRow(m.away, m.awayScore, m.awayGB, aw)}
          <div class="fb-when">${esc(when)}${m.venue ? ` · ${esc(m.venue)}` : ""}</div>
        </div>`;
    };
    host.innerHTML = `
      <div class="section-h" style="margin-top:30px">${live ? "The Finals" : "Road to the Grand Final"}
        <span class="n">${live ? "· MCG · Sat 26 Sep" : "· projected from the live ladder · locks after Round 24"}</span></div>
      ${live ? "" : `<div class="fb-note">If the season ended today. Top six straight through; 7th–10th play the wildcard round for the last two spots. Grand Final: MCG, Saturday 26 September.</div>`}
      <div class="fb-scroll"><div class="fb">
        ${rounds.map((r) => `
          <div class="fb-col${r.round === 29 ? " gf-col" : ""}">
            <div class="fb-rh">${esc(r.name)}</div>
            <div class="fb-cards">${r.matches.map((m, i) => matchCard(m, r.round, i)).join("")}</div>
          </div>`).join("")}
      </div></div>`;
    host.hidden = false;
  }

  // ---------- form guide: round-by-round from the per-round stats feed ----------
  let formData = null;
  const resCls = (r) => (r || "").startsWith("W") ? "w" : (r || "").startsWith("L") ? "l" : "d";

  function renderForm(form) {
    const wrap = $("form-wrap");
    if (!wrap) return;
    const rounds = (form && form.rounds) || [];
    if (!rounds.length) { wrap.hidden = true; return; }
    formData = rounds;
    wrap.innerHTML = `
      <div class="section-h" style="margin-top:30px">Form Guide <span class="n">· round by round · official AFL stats</span></div>
      <div class="fg">
        <div class="fg-tabs" role="tablist">
          ${rounds.map((r, i) => `<button class="fg-tab" data-fr="${i}" aria-pressed="${i === 0}">${esc(r.name.replace("Round ", "Rd "))}</button>`).join("")}
        </div>
        <div id="fg-body"></div>
      </div>`;
    paintForm(0);
    wrap.hidden = false;
    decorateLadderForm();
  }

  // hover card on ladder rows: the club's last five, straight from formData
  function decorateLadderForm() {
    if (!formData) return;
    document.querySelectorAll(".lad-row").forEach((row) => {
      const m = (row.getAttribute("href") || "").match(/team\/([A-Z]+)$/);
      if (!m || row.querySelector(".lad-pop")) return;
      const ab = m[1];
      const lines = formData.map((r) => {
        const c = r.clubs.find((x) => x.club === ab);
        return c ? `<span class="lp-line ${resCls(c.result)}"><b>${esc(r.name.replace("Round ", "Rd "))}</b><em>${esc(c.result)}</em><i>v ${esc(c.opp)}</i></span>`
                 : `<span class="lp-line bye"><b>${esc(r.name.replace("Round ", "Rd "))}</b><em>Bye</em><i></i></span>`;
      }).join("");
      const pop = document.createElement("span");
      pop.className = "lad-pop";
      pop.innerHTML = `<span class="lp-h">Last five</span>${lines}`;
      row.appendChild(pop);
    });
  }

  function paintForm(idx) {
    const body = $("fg-body");
    if (!body || !formData) return;
    const r = formData[idx];
    document.querySelectorAll(".fg-tab").forEach((b) => b.setAttribute("aria-pressed", String(+b.getAttribute("data-fr") === idx)));
    const col = (title, list, unit) => `
      <div class="fg-col">
        <div class="fg-h">${title}</div>
        ${list.map((p, i) => `
          <a class="fg-row" href="#/afl/player/${esc(p.id || "")}">
            <span class="fg-pos tnum">${i + 1}</span>
            ${p.photo ? `<img class="fg-img" src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="fg-img"></span>`}
            <span class="fg-who"><b>${esc(p.name)}</b><i>${esc(p.club)} · ${esc(p.line)}</i></span>
            <span class="fg-val tnum">${p.value}<i>${unit}</i></span>
          </a>`).join("")}
      </div>`;
    body.innerHTML = `
      <div class="fg-grid">
        ${col("Best on ground", r.best, "rating")}
        ${col("Goals", r.goals, "goals")}
        ${col("Disposals", r.disposals, "disp")}
      </div>
      <div class="fg-results">
        ${r.clubs.map((c) => `
          <a class="fg-res ${resCls(c.result)}" href="#/afl/team/${esc(c.club)}" title="${esc(c.club)} ${esc(c.result)} v ${esc(c.opp)}">
            <b>${esc(c.club)}</b><span>${esc(c.result)}</span><i>v ${esc(c.opp)}</i>
          </a>`).join("")}
      </div>`;
    document.querySelectorAll(".fg-tab").forEach((b) =>
      b.onclick = () => paintForm(+b.getAttribute("data-fr")));
  }

  function paintLeaders(key) {
    const box = $("ldr");
    if (!box || !leadersData) return;
    const cat = leadersData.find((c) => c.key === key) || leadersData[0];
    box.innerHTML = `
      <div class="ldr-h">${leadersSeason ? `${esc(leadersSeason.name)} leaders${leadersSeason.live ? "" : ' <i class="ldr-last">last season</i>'}` : "Season leaders"}</div>
      <div class="ldr-tabs" role="tablist">
        ${leadersData.map((c) => `<button class="ldr-tab" data-lk="${esc(c.key)}" aria-pressed="${c.key === cat.key}">${esc(c.label)}</button>`).join("")}
      </div>
      ${cat.leaders.map((p, i) => `
        <a class="ldr-row" href="#/${league}/player/${esc(p.id || "")}">
          <span class="ldr-pos tnum">${i + 1}</span>
          ${p.photo ? `<img class="ldr-img" src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="ldr-img"></span>`}
          <span class="ldr-who"><b>${esc(p.name)}</b><i>${esc(p.club)} · ${p.games} gms</i></span>
          <span class="ldr-val tnum">${p.value}<i>${p.avg ? p.avg + "/g" : (league === "nbl" ? "per game" : "")}</i></span>
        </a>`).join("")}
      <div class="ldr-src">Official AFL season totals</div>`;
    box.querySelectorAll("[data-lk]").forEach((b) =>
      b.addEventListener("click", () => paintLeaders(b.getAttribute("data-lk"))));
  }

  function renderRibbon() {
    const s = hubData.season, w = hubData.week;
    const cal = hubData.calendar || [];
    if (!cal.length && hubData.day) {
      // nightly leagues (NBA, NBL): step by day instead of by round
      const d = hubData.day;
      const dt = new Date(d + "T12:00:00Z");
      const lbl = dt.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
      const stName = { 1: "Preseason", 3: "Playoffs" }[s.type] || "";
      $("wk-label").textContent = [stName, lbl].filter(Boolean).join(" · ") + " · What to Watch";
      const shift = (n) => { const x = new Date(dt.getTime() + n * 864e5); weekView = { date: x.toISOString().slice(0, 10) }; loadHub(); };
      $("wk-prev").disabled = false; $("wk-next").disabled = false;
      $("wk-prev").onclick = () => shift(-1);
      $("wk-next").onclick = () => shift(1);
      return;
    }
    const idx = cal.findIndex((c) => c.seasontype === s.type && c.week === w.number);
    const label = idx >= 0 ? cal[idx].label : "Week " + w.number;
    const stName = league === "nrl" ? { 2: "Finals" }[s.type] || "" : { 1: "Preseason", 2: "", 3: "Postseason" }[s.type] || "";
    const lgName = (LEAGUE_UI[league] || {}).name || "";
    $("wk-label").textContent = w.number
      ? [stName, label].filter(Boolean).join(" · ") + " · What to Watch"
      : lgName + " · What to Watch";
    $("wk-prev").disabled = idx <= 0;
    $("wk-next").disabled = idx < 0 || idx >= cal.length - 1;
    $("wk-prev").onclick = () => { if (idx > 0) jumpWeek(cal[idx - 1]); };
    $("wk-next").onclick = () => { if (idx >= 0 && idx < cal.length - 1) jumpWeek(cal[idx + 1]); };
  }

  function jumpWeek(entry) {
    weekView = { year: hubData.season.year, seasontype: entry.seasontype, week: entry.week };
    loadHub();
  }

  function bindWatch(scope) {
    scope.querySelectorAll("[data-watch]").forEach((b) => {
      b.addEventListener("click", () => {
        // record the tap for the partner dashboard (fire-and-forget)
        try {
          const u = new URL(b.href);
          const payload = JSON.stringify({
            medium: u.searchParams.get("utm_medium") || "",
            campaign: u.searchParams.get("utm_campaign") || "",
            content: u.searchParams.get("utm_content") || "",
          });
          navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
        } catch (e) { /* tracking must never block the tap */ }
        toast(`Off to ${esc(b.getAttribute("data-plat") || "the broadcaster")} · <span class="u">${esc(b.getAttribute("data-watch"))}</span> — tap tracked`);
      });
    });
  }

  const SAVED_KEY = "ae_saved_v1";   // {id: {league, date, away, home, awayLogo, homeLogo, venue}}
  const savedMap = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "{}"); } catch { return {}; } };
  function bindStars() {
    $("slate").querySelectorAll("[data-star]").forEach((s) => {
      s.addEventListener("click", () => {
        const id = s.getAttribute("data-star");
        const set = new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]"));
        const on = set.has(id);
        if (on) set.delete(id); else set.add(id);
        localStorage.setItem(STAR_KEY, JSON.stringify([...set]));
        const m = savedMap();
        if (on) delete m[id];
        else {
          const g = (hubData && hubData.games || []).find((x) => String(x.id) === String(id));
          if (g) m[id] = { league, date: g.date, away: g.away.name, home: g.home.name, awayLogo: g.away.logo, homeLogo: g.home.logo, venue: g.venue || "", saved: Date.now() };
        }
        localStorage.setItem(SAVED_KEY, JSON.stringify(m));
        s.setAttribute("aria-pressed", String(!on));
        s.textContent = on ? "☆" : "★";
        if (!on) toast('Saved on this device — see it under <a href="#/saved" style="color:#fff;font-weight:700">★ Saved</a>');
        track(on ? "unsave_event" : "save_event", id);
      });
    });
  }

  // ---------- AUSSIES ABROAD: every Australian in the world's leagues, and when they play ----------
  const ABROAD_ORDER = ["nfl", "nba", "mlb", "cfb", "tennis", "golf", "f1", "ufc"];
  async function showAussiesAbroad() {
    view.innerHTML = `<div class="shell"><div class="loading" aria-live="polite">Finding every Australian abroad…</div></div>`;
    let d;
    try { d = await fetchJSON("/api/aussies-abroad"); } catch (e) { view.innerHTML = `<div class="shell"><div class="loading">Couldn't load (${esc(e.message)}). <a href="#/aussies" onclick="location.reload()">Try again</a>.</div></div>`; return; }
    // any league the bundle couldn't finish in time comes in on its own call
    if (d.missing && d.missing.length) {
      const extra = await Promise.all(d.missing.map((lg) => fetchJSON(`/api/aussies-abroad?league=${lg}`).catch(() => null)));
      extra.forEach((x) => { if (x && x.groups) d.groups.push(...x.groups); });
      d.total = d.groups.reduce((n, g) => n + g.players.length, 0);
    }
    d.groups.sort((a, b) => ABROAD_ORDER.indexOf(a.league) - ABROAD_ORDER.indexOf(b.league));
    const now = Date.now();
    const whenTxt = (n, kind) => {
      if (!n || !n.date) return kind === "tour" ? "Not in this week's field" : "No game on the current slate";
      const k = fmt(n.date); const past = new Date(n.date) < now - 4 * 36e5;
      const opp = n.opp ? (kind === "tour" ? esc(n.opp) : (n.home ? "vs " : "at ") + esc(n.opp)) : "";
      return `${n.state === "in" ? '<span class="badge-live">● Live</span> ' : ""}${opp}${opp ? " · " : ""}${k.wd} ${k.day} · ${k.tm} ${TZ_LABEL[tz]}${past && n.state !== "in" ? " · played" : ""}${n.mcg ? " · <b>the MCG</b>" : ""}`;
    };
    const card = (p, g) => `<div class="ab-card${(p.next && p.next.state === "in") ? " live" : ""}">
        ${p.headshot ? `<img class="ab-face" src="${esc(p.headshot)}" alt="">` : `<span class="ab-face ini">${esc((p.name || "?").split(" ").map((x) => x[0]).join("").slice(0, 2))}</span>`}
        <div class="ab-body">
          <div class="ab-top">🇦🇺 ${esc(p.pos || "")}${p.team ? `${p.pos ? " · " : ""}${esc(p.team)}` : ""}${p.event ? ` · ${esc(p.event)}` : ""}</div>
          <div class="ab-name">${p.id && g.kind === "team" ? `<a href="#/${g.league}/player/${esc(p.id)}">${esc(p.name)}</a>` : esc(p.name)}</div>
          <div class="ab-when">${whenTxt(p.next, g.kind)}</div>
          ${p.hook ? `<div class="ab-hook">${esc(p.hook)}</div>` : p.from ? `<div class="ab-hook muted">From ${esc(p.from)}</div>` : ""}
        </div>
      </div>`;
    const liveNow = d.groups.reduce((n, g) => n + g.players.filter((p) => p.next && p.next.state === "in").length, 0);
    view.innerHTML = `<div class="shell">
      ${pageHero("Aussies abroad", `${d.total} Australians<br><em>on the world stage</em>.`, `Every Australian in the NFL, NBA, MLB, college football, tennis, golf, F1 and UFC — and when they next play, in your time.${liveNow ? ` <b>${liveNow} playing right now.</b>` : ""}`)}
      <div class="wr-actions"><button class="watch ghost" id="ab-share">Share this page</button><span class="watch-also">Built from the live rosters and fields · updated ${timeAgoShort(d.generated || new Date().toISOString())}</span></div>
      ${d.groups.map((g) => `
        <div class="section-h" style="margin-top:30px">${esc(g.name)} <span class="n">· ${g.players.length} · <a href="#/${esc(g.league)}">the hub →</a></span></div>
        <div class="ab-grid">${g.players.map((p) => card(p, g)).join("")}</div>`).join("")}
      <p class="panel-note" style="margin-top:16px">Australians are found by birthplace on the live rosters plus a short curated list per code (ESPN drops birthplace on some internationals), and by country flag in the tour fields. Kyrie Irving is Melbourne-born and appears on that basis.</p>
    </div>`;
    $("ab-share")?.addEventListener("click", () => share("Aussies Abroad — Armchair Experts", `${SITE}/aussies`, "share_aussies"));
    track("view_aussies_abroad", String(d.total));
    armMotion();
  }

  // ---------- SAVED: the games this browser starred, upcoming first ----------
  function showSaved() {
    const m = savedMap();
    const items = Object.entries(m).map(([id, g]) => ({ id, ...g })).sort((a, b) => new Date(a.date) - new Date(b.date));
    const now = Date.now();
    const up = items.filter((g) => new Date(g.date) >= now - 4 * 36e5), past = items.filter((g) => new Date(g.date) < now - 4 * 36e5);
    const row = (g) => { const k = fmt(g.date); const opts = WATCH[g.league] || []; const primary = opts.find((o) => o.every) || opts[0];
      return `<div class="sv-row"><span class="sc-sport">${esc((LEAGUE_UI[g.league] || {}).name || g.league)}</span>
        <span class="sv-teams">${g.awayLogo ? `<img src="${esc(g.awayLogo)}" alt="">` : ""}<b>${esc(g.away)}</b><i>${g.league === "nfl" ? "at" : "v"}</i>${g.homeLogo ? `<img src="${esc(g.homeLogo)}" alt="">` : ""}<b>${esc(g.home)}</b></span>
        <span class="sv-when">${k.wd} ${k.day} · ${k.tm} ${TZ_LABEL[tz]}</span>
        ${primary ? `<a class="watch sm ghost" href="${esc(primary.url)}" target="_blank" rel="noopener" data-track="click_event_watch_provider" data-label="${esc(g.league + ":" + primary.key)}">▶ ${esc(primary.label)}</a>` : ""}
        <a class="wr-more" href="#/${esc(g.league)}">hub →</a>
        <button class="star on" data-unsave="${esc(g.id)}" title="Remove from this device" aria-label="Remove ${esc(g.away)} v ${esc(g.home)} from saved">★</button></div>`; };
    view.innerHTML = `<div class="shell">
      ${pageHero("Saved", `Your <em>games</em>.`, "The games you've starred — kept on this device only, no account needed. Times in your timezone.")}
      ${items.length ? `
        ${up.length ? `<div class="section-h" style="margin-top:20px">Coming up <span class="n">· ${up.length}</span></div><div class="sv-list">${up.map(row).join("")}</div>` : ""}
        ${past.length ? `<div class="section-h" style="margin-top:28px">Played <span class="n">· ${past.length}</span></div><div class="sv-list">${past.map(row).join("")}</div>` : ""}
        <p class="panel-note" style="margin-top:14px">Saved on this device. Clear your browser data and it's gone — a proper account and reminders come later.</p>` :
        `<div class="panel roster-empty" style="margin-top:20px"><p>Nothing saved yet. Tap ☆ on any game in a league hub and it lands here.</p><a class="watch sm ghost" href="#/leagues">Browse the leagues →</a></div>`}
    </div>`;
    view.querySelectorAll("[data-unsave]").forEach((b) => b.addEventListener("click", () => {
      const id = b.getAttribute("data-unsave"); const mm = savedMap(); delete mm[id]; localStorage.setItem(SAVED_KEY, JSON.stringify(mm));
      const set = new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]")); set.delete(id); localStorage.setItem(STAR_KEY, JSON.stringify([...set]));
      track("unsave_event", id); showSaved();
    }));
    track("view_saved", String(items.length));
  }

  let episodeHTML = "", hubLoadedAt = 0;
  setInterval(() => { const n = $("fresh-note"); if (n && hubLoadedAt) n.textContent = "updated " + timeAgoShort(new Date(hubLoadedAt).toISOString()); }, 30000);
  function setTzNote() {
    $("tz-note").innerHTML = "Kick-offs in " + TZ_LABEL[tz] + " time · <span id=\"fresh-note\">updated just now</span> · source ESPN";
    hubLoadedAt = Date.now();
    $("ribbon-sub").innerHTML = episodeHTML || ("Every game in " + TZ_LABEL[tz] + " time, one tap to stream.");
  }

  async function postJSON(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.json();
  }

  function bindCapture() {
    const subForm = $("sub-form"), mbForm = $("mb-form");
    if (subForm) subForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const res = await postJSON("/api/subscribe", { email: $("sub-email").value }).catch(() => ({ ok: false, error: "Network hiccup — try again." }));
      $("sub-note").textContent = res.ok ? "You're in — first issue lands Monday morning. ☕" : (res.error || "Try again.");
      if (res.ok) { subForm.reset(); toast("Signed up for the Monday Armchair"); }
    });
    if (mbForm) mbForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const res = await postJSON("/api/mailbag", { question: $("mb-q").value, name: $("mb-name").value, email: $("mb-email").value }).catch(() => ({ ok: false, error: "Network hiccup — try again." }));
      $("mb-note").textContent = res.ok ? "In the bag — listen out for your name on the show. 🎙" : (res.error || "Try again.");
      if (res.ok) { mbForm.reset(); toast("Question sent to the Experts"); }
    });
  }

  function bindHubControls() {
    view.querySelectorAll("[data-tz]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-tz") === tz));
      b.addEventListener("click", () => {
        tz = b.getAttribute("data-tz");
        localStorage.setItem(TZ_KEY, tz);
        view.querySelectorAll("[data-tz]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderGotw(); renderSlate(); renderAussies(); setTzNote();
      });
    });
    view.querySelectorAll("[data-sort]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-sort") === sort));
      b.addEventListener("click", () => {
        sort = b.getAttribute("data-sort");
        view.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderSlate();
      });
    });
  }

  async function loadHub() {
    $("loading").hidden = false;
    $("content").hidden = true;
    const qs = (weekView ? (weekView.date ? `?date=${weekView.date}` : `?year=${weekView.year}&seasontype=${weekView.seasontype}&week=${weekView.week}`) : "?") + `&league=${league}`;
    try {
      // one round-trip: the server fans out to every feed in parallel and returns
      // the lot; falls back to the per-module calls if the bundle endpoint fails
      let sched, aus, rtg, featured, vids, lad, ldrs, form, finals;
      try {
        const b = await fetch("/api/hub" + qs).then((r) => { if (!r.ok) throw new Error("API " + r.status); return r.json(); });
        ({ schedule: sched, aussies: aus, rtg, featured, videos: vids, ladder: lad, leaders: ldrs, form, finals } = b);
        if (aus && aussiesFor === league) aus = null;
      } catch (e) {
        [sched, aus, rtg, featured, vids, lad, ldrs, form, finals] = await Promise.all([
          fetch("/api/schedule" + qs).then((r) => { if (!r.ok) throw new Error("API " + r.status); return r.json(); }),
          ["nfl", "nba", "mlb", "cfb"].includes(league) && aussiesFor !== league ? fetchJSON(`/api/aussies?league=${league}`) : Promise.resolve(null),
          league === "nfl" ? fetchJSON("/api/road-to-the-g").catch(() => null) : Promise.resolve(null),
          fetchJSON(`/api/featured?league=${league}`).catch(() => null),
          fetchJSON(`/api/videos?league=${league}`).catch(() => null),
          league !== "nfl" ? fetchJSON(`/api/ladder?league=${league}`).catch(() => null) : Promise.resolve(null),
          league !== "nfl" ? fetchJSON(`/api/leaders?league=${league}`).catch(() => null) : Promise.resolve(null),
          league === "afl" ? fetchJSON("/api/afl/form").catch(() => null) : Promise.resolve(null),
          league === "afl" ? fetchJSON("/api/afl/finals").catch(() => null) : Promise.resolve(null),
        ]);
      }
      hubData = sched;
      if (aus) { aussies = aus.players || []; aussiesFor = league; }

      const ep = hubData.experts && hubData.experts.episode;
      if (ep && ep.title) {
        const show = (hubData.experts.show || {});
        episodeHTML = `🎙 This week on ${esc(show.name || "the show")}: <b>${esc(ep.title)}</b>` +
          (ep.url ? ` · <a href="${esc(ep.url)}" target="_blank" rel="noopener">listen</a>` : "");
      } else {
        episodeHTML = "";
      }
      renderRibbon(); renderLead(featured); renderRtg(rtg); renderNews(featured); renderLadder(lad, ldrs); renderFinals(finals); renderForm(form); renderGotw(); renderSlate(); renderAussies(); setTzNote();
      const vw2 = $("vid-wrap"); if (vw2) vw2.innerHTML = videoRailHTML(vids && vids.videos);
      armMotion();
      armLivePoll();
      $("loading").hidden = true;
      $("content").hidden = false;
    } catch (err) {
      $("loading").innerHTML = `We couldn't refresh this section (${esc(err.message)}). <button class="watch sm ghost" id="hub-retry">Try again</button>`;
      $("hub-retry")?.addEventListener("click", () => { _cache.clear(); track("retry_module", league); loadHub(); });
    }
  }

  // ---------- live scores: quiet refresh while games are in progress ----------
  // Polls the schedule once a minute while any game on the visible week is live
  // (or inside the 20 minutes before kick-off, to catch the pre -> in flip) and
  // repaints just the game sections — news, videos and motion state untouched.
  let liveTimer = null;
  function armLivePoll() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    const needsPoll = (g) => g.status.state === "in" ||
      (g.status.state === "pre" && new Date(g.date) - Date.now() < 20 * 60e3 && new Date(g.date) - Date.now() > -60e3);
    if (!hubData || !(hubData.games || []).some(needsPoll)) return;
    const qs = (weekView ? (weekView.date ? `?date=${weekView.date}` : `?year=${weekView.year}&seasontype=${weekView.seasontype}&week=${weekView.week}`) : "?") + `&league=${league}`;
    liveTimer = setInterval(async () => {
      if (document.hidden) return;
      if (!$("slate")) { clearInterval(liveTimer); liveTimer = null; return; }   // navigated off the hub
      try {
        hubData = await fetchJSON("/api/schedule" + qs);
        renderGotw(); renderSlate();
        armLivePoll();                       // reassess: stops itself once the last game goes final
      } catch { /* one bad tick is fine — try again next minute */ }
    }, 60000);
  }

  function showHub() {
    view.innerHTML = hubHTML();
    bindHubControls();
    loadHub();
  }

  // =====================================================================
  // TEAMS grid
  // =====================================================================

  async function showTeams() {
    view.innerHTML = `<div class="shell"><div class="loading">Loading the clubs…</div></div>`;
    try {
      const d = await fetchJSON(`/api/teams?league=${league}`);
      view.innerHTML = `${nflSubnav("teams")}<div class="shell">
        ${(() => {
          const ui = LEAGUE_UI[league] || LEAGUE_UI.nfl;
          const n = d.divisions.reduce((t, x) => t + x.teams.length, 0);
          const noun = league === "nfl" ? "teams" : "clubs";
          return pageHero(ui.name, `All <em>${n} ${noun}</em>.`,
            "Every roster, every player, every career. Pick a club and go as deep as you like.");
        })()}
        ${d.divisions.map((div) => `
          <div class="div-h">${esc(div.name)}</div>
          <div class="teams-grid">
            ${div.teams.map((t) => t.coming ? `
              <div class="team-card is-coming">
                <img src="${esc(t.logo)}" alt="" loading="lazy">
                <div><div class="loc coming-chip">${esc(t.coming)}</div><div class="tnm">${esc(t.name)}</div></div>
              </div>` : `
              <a class="team-card" href="#/${league}/team/${esc(t.abbr)}">
                <img src="${esc(t.logo)}" alt="" loading="lazy">
                <div><div class="loc">${esc(t.location)}</div><div class="tnm">${esc(t.name)}</div></div>
              </a>`).join("")}
          </div>`).join("")}
      </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load teams (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // TEAM page
  // =====================================================================

  async function showTeam(abbr) {
    view.innerHTML = `<div class="shell"><div class="loading">Loading ${esc(abbr)}…</div></div>`;
    try {
      const d = await fetchJSON(`/api/team/${encodeURIComponent(abbr)}?league=${league}`);
      const t = d.team;
      let next = "";
      if (t.nextEvent && t.nextEvent.date) {
        const k = fmt(t.nextEvent.date);
        next = `Next: ${esc(t.nextEvent.shortName)} · ${k.wd} ${k.day} ${k.tm} ${TZ_LABEL[tz]}`;
      }
      const aussieCount = d.groups.reduce((n, g) => n + g.players.filter((p) => p.aussie).length, 0);
      view.innerHTML = `
        ${nflSubnav("teams")}
        <div class="team-hero" style="background:linear-gradient(120deg,#${esc(t.color || "222")}E6,#${esc(t.color || "222")}66),var(--card)">
          <div class="shell">
            <a class="crumb" href="#/teams">← All teams</a>
            <div class="th-row">
              <img class="th-logo" src="${esc(t.logo)}" alt="">
              <div>
                <div class="th-loc">${esc(t.location)}</div>
                <h1 class="th-name">${esc(t.name)}</h1>
                <div class="th-meta">${[t.record, t.standing, t.division,
                    aussieCount ? `🇦🇺 ${aussieCount} Aussie${aussieCount > 1 ? "s" : ""} on the list` : ""
                  ].filter(Boolean).map(esc).join(" · ")}</div>
                ${next ? `<div class="th-next">${next}</div>` : ""}
              </div>
            </div>
          </div>
        </div>
        <div class="shell">
          ${!d.groups.length ? (league === "afl" || league === "nbl" ? `
            <div id="afl-list"><div class="loading">Loading the list…</div></div>` : `
            <div class="section-h" style="margin-top:26px">The list</div>
            <div class="panel roster-empty">
              <p>Player lists for the ${esc((LEAGUE_UI[league] || {}).name || "")} aren't in the live feed yet — fixtures, results and ladder are.</p>
              ${league === "nrl" ? `<a class="watch sm ghost" href="https://www.nrl.com/clubs/" target="_blank" rel="noopener">Squads on NRL.com ↗</a>` : ""}
            </div>`) : ""}
          ${d.groups.map((g) => `
            <div class="section-h" style="margin-top:26px">${esc(g.label)} <span class="n">· ${g.players.length}</span></div>
            <div class="tbl-wrap"><table class="roster">
              <thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Age</th><th>HT</th><th>WT</th><th>College</th><th>Exp</th></tr></thead>
              <tbody>
                ${g.players.map((p) => `
                  <tr data-player="${esc(p.id)}" tabindex="0">
                    <td class="tnum">${esc(p.jersey)}</td>
                    <td class="pl">
                      ${p.headshot ? `<img class="hs" src="${esc(p.headshot)}" alt="" loading="lazy">` : `<span class="hs hs-empty"></span>`}
                      <a class="pl-nm" href="#/${league}/player/${esc(p.id)}">${esc(p.name)}</a>${p.aussie ? ' <span title="Australian">🇦🇺</span>' : ""}
                    </td>
                    <td>${esc(p.pos)}</td>
                    <td class="tnum">${esc(p.age ?? "")}</td>
                    <td>${esc(p.height)}</td>
                    <td>${esc(p.weight)}</td>
                    <td>${esc(p.college)}</td>
                    <td class="tnum">${p.exp === 0 ? "R" : esc(p.exp ?? "")}</td>
                  </tr>`).join("")}
              </tbody>
            </table></div>`).join("")}
        </div>`;
      view.querySelectorAll("[data-player]").forEach((tr) => {
        const go = () => { location.hash = `#/${league}/player/` + tr.getAttribute("data-player"); };
        tr.addEventListener("click", go);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      });
      if (league === "afl" && !d.groups.length) loadAflList(abbr);
      if (league === "nbl" && !d.groups.length) loadNblList(abbr);
      if (["nfl", "nba", "mlb", "cfb", "epl", "nrl"].includes(league)) loadClubForm(abbr);
      if (INJ_LEAGUES.includes(league)) loadClubInjuries(abbr);
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load ${esc(abbr)} (${esc(err.message)}).</div></div>`;
    }
  }

  // Club form: last five + next fixture, from ESPN team schedules (NRL from the round scoreboards)
  async function loadClubForm(abbr) {
    const shell = view.querySelector(".team-hero + .shell") || view.querySelector(".shell:last-of-type");
    if (!shell) return;
    const mount = document.createElement("div"); mount.id = "club-form";
    shell.insertBefore(mount, shell.firstChild);
    try {
      const f = await fetchJSON(`/api/team/${encodeURIComponent(abbr)}/form?league=${league}`);
      const last = f.last || [];
      const n = f.next;
      if (!last.length && !n) { mount.remove(); return; }
      const oppLink = (r) => r.oppKey ? `#/${league}/team/${esc(r.oppKey)}` : `#/${league}`;
      mount.innerHTML = `
        ${n ? `<div class="section-h" style="margin-top:22px">Next up</div>
        <a class="cf-next" href="${oppLink(n)}">${n.oppLogo ? `<img src="${esc(n.oppLogo)}" alt="">` : ""}<span><b>${n.home ? "vs" : "at"} ${esc(n.opp)}</b><i>${esc(fmt(n.date).wd)} ${esc(fmt(n.date).day)} · ${esc(fmt(n.date).tm)} ${TZ_LABEL[tz]}${n.venue ? " · " + esc(n.venue) : ""}</i></span><em>${esc(n.opp)} →</em></a>` : ""}
        ${last.length ? `<div class="section-h" style="margin-top:22px">Form <span class="n">· last ${last.length}, newest first</span></div>
        <div class="cf-strip">${last.map((r) => `<a class="cf-card ${r.result === "W" ? "w" : r.result === "L" ? "l" : "d"}" href="${oppLink(r)}">
            <div class="cf-rd">${esc(fmt(r.date).wd)} ${esc(fmt(r.date).day)} <i>${r.home ? "vs" : "at"} ${esc(r.opp)}</i></div>
            <div class="cf-res">${esc(r.result)} ${esc(r.us)}–${esc(r.them)}</div>
            ${r.oppLogo ? `<img class="cf-opp" src="${esc(r.oppLogo)}" alt="">` : ""}
          </a>`).join("")}</div>` : ""}`;
    } catch { mount.remove(); }
  }

  async function loadClubInjuries(abbr) {
    try {
      const d = await fetchJSON(`/api/injuries?league=${league}&team=${encodeURIComponent(abbr)}`);
      const tm = (d.teams || [])[0];
      if (!tm || !tm.players.length) return;
      const shell = view.querySelector(".team-hero + .shell") || view.querySelector(".shell:last-of-type");
      const anchor = shell && shell.querySelector("#club-form");
      const el = document.createElement("div"); el.id = "club-inj";
      el.innerHTML = `<div class="section-h" style="margin-top:22px">Availability <span class="n">· ${tm.players.length} on the report · source ESPN</span></div>
        <div class="inj-list">${tm.players.map((p) => `<span class="inj-row card"><i class="inj-st ${injCls(p.status)}">${esc(p.status)}</i><span><b>${esc(p.name)}</b>${p.pos ? ` <em>${esc(p.pos)}</em>` : ""}${p.injury ? ` · ${esc(p.injury)}` : ""}${p.returnDate ? ` · expected back ${esc(fmt(p.returnDate).day)}` : ""}${p.comment ? `<small>${esc(p.comment)}</small>` : ""}</span></span>`).join("")}</div>`;
      if (anchor && anchor.nextSibling) shell.insertBefore(el, anchor.nextSibling); else if (shell) shell.insertBefore(el, shell.firstChild);
    } catch { /* quiet */ }
  }

  // AFL lists come from the official Champion Data feed, not ESPN
  async function loadAflList(abbr) {
    const box = $("afl-list");
    if (!box) return;
    try {
      const [d, cf] = await Promise.all([
        fetchJSON(`/api/afl/list/${encodeURIComponent(abbr)}`),
        fetchJSON(`/api/afl/form/${encodeURIComponent(abbr)}`).catch(() => null),
      ]);
      const n1 = (v) => v == null ? "" : (+v).toFixed(1);
      const formHTML = cf && cf.rounds && cf.rounds.length ? `
        <div class="section-h" style="margin-top:26px">Last five <span class="n">· round by round</span></div>
        <div class="cf-strip">
          ${cf.rounds.map((r) => r.bye ? `
            <div class="cf-card bye"><div class="cf-rd">${esc(r.name.replace("Round ", "Rd "))}</div><div class="cf-res">Bye</div></div>` : `
            <div class="cf-card ${resCls(r.result)}">
              <div class="cf-rd">${esc(r.name.replace("Round ", "Rd "))} <i>v ${esc(r.opp)}</i></div>
              <div class="cf-res">${esc(r.result)}</div>
              ${r.best.map((p, i) => `
                <a class="cf-p" href="#/afl/player/${esc(p.id || "")}">
                  ${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="cf-ph"></span>`}
                  <span><b>${esc(p.name)}</b><i>${esc(p.line)}</i></span>
                  <em class="tnum">${p.rating}</em>
                </a>`).join("")}
              ${r.topGoals ? `<div class="cf-goals">⚑ ${esc(r.topGoals.name)} ${r.topGoals.goals} goal${r.topGoals.goals === 1 ? "" : "s"}</div>` : ""}
            </div>`).join("")}
        </div>` : "";
      box.innerHTML = `
        ${formHTML}
        <div class="section-h" style="margin-top:26px">The list <span class="n">· ${d.players.length} played in 2026 · season numbers</span></div>
        <div class="tbl-wrap"><table class="roster">
          <thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Age</th><th class="tnum">Gms</th><th class="tnum">Goals</th><th class="tnum">Disp/g</th><th class="tnum">Marks/g</th><th class="tnum">Tkl/g</th><th class="tnum">Rating</th></tr></thead>
          <tbody>
            ${d.players.map((p) => `
              <tr data-player="${esc(p.id)}" tabindex="0">
                <td class="tnum">${esc(p.jumper ?? "")}</td>
                <td class="pl">
                  ${p.photo ? `<img class="hs" src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="hs hs-empty"></span>`}
                  <a class="pl-nm" href="#/afl/player/${esc(p.id)}">${esc(p.name)}</a>
                </td>
                <td>${esc(p.pos)}</td>
                <td class="tnum">${esc(p.age ?? "")}</td>
                <td class="tnum">${p.games}</td>
                <td class="tnum">${p.goals || ""}</td>
                <td class="tnum">${n1(p.disp)}</td>
                <td class="tnum">${n1(p.marks)}</td>
                <td class="tnum">${n1(p.tackles)}</td>
                <td class="tnum">${p.rating ? Math.round(p.rating) : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table></div>
        <p class="panel-note" style="margin-top:12px">Official AFL season stats. Contracts, trades and list management live on <a href="https://list-trac.vercel.app" target="_blank" rel="noopener">ListTrac →</a></p>`;
      box.querySelectorAll("[data-player]").forEach((tr) => {
        const go = () => { location.hash = "#/afl/player/" + tr.getAttribute("data-player"); };
        tr.addEventListener("click", go);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      });
    } catch {
      box.innerHTML = `<div class="panel roster-empty" style="margin-top:26px">
        <p>Couldn't reach the AFL stats feed for this list.</p>
        <a class="watch" href="https://list-trac.vercel.app" target="_blank" rel="noopener">Full list, contracts &amp; trades on ListTrac →</a></div>`;
    }
  }

  // NBL list — from the league's Rosetta feed (ESPN publishes no NBL rosters)
  async function loadNblList(abbr) {
    const box = $("afl-list");
    if (!box) return;
    try {
      const d = await fetchJSON(`/api/nbl/list/${encodeURIComponent(abbr)}`);
      const n1 = (v) => v == null ? "" : (+v).toFixed(1);
      const s = d.season || {};
      box.innerHTML = `
        <div class="section-h" style="margin-top:26px">The list <span class="n">· ${d.players.length} players · ${esc(s.name || "")}${s.live ? "" : " · last season's numbers"}</span></div>
        <div class="tbl-wrap"><table class="roster">
          <thead><tr><th>#</th><th>Player</th><th>Pos</th><th class="tnum">Gms</th><th class="tnum">PPG</th><th class="tnum">RPG</th><th class="tnum">APG</th><th class="tnum">MPG</th><th class="tnum">FG%</th></tr></thead>
          <tbody>
            ${d.players.map((p) => `
              <tr data-player="${esc(p.id)}" tabindex="0">
                <td class="tnum">${esc(p.jersey ?? "")}</td>
                <td class="pl">
                  ${p.photo ? `<img class="hs" src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="hs hs-empty"></span>`}
                  <a class="pl-nm" href="#/nbl/player/${esc(p.id)}">${esc(p.name)}</a>
                </td>
                <td>${esc(p.pos)}</td>
                <td class="tnum">${p.games || ""}</td>
                <td class="tnum">${n1(p.ppg)}</td><td class="tnum">${n1(p.rpg)}</td><td class="tnum">${n1(p.apg)}</td>
                <td class="tnum">${n1(p.mpg)}</td><td class="tnum">${p.fg != null ? p.fg : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table></div>
        <p class="panel-note" style="margin-top:12px">Official NBL stats.${s.live ? "" : " Rosters and numbers roll over to NBL27 as the season tips off."}</p>`;
      box.querySelectorAll("[data-player]").forEach((tr) => {
        const go = () => { location.hash = "#/nbl/player/" + tr.getAttribute("data-player"); };
        tr.addEventListener("click", go);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      });
    } catch {
      box.innerHTML = `<div class="panel roster-empty" style="margin-top:26px"><p>Couldn't reach the NBL stats feed for this list.</p></div>`;
    }
  }

  // NBL player page — career from the league feed
  async function showNblPlayer(pid) {
    view.innerHTML = `<div class="shell"><div class="loading">Loading player…</div></div>`;
    try {
      const d = await fetchJSON("/api/nbl/player/" + encodeURIComponent(pid));
      const p = d.player;
      const n1 = (v) => v == null ? "—" : (+v).toFixed(1);
      const yr = (s) => `${s.year}–${String((+s.year + 1) % 100).padStart(2, "0")}`;
      view.innerHTML = `
        ${nflSubnav("teams")}
        <div class="team-hero" style="background:linear-gradient(120deg,${esc(p.color || "#222")}E6,${esc(p.color || "#222")}66),var(--card)">
          <div class="shell">
            <a class="crumb" href="#/nbl/team/${esc(p.club)}">← ${esc(p.clubName)}</a>
            <div class="th-row">
              ${p.photo ? `<img class="ph" src="${esc(p.photo)}" alt="">` : ""}
              <div>
                <div class="th-loc">${esc(p.clubName)}${p.jersey ? " · #" + esc(p.jersey) : ""}${p.pos ? " · " + esc(p.pos) : ""}</div>
                <h1 class="th-name">${esc(p.name)}</h1>
                <div class="sum-chips">
                  <span class="sum"><b class="tnum">${p.games}</b> games</span>
                  <span class="sum"><b class="tnum">${n1(p.ppg)}</b> ppg</span>
                  <span class="sum"><b class="tnum">${n1(p.rpg)}</b> rpg</span>
                  <span class="sum"><b class="tnum">${n1(p.apg)}</b> apg</span>
                  <span class="sum"><b class="tnum">${p.fg != null ? p.fg + "%" : "—"}</b> FG</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="shell">
          <div class="section-h" style="margin-top:26px">Career <span class="n">· season by season · official NBL stats</span></div>
          <div class="tbl-wrap"><table class="roster stats">
            <thead><tr><th>Season</th><th>Team</th><th class="tnum">G</th><th class="tnum">MPG</th><th class="tnum">PPG</th><th class="tnum">RPG</th><th class="tnum">APG</th><th class="tnum">SPG</th><th class="tnum">BPG</th><th class="tnum">FG%</th><th class="tnum">3P%</th><th class="tnum">FT%</th></tr></thead>
            <tbody>
              ${d.seasons.map((s) => `
                <tr>
                  <td>${esc(yr(s))}</td>
                  <td>${s.team ? `<a href="#/nbl/team/${esc(s.team)}">${esc(s.team)}</a>` : ""}</td>
                  <td class="tnum">${s.games}</td><td class="tnum">${n1(s.mpg)}</td>
                  <td class="tnum"><b>${n1(s.ppg)}</b></td><td class="tnum">${n1(s.rpg)}</td><td class="tnum">${n1(s.apg)}</td>
                  <td class="tnum">${n1(s.spg)}</td><td class="tnum">${n1(s.bpg)}</td>
                  <td class="tnum">${s.fg ?? "—"}</td><td class="tnum">${s.tp ?? "—"}</td><td class="tnum">${s.ft ?? "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table></div>
          <div class="section-h" style="margin-top:26px">${esc(yr({ year: d.seasons[0].year }))} totals</div>
          <div class="tbl-wrap"><table class="roster stats">
            <thead><tr><th>Stat</th><th class="tnum">Total</th><th class="tnum">Per game</th></tr></thead>
            <tbody>${d.stats.map((s) => `<tr><td>${esc(s.label)}</td><td class="tnum">${s.total}</td><td class="tnum">${s.avg ?? ""}</td></tr>`).join("")}</tbody>
          </table></div>
        </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load player (${esc(err.message)}).</div></div>`;
    }
  }

  // AFL player page — season card from the official stats feed
  async function showAflPlayer(pid) {
    view.innerHTML = `<div class="shell"><div class="loading">Loading player…</div></div>`;
    try {
      const [d, log] = await Promise.all([
        fetchJSON("/api/afl/player/" + encodeURIComponent(pid)),
        fetchJSON("/api/afl/player/" + encodeURIComponent(pid) + "/form").catch(() => null),
      ]);
      const p = d.player;
      const chips = [
        p.pos, p.age ? p.age + " yrs" : "", p.height,
        p.draft, p.debut ? "Debut " + p.debut : "", p.state ? "From " + p.state : "",
      ].filter(Boolean);
      const n1 = (v) => v == null ? "—" : (+v).toFixed(1);
      const games = (log && log.games) || [];
      const logHTML = games.length ? `
        <div class="section-h" style="margin-top:26px">Last five games <span class="n">· game log</span></div>
        <div class="tbl-wrap"><table class="roster stats glog">
          <thead><tr><th>Round</th><th>Result</th><th class="tnum">D</th><th class="tnum">K</th><th class="tnum">HB</th><th class="tnum">M</th><th class="tnum">T</th><th class="tnum">G</th><th class="tnum">B</th><th class="tnum">CL</th><th class="tnum">HO</th><th class="tnum">Fantasy</th><th class="tnum">Rating</th></tr></thead>
          <tbody>
            ${games.map((g) => g.dnp ? `
              <tr class="dnp"><td>${esc(g.name.replace("Round ", "Rd "))}</td><td colspan="12">Did not play</td></tr>` : `
              <tr>
                <td>${esc(g.name.replace("Round ", "Rd "))}</td>
                <td><span class="res-chip ${resCls(g.result)}">${esc(g.result)}</span> <span class="res-opp">v ${esc(g.opp)}</span></td>
                <td class="tnum">${g.disposals}</td><td class="tnum">${g.kicks}</td><td class="tnum">${g.handballs}</td>
                <td class="tnum">${g.marks}</td><td class="tnum">${g.tackles}</td>
                <td class="tnum">${g.goals}</td><td class="tnum">${g.behinds}</td>
                <td class="tnum">${g.clearances}</td><td class="tnum">${g.hitouts}</td>
                <td class="tnum">${g.fantasy}</td><td class="tnum"><b>${g.rating ?? ""}</b></td>
              </tr>`).join("")}
          </tbody>
        </table></div>` : "";
      view.innerHTML = `
        ${nflSubnav("teams")}
        <div class="team-hero">
          <div class="shell">
            <a class="crumb" href="#/afl/team/${esc(p.club)}">← ${esc(p.clubName)}</a>
            <div class="th-row">
              ${p.photo ? `<img class="ph" src="${esc(p.photo)}" alt="">` : ""}
              <div>
                <div class="th-loc">${esc(p.clubName)}${p.jumper ? " · #" + esc(p.jumper) : ""}</div>
                <h1 class="th-name">${esc(p.name)}</h1>
                <div class="th-meta">${chips.map(esc).join(" · ")}</div>
                <div class="sum-chips">
                  <span class="sum"><b class="tnum">${p.games}</b> games</span>
                  <span class="sum"><b class="tnum">${p.goals}</b> goals</span>
                  <span class="sum"><b class="tnum">${n1(p.dispAvg)}</b> disposals/g</span>
                  <span class="sum"><b class="tnum">${n1(p.marksAvg)}</b> marks/g</span>
                  <span class="sum"><b class="tnum">${n1(p.tacklesAvg)}</b> tackles/g</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="shell">
          ${logHTML}
          <div class="section-h" style="margin-top:26px">2026 season <span class="n">· official AFL stats</span></div>
          <div class="tbl-wrap"><table class="roster stats">
            <thead><tr><th>Stat</th><th class="tnum">Total</th><th class="tnum">Per game</th></tr></thead>
            <tbody>
              ${d.stats.map((s) => `<tr><td>${esc(s.label)}</td><td class="tnum">${esc(s.total)}</td><td class="tnum">${esc(s.avg)}</td></tr>`).join("")}
            </tbody>
          </table></div>
          ${p.from ? `<p class="panel-note" style="margin-top:12px">Recruited from: ${esc(p.from)}</p>` : ""}
        </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load player (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // PLAYER page
  // =====================================================================

  async function showPlayer(pid) {
    if (league === "afl") return showAflPlayer(pid);
    if (league === "nbl") return showNblPlayer(pid);
    view.innerHTML = `<div class="shell"><div class="loading">Loading player…</div></div>`;
    try {
      const d = await fetchJSON("/api/player/" + encodeURIComponent(pid) + `?league=${league}`);
      const p = d.player;
      const chips = [
        p.pos, p.age ? p.age + " yrs" : "", p.height, p.weight,
        p.college ? "College: " + p.college : "",
        p.draft || "", p.experience || "",
        p.birthplace ? "Born: " + p.birthplace : "",
      ].filter(Boolean);
      view.innerHTML = `
        ${nflSubnav("teams")}
        <div class="team-hero" style="background:linear-gradient(120deg,#${esc(p.team.color || "222")}E6,#${esc(p.team.color || "222")}66),var(--card)">
          <div class="shell">
            ${p.team.abbr ? `<a class="crumb" href="#/${league}/team/${esc(p.team.abbr)}">← ${esc(p.team.displayName)}</a>` : `<a class="crumb" href="#/${league}/teams">← Teams</a>`}
            <div class="th-row">
              ${p.headshot ? `<img class="ph" src="${esc(p.headshot)}" alt="">` : ""}
              <div>
                <div class="th-loc">${esc(p.team.displayName)}${p.jersey ? " · " + esc(p.jersey) : ""}${p.aussie ? " · 🇦🇺 Australian" : ""}</div>
                <h1 class="th-name">${esc(p.name)}</h1>
                <div class="th-meta">${chips.map(esc).join(" · ")}</div>
                ${d.summary.length ? `<div class="sum-chips">${d.summary.map((s) => `<span class="sum"><b class="tnum">${esc(s.value)}</b> ${esc(s.label)}</span>`).join("")}</div>` : ""}
              </div>
              ${p.team.logo ? `<img class="th-watermark" src="${esc(p.team.logo)}" alt="">` : ""}
            </div>
          </div>
        </div>
        <div class="shell">
          ${d.categories.length ? d.categories.map((c) => `
            <div class="section-h" style="margin-top:26px">${esc(c.name)} <span class="n">· season by season</span></div>
            <div class="tbl-wrap"><table class="roster stats">
              <thead><tr><th>Season</th><th>Team</th>${c.labels.map((l) => `<th class="tnum">${esc(l)}</th>`).join("")}</tr></thead>
              <tbody>
                ${c.seasons.map((s) => `
                  <tr>
                    <td>${esc(s.season)}</td>
                    <td>${s.team ? `<a href="#/${league}/team/${esc(s.team)}">${esc(s.team)}</a>` : ""}</td>
                    ${s.stats.map((v) => `<td class="tnum">${esc(v)}</td>`).join("")}
                  </tr>`).join("")}
                ${c.totals && c.totals.length ? `<tr class="tot"><td>Career</td><td></td>${c.totals.map((v) => `<td class="tnum">${esc(v)}</td>`).join("")}</tr>` : ""}
              </tbody>
            </table></div>`).join("")
          : `<div class="loading">No senior stats recorded yet${p.experience ? "" : " — rookie season ahead"}.</div>`}
          ${d.news.length ? `
            <div class="section-h" style="margin-top:26px">${esc(p.name.split(" ").slice(-1)[0])} in the news</div>
            <ul class="news">${d.news.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a></li>`).join("")}</ul>` : ""}
        </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load player (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // LANDING — the network front door (McAfee-style, Armchair brand)
  // =====================================================================

  function showLanding() {
    view.innerHTML = `
      <section class="land">
        <img class="land-hosts" src="/img/hosts.jpg" alt="Cam Luke and Ben Graham">
        <div class="land-fade"></div>
        <div class="land-core">
          <div class="neon-frame"><img class="land-logo" src="/img/logo-badge.png" alt="Armchair Experts"></div>
          <div class="land-tag">EVERY SPORT. ONE ARMCHAIR.</div>
          <div class="land-sub">The voice of sports fans in Australia</div>
          <nav class="channels" aria-label="Channels">
            <a href="#/watch">WATCH</a>
            <a href="#/leagues">LEAGUES</a>
            <a href="#/shows">SHOWS</a>
            <a href="#/podcasts">PODCASTS</a>
          </nav>
          <div class="land-soc" aria-label="Socials">
            <a href="https://www.youtube.com/watch?v=gQ2gNGiNLa4" target="_blank" rel="noopener" title="YouTube">YT</a>
            <a title="Instagram — handle to come">IG</a>
            <a title="TikTok — handle to come">TT</a>
            <a title="X — handle to come">𝕏</a>
            <a title="iHeart">♥</a>
          </div>
          <div class="land-cal" id="land-cal" aria-label="Coming up"></div>
        </div>
        <div class="land-foot">
          <span class="lf-partner">Every game · <b>7plus · Kayo · 9Now</b> — we tell you where</span>
          <span class="lf-soc">Armchair Experts — voice up front, a live sports-data spine underneath</span>
        </div>
      </section>`;
    paintLandingCalendar();
  }

  // The major-events calendar: one rail, every code, upcoming only. Data-driven
  // (data/events.json) so NRL/NBA/EPL dates are a line each, not a build.
  const EV_CODE = { NFL: "#D50A0A", AFL: "#003C9D", NBL: "#E4002B", RACING: "#C9A227", NRL: "#0B7A3B", NBA: "#1D428A", EPL: "#3D195B" };
  async function paintLandingCalendar() {
    const el = $("land-cal"); if (!el) return;
    try {
      const d = await fetchJSON("/api/events");
      const up = (d.events || []).filter((e) => !e.past).slice(0, 9);
      if (!up.length) { el.hidden = true; return; }
      const days = (t) => Math.ceil((new Date(t) - Date.now()) / 864e5);
      el.innerHTML = `<span class="lc-k">Coming up</span><div class="lc-rail">${up.map((e) => { const k = fmt(e.time); const n = days(e.time); return `
        <a class="lc-tile${e.hero ? " hero" : ""}" href="${esc(e.href || "#/leagues")}"${/^https?:/.test(e.href || "") ? ' target="_blank" rel="noopener"' : ""} style="--lc:${EV_CODE[e.code] || "#888"}">
          <span class="lc-code">${esc(e.code === "RACING" ? "Racing" : e.code)}</span>
          <span class="lc-name">${esc(e.name)}</span>
          <span class="lc-when">${k.wd} ${k.day}<i>${n <= 0 ? "today" : n === 1 ? "tomorrow" : n + " days"}</i></span>
        </a>`; }).join("")}</div>`;
    } catch { el.hidden = true; }
  }

  // =====================================================================
  // PODCASTS — Ringer-style fanned deck + episode list
  // =====================================================================

  const POD_COLORS = [
    { bg: "#FFB020", ink: "#1A0E00" },   // Armchair gold
    { bg: "#3D87E0", ink: "#FFFFFF" },   // Armchair blue
    { bg: "#F5294B", ink: "#FFFFFF" },   // brand red
    { bg: "#F6EDE4", ink: "#1A0E00" },   // chalk
    { bg: "#2A111B", ink: "#F9F3F5" },   // deep
  ];
  const POD_TILT = [-6, 3, -2, 5, -4];

  async function showPodcasts() {
    view.innerHTML = `<div class="shell"><div class="loading">Loading the pod deck…</div></div>`;
    try {
      const d = await fetchJSON("/api/shows");
      const shows = d.shows;
      const latest = (s) => (s.episodes && s.episodes[0]) || null;
      view.innerHTML = `<div class="shell">
        ${pageHero("Listen", `<em>Podcasts</em>.`, "Every show, on your couch. Pick a deck, hit play — or scroll for the latest episodes across the network.")}
        <div class="pod-stage">
          <div class="pod-deck">
            ${shows.map((s, i) => {
              const c = POD_COLORS[i % POD_COLORS.length];
              const ep = latest(s);
              const art = s.img || "/img/logo-badge.png";
              const inner = `
                <img class="pd-art" src="${esc(art)}" alt="" loading="lazy">
                <div class="pd-show">${esc(s.title)}</div>
                <div class="pd-ep">${ep ? esc(ep.title) : esc(s.cadence)}</div>
                <span class="pd-play">${s.status === "live" ? "▶" : "…"}</span>`;
              const style = `background:${c.bg}; color:${c.ink}; --tilt:${POD_TILT[i % POD_TILT.length]}deg`;
              return ep && ep.url
                ? `<a class="pod-card" style="${style}" href="${esc(ep.url)}" target="_blank" rel="noopener">${inner}</a>`
                : `<div class="pod-card" style="${style}">${inner}</div>`;
            }).join("")}
          </div>
        </div>

        <div class="section-h" style="margin-top:30px">Latest episodes</div>
        <div class="panel" style="padding:8px 18px">
          ${shows.flatMap((s) => (s.episodes || []).map((ep) => `
            <div class="ep-row">
              <span class="ep-show">${esc(s.title)}</span>
              <span class="ep-title">${esc(ep.title)}</span>
              <span class="ep-meta">${esc(ep.date)} · ${esc(ep.len)}</span>
              ${ep.url ? `<a class="watch sm ghost" href="${esc(ep.url)}" target="_blank" rel="noopener">▶ Play</a>` : `<span class="ep-soon">link soon</span>`}
            </div>`)).join("") || `<div class="loading" style="padding:14px 0">Episode feeds land here as shows go live.</div>`}
        </div>
        <p class="panel-note" style="margin-top:12px">Prototype: episode metadata is illustrative — production plugs each show's YouTube/RSS feed straight into this page.</p>
      </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load podcasts (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // A SPORTING CHRISTMAS — the 2016 miracle year, told on the data spine
  // =====================================================================

  const XMAS_LOOK = {
    LEI: { c1: "#0053A0", c2: "#021833" },   // Leicester blue
    CLE: { c1: "#860038", c2: "#2A0212" },   // Cavs wine
    WB:  { c1: "#0039A6", c2: "#0B1030" },   // Bulldogs blue
    CRO: { c1: "#0A94BC", c2: "#052733" },   // Sharks sky
    CHC: { c1: "#0E3386", c2: "#0A1026" },   // Cubs blue
  };

  async function showChristmas() {
    view.innerHTML = `<div class="shell"><div class="loading">Unwrapping 2016…</div></div>`;
    try {
      const d = await fetchJSON("/api/christmas");
      view.innerHTML = `
        <div class="team-hero xmas-hero">
          <div class="shell">
            <a class="crumb" href="#/shows">← Shows</a>
            <div class="th-row">
              <div>
                <div class="th-loc">🎄 December series · 15 episodes · ${esc(d.cadence.split("·")[2] || "three per team")}</div>
                <h1 class="th-name">${esc(d.title)}</h1>
                <div class="th-meta">${esc(d.sub)}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="shell">
          <div class="section-h" style="margin-top:24px">The year that kept topping itself</div>
          <div class="runway">
            ${d.timeline.map((t) => `
              <div class="rw"><span class="rw-when">${esc(t.when)}</span><span class="rw-dot"></span><span class="rw-what">${esc(t.what)}</span></div>`).join("")}
          </div>

          ${d.teams.map((t) => {
            const look = XMAS_LOOK[t.key] || { c1: "#8C0F27", c2: "#2A0212" };
            return `
            <article class="xmas-card" style="--xc1:${look.c1}; --xc2:${look.c2}">
              <div class="xc-wm tnum" aria-hidden="true">${esc(t.stat)}</div>
              <div class="xc-inner">
                <div class="xc-top">
                  <span class="sc-sport">${esc(t.comp)}</span>
                  <span class="xc-date">${esc(t.won)}</span>
                </div>
                <h2 class="xc-team">${esc(t.team)}</h2>
                <div class="xc-statline">
                  <span class="xc-n tnum">${esc(t.stat)}</span>
                  <span class="xc-l">${esc(t.statLabel)}</span>
                </div>
                <p class="xc-story">${esc(t.story)}</p>
                <p class="xc-night">${esc(t.night)}</p>
                <div class="xc-eps">
                  ${d.episodes.map((e, n) => `<span class="xc-ep">EP ${n + 1} · ${esc(e)}<b>DEC</b></span>`).join("")}
                </div>
              </div>
            </article>`;
          }).join("")}

          <p class="panel-note" style="margin-top:14px">Three episodes per team, released through December — the festive lead-up. Every story gets the platform treatment: the drought, the odds, the numbers under the miracle.</p>
        </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load the series (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // LEAGUES — the code picker (Spotrac pattern: one platform, many leagues)
  // =====================================================================

  // Every league runs the same shell. Adding one is an entry here plus a config
  // row on the API — the pages, hero, news and team views all come for free.
  const LEAGUE_UI = {
    nfl: { name: "NFL", label: "NFL", teamsLabel: "Teams & Players", tools: [] },
    afl: { name: "AFL", label: "AFL", teamsLabel: "Clubs & Players",
           tools: [{ label: "ListTrac ↗", href: "https://list-trac.vercel.app", ext: true,
                     title: "List management, trades, contracts, drafts" }] },
    nbl: { name: "NBL", label: "NBL", teamsLabel: "Clubs & Players", tools: [] },
    nrl: { name: "NRL", label: "NRL", teamsLabel: "Clubs", tools: [] },
    nba: { name: "NBA", label: "NBA", teamsLabel: "Teams & Players", tools: [] },
    epl: { name: "Premier League", label: "EPL", teamsLabel: "Clubs & Squads", tools: [] },
    mlb: { name: "MLB", label: "MLB", teamsLabel: "Teams & Players", tools: [] },
    cfb: { name: "College Football", label: "College", teamsLabel: "Teams & Rosters", tools: [] },
    cricket: { name: "Cricket", label: "Cricket", teamsLabel: "", tools: [] },
    tennis: { name: "Tennis", label: "Tennis", teamsLabel: "", tools: [] },
    f1: { name: "Formula 1", label: "F1", teamsLabel: "", tools: [] },
    golf: { name: "Golf", label: "Golf", teamsLabel: "", tools: [] },
    ufc: { name: "UFC", label: "UFC", teamsLabel: "", tools: [] },
    la2028: { name: "LA 2028", label: "LA 2028", teamsLabel: "", tools: [] },
    racing: { name: "Racing", label: "Racing", teamsLabel: "Jockeys & Trainers", tools: [] },
  };
  let league = "nfl";

  function leagueSubnav(lg, active) {
    const ui = LEAGUE_UI[lg] || LEAGUE_UI.nfl;
    const items = [
      { k: "watch", label: "What to Watch", href: `#/${lg}` },
      { k: "teams", label: ui.teamsLabel, href: `#/${lg}/teams` },
    ];
    return `<nav class="subnav" aria-label="${esc(ui.name)} sections"><div class="shell">
      <a class="sn-league" href="#/leagues" title="All leagues">
        <img src="${LG_LOGO(lg)}" alt=""><span>${esc(ui.label)}</span>
      </a>
      ${items.map((i) => `<a href="${i.href}" class="${i.k === active ? "on" : ""}">${esc(i.label)}</a>`).join("")}
      ${ui.tools.map((t) => `<a href="${esc(t.href)}"${t.ext ? ' target="_blank" rel="noopener"' : ""} class="sn-tool" title="${esc(t.title || "")}">${esc(t.label)}</a>`).join("")}
    </div></nav>`;
  }
  const nflSubnav = (active) => leagueSubnav(league, active);

  // Shared page hero — big condensed title with the accent word picked out.
  function pageHero(eyebrowTxt, titleHTML, subTxt) {
    return `<div class="pg-head">
      ${eyebrowTxt ? `<div class="pg-eyebrow">${eyebrowTxt}</div>` : ""}
      <h1 class="pg-h1">${titleHTML}</h1>
      ${subTxt ? `<p class="pg-sub">${esc(subTxt)}</p>` : ""}
    </div>`;
  }

  const LOCAL_MARKS = { racing: "/img/racing-mark.svg", tennis: "/img/mark-tennis.svg", cricket: "/img/mark-cricket.svg",
    golf: "/img/mark-golf.svg", ufc: "/img/mark-ufc.svg", cfb: "/img/mark-cfb.svg", la2028: "/img/mark-la28.svg" };
  function LG_LOGO(k) {
    if (LOCAL_MARKS[k]) return LOCAL_MARKS[k];
    if (k === "epl") return "https://a.espncdn.com/i/leaguelogos/soccer/500-dark/23.png";
    return `https://a.espncdn.com/i/teamlogos/leagues/500-dark/${k}.png`;
  }
  const LEAGUES = [
    { key: "NFL", name: "NFL", logo: LG_LOGO("nfl"), c1: "#013369", c2: "#D50A0A", status: "live",
      tag: "American football", line: "Every game in your time",
      desc: "What to Watch in AEST · all 32 teams · every player's career · the big stories, live.",
      cta: "Enter the NFL hub", href: "#/nfl" },
    { key: "AFL", name: "AFL", logo: LG_LOGO("afl"), c1: "#003C9D", c2: "#D50A0A", status: "live",
      tag: "Australian football", line: "Every round, every club",
      desc: "The live ladder, fixture and finals bracket, all 19 clubs and lists — plus ListTrac.",
      cta: "Enter the AFL hub", href: "#/afl" },
    { key: "NBL", name: "NBL", logo: LG_LOGO("nbl"), c1: "#0B1F3A", c2: "#E4002B", status: "live",
      tag: "Basketball", line: "Every game, every club",
      desc: "The same what-to-watch engine pointed at Australian hoops — fixtures, clubs and rosters.",
      cta: "Enter the NBL hub", href: "#/nbl" },
    { key: "NBA", name: "NBA", logo: LG_LOGO("nba"), c1: "#1D428A", c2: "#C8102E", status: "live",
      tag: "Basketball", line: "Every game in your morning",
      desc: "The nightly slate in Sydney time with win-probability, every roster and career, the Aussies, East/West standings.",
      cta: "Enter the NBA hub", href: "#/nba" },
    { key: "EPL", name: "Premier League", logo: LG_LOGO("epl"), c1: "#37003C", c2: "#00FF85", status: "live",
      tag: "Football", line: "Every match, your Saturday night",
      desc: "The weekend's fixtures in Sydney time with win-probability, the live table, all 20 clubs and squads.",
      cta: "Enter the Premier League hub", href: "#/epl" },
    { key: "MLB", name: "MLB", logo: LG_LOGO("mlb"), c1: "#041E42", c2: "#BF0D3E", status: "live",
      tag: "Baseball", line: "Every game in your morning",
      desc: "The daily slate in Sydney time, AL and NL standings, every roster and career, and the Aussies in the majors.",
      cta: "Enter the MLB hub", href: "#/mlb" },
    { key: "CFB", name: "College Football", logo: LG_LOGO("cfb"), c1: "#7A1F1F", c2: "#F2C94C", status: "live",
      tag: "American football", line: "Saturdays in the States, Sundays here",
      desc: "Every FBS game in your time with win-probability, the AP Top 25, 138 teams — and the Aussie punters.",
      cta: "Enter the College hub", href: "#/cfb" },
    { key: "CRICKET", name: "Cricket", logo: LG_LOGO("cricket"), c1: "#0B4A2A", c2: "#F2C94C", status: "live",
      tag: "Cricket", line: "The summer, every format",
      desc: "Tests, ODIs and T20Is, the Big Bash and the Shield — every match in your time, the ladder, and the big stories.",
      cta: "Enter the Cricket hub", href: "#/cricket" },
    { key: "TENNIS", name: "Tennis", logo: LG_LOGO("tennis"), c1: "#1B4D3E", c2: "#CDF564", status: "live",
      tag: "Tennis", line: "Every tour stop, every Aussie",
      desc: "This week's ATP and WTA draws in your time, the Australians in the field, the four majors.",
      cta: "Enter the Tennis hub", href: "#/tennis" },
    { key: "F1", name: "Formula 1", logo: LG_LOGO("f1"), c1: "#E10600", c2: "#15151E", status: "live",
      tag: "Motorsport", line: "Every session, your Sunday night",
      desc: "The Grand Prix weekend in your time — practice, qualifying, race — and both championships.",
      cta: "Enter the F1 hub", href: "#/f1" },
    { key: "GOLF", name: "Golf", logo: LG_LOGO("golf"), c1: "#1F5F2E", c2: "#F5F0E1", status: "live",
      tag: "Golf", line: "The leaderboard, in your morning",
      desc: "This week's PGA Tour and LPGA leaderboards with the Australians flagged, and the four majors.",
      cta: "Enter the Golf hub", href: "#/golf" },
    { key: "UFC", name: "UFC", logo: LG_LOGO("ufc"), c1: "#1A1A1A", c2: "#D20A0A", status: "live",
      tag: "Mixed martial arts", line: "Every card, every Aussie in the Octagon",
      desc: "The next card and the full fight order in your time, results, and the Australians on the roster.",
      cta: "Enter the UFC hub", href: "#/ufc" },
    { key: "LA2028", name: "LA 2028", logo: LG_LOGO("la2028"), c1: "#0B2A4A", c2: "#F2C94C", status: "live",
      tag: "Olympics", line: "The countdown to Los Angeles",
      desc: "The countdown, the key dates, the sports and the Australians to watch — sport in your morning coffee, again.",
      cta: "Enter the LA 2028 hub", href: "#/la2028" },
    { key: "NRL", name: "NRL", logo: LG_LOGO("nrl"), c1: "#0B7A3B", c2: "#1B3E8C", status: "live",
      tag: "Rugby league", line: "Every round, every club",
      desc: "The live ladder and draw, all 17 clubs, and the big stories — finals from September, Grand Final 4 October.",
      cta: "Enter the NRL hub", href: "#/nrl" },
    { key: "RACING", name: "Racing", logo: "", c1: "#1E5E3A", c2: "#C9A227", status: "live",
      tag: "Thoroughbreds", line: "Every meeting, every state",
      desc: "Today's cards ranked by black type, fields and odds, the premierships, the road to the Cup.",
      cta: "Enter the racing hub", href: "#/racing" },
  ];

  // Home = the codes played here; Abroad = the ones we watch from the armchair at odd hours
  const LEAGUE_COLS = [
    { key: "home", title: "Home", sub: "Played here", keys: ["AFL", "NRL", "CRICKET", "NBL", "RACING"] },
    { key: "abroad", title: "Abroad", sub: "Watched from here", keys: ["NFL", "NBA", "EPL", "MLB", "CFB"] },
    { key: "global", title: "Global", sub: "Tours & events", keys: ["TENNIS", "F1", "GOLF", "UFC", "LA2028"] },
  ];
  const lgCard = (l) => `
          <${l.href ? `a href="${esc(l.href)}"${l.ext ? ` target="_blank" rel="noopener"` : ""}` : "div"}
            class="lg-card ${l.status === "next" ? "lg-muted" : ""}"
            style="--c1:${l.c1}; --c2:${l.c2}">
            <div class="lg-wash"></div>
            <div class="lg-inner">
              <div class="lg-top">
                ${l.logo ? `<img class="lg-logo" src="${esc(l.logo)}" alt="${esc(l.name)} logo" loading="lazy">`
                         : `<span class="lg-logo lg-monogram" aria-hidden="true">
                              <svg viewBox="0 0 100 100" width="74" height="74">
                                <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="4"/>
                                <path d="M32 68 V44 a18 18 0 0 1 36 0 V68" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
                                <rect x="26" y="68" width="14" height="7" rx="3.5" fill="currentColor"/>
                                <rect x="60" y="68" width="14" height="7" rx="3.5" fill="currentColor"/>
                              </svg>
                            </span>`}
                ${l.status === "live" ? `<span class="lg-badge live">● Live</span>`
                  : l.status === "oct" ? `<span class="lg-badge soon">Oct</span>`
                  : `<span class="lg-badge soon">Soon</span>`}
              </div>
              <div class="lg-name">${esc(l.name)}</div>
              <div class="lg-line">${esc(l.line)}</div>
              <p class="lg-desc">${esc(l.desc)}</p>
              <div class="lg-foot">
                <span class="lg-tag">${esc(l.tag)}</span>
                ${l.cta ? `<span class="lg-cta">${esc(l.cta)}${l.href ? " →" : ""}</span>` : ""}
              </div>
            </div>
          </${l.href ? "a" : "div"}>`;

  function showLeagues() {
    const byKey = Object.fromEntries(LEAGUES.map((l) => [l.key, l]));
    view.innerHTML = `<div class="shell">
      ${pageHero("The codes", `Every sport.<br><em>One armchair.</em>`, "Fifteen codes, one platform — the ones played here, the ones we watch from here, and the tours that come to us. Live fixtures, real data, and the tools fans come back to daily.")}
      <a class="ab-banner" href="#/aussies"><span class="ab-banner-k">🇦🇺</span><span><b>Aussies Abroad</b><i>Every Australian in the world's leagues — NFL, NBA, MLB, college football, tennis, golf, F1, UFC — and when they play, in your time.</i></span><em>Open →</em></a>
      <div class="lg-cols">
        ${LEAGUE_COLS.map((c) => `
          <section class="lg-col lg-col-${c.key}">
            <div class="lg-col-h"><b>${esc(c.title)}</b><span>${esc(c.sub)}</span></div>
            <div class="lg-stack">${c.keys.map((k) => byKey[k]).filter(Boolean).map(lgCard).join("")}</div>
          </section>`).join("")}
      </div>
      <div class="section-h" style="margin-top:36px">The Monday Armchair <span class="n">· five minutes with your coffee</span></div>
      <div class="capture">
        <div class="cap-card">
          <div class="cap-h">📬 Get the weekly Armchair Experts wrap</div>
          <p class="cap-p">The week in sport, in your inbox — the latest episode, what's on, and what's worth your time.</p>
          <p class="cap-p" style="color:var(--muted); font-size:12px"><b>Coming soon.</b> Sign-ups are held here until the email tool is connected — you won't receive anything yet, and nothing is shared.</p>
          <form class="cap-form" id="sub-form">
            <input type="email" id="sub-email" placeholder="your@email.com" required autocomplete="email">
            <button class="watch" type="submit">Sign me up</button>
          </form>
          <div class="cap-note" id="sub-note"></div>
        </div>
        <div class="cap-card">
          <div class="cap-h">🎙 Ask the Experts</div>
          <p class="cap-p"><b>The best question each week gets answered on the show.</b></p>
          <form class="cap-form cap-form-col" id="mb-form">
            <textarea id="mb-q" rows="3" placeholder="Your question for the Experts…" required></textarea>
            <div class="cap-row">
              <input type="text" id="mb-name" placeholder="Name & suburb (e.g. Chris from Geelong)">
              <input type="email" id="mb-email" placeholder="Email (optional)">
            </div>
            <button class="watch" type="submit">Send it in</button>
          </form>
          <div class="cap-note" id="mb-note"></div>
        </div>
      </div>
    </div>`;
    bindCapture();
  }


  // =====================================================================
  // WATCH — the video home: big player + playlist, fed by the channel RSS
  // =====================================================================

  let watchList = [], watchIdx = 0;

  function paintWatch() {
    const v = watchList[watchIdx];
    if (!v) return;
    $("watch-player").innerHTML = `
      <iframe src="https://www.youtube-nocookie.com/embed/${esc(v.id)}?autoplay=0&rel=0"
        title="${esc(v.title)}" frameborder="0" allowfullscreen
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    $("watch-title").textContent = v.title;
    $("watch-meta").textContent = `${timeAgo(v.published)}${v.views ? " · " + v.views.toLocaleString() + " views" : ""} · Armchair Experts`;
    $("watch-desc").textContent = v.description || "";
    document.querySelectorAll(".wl-item").forEach((el, i) =>
      el.classList.toggle("on", i === watchIdx));
  }

  async function showWatch(startId) {
    view.innerHTML = `<div class="shell"><div class="loading">Loading the channel…</div></div>`;
    try {
      const d = await fetchJSON("/api/videos");
      watchList = d.videos;
      if (!watchList.length) throw new Error("no videos");
      watchIdx = Math.max(0, watchList.findIndex((v) => v.id === startId));
      view.innerHTML = `<div class="shell">
        ${pageHero("The channel", `<em>Watch</em>.`, "Every episode, interview and clip from the Armchair Experts channel — playable here, updating itself.")}
        <div class="watch-grid">
          <div class="watch-main">
            <div class="watch-player" id="watch-player"></div>
            <h2 class="watch-t" id="watch-title"></h2>
            <div class="watch-m" id="watch-meta"></div>
            <p class="watch-d" id="watch-desc"></p>
          </div>
          <aside class="watch-list">
            <div class="wl-h">Up next</div>
            ${watchList.map((v, i) => `
              <button class="wl-item" data-wi="${i}">
                <span class="wl-thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span class="wl-play">▶</span></span>
                <span class="wl-body">
                  <span class="wl-t">${esc(v.title)}</span>
                  <span class="wl-m">${timeAgo(v.published)}${v.views ? " · " + v.views.toLocaleString() + " views" : ""}</span>
                </span>
              </button>`).join("")}
          </aside>
        </div>
        <div class="section-h" style="margin-top:30px">Everything on the channel <span class="n">· latest ${watchList.length} · a new upload lands here within 15 minutes</span></div>
        <div class="vid-rail wrap">${watchList.map((v, i) => `<button class="vid-card as-btn" data-wi="${i}"><span class="vc-thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span class="vc-play">▶</span></span><span class="vc-t">${esc(v.title)}</span><span class="vc-m">${timeAgo(v.published)}${v.views ? " · " + v.views.toLocaleString() + " views" : ""}${v.league ? " · " + esc(v.league.toUpperCase()) : ""}</span></button>`).join("")}</div>
      </div>`;
      view.querySelectorAll("[data-wi]").forEach((b) =>
        b.addEventListener("click", () => { watchIdx = +b.getAttribute("data-wi"); paintWatch(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
      paintWatch();
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load the channel (${esc(err.message)}).</div></div>`;
    }
  }

  // "From the show" rail on league hubs — real episodes, league-filtered
  function videoRailHTML(videos) {
    if (!videos || !videos.length) return "";
    return `
      <div class="section-h" style="margin-top:32px">From the show <span class="n">· latest episodes</span></div>
      <div class="vid-rail">
        ${videos.slice(0, 6).map((v) => `
          <a class="vid-card" href="#/watch/${esc(v.id)}">
            <span class="vc-thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span class="vc-play">▶</span></span>
            <span class="vc-t">${esc(v.title)}</span>
            <span class="vc-m">${timeAgo(v.published)}${v.views ? " · " + v.views.toLocaleString() + " views" : ""}</span>
          </a>`).join("")}
      </div>`;
  }

  // =====================================================================
  // SHOWS — the slate + the always-on runway (the anchor)
  // =====================================================================

  // cover palettes per code -- shows without stills still get a full-bleed look
  const SHOW_LOOK = {
    "AFL": { c1: "#A62830", c2: "#26090D" },
    "NFL": { c1: "#1F4E9C", c2: "#081228" },
    "NBL": { c1: "#0E7ACB", c2: "#06202E" },
    "Multi-sport": { c1: "#1E9E67", c2: "#062519" },
    "Racing": { c1: "#B07C1E", c2: "#2A1D05" },
  };

  async function showShows() {
    view.innerHTML = `<div class="shell"><div class="loading">Loading the slate…</div></div>`;
    try {
      const d = await fetchJSON("/api/shows");
      view.innerHTML = `<div class="shell">
        ${pageHero("The slate", `The <em>shows</em>.`, "One brand, every code — the weekly habits, the series, and the specials. What's live now and what's landing next.")}
        <div class="shows-grid">
          ${d.shows.map((s) => {
            const look = SHOW_LOOK[s.sport] || { c1: "#8C0F27", c2: "#2A0212" };
            return `
            <${s.slug ? `a href="#/show/${esc(s.slug)}"` : s.url ? `a href="${esc(s.url)}"${s.url.startsWith("#") ? "" : ` target="_blank" rel="noopener"`}` : "div"} class="show-card" style="--sc1:${look.c1}; --sc2:${look.c2}">
              ${s.img ? `<img class="sc-bg" src="${esc(s.img)}" alt="" loading="lazy">` : ""}
              <div class="sc-scrim"></div>
              <div class="sc-in">
                <div class="sc-top">
                  <span class="sc-sport">${esc(s.sport)}</span>
                  <span class="sc-status ${esc(s.status)}">${s.status === "live" ? "● Live now" : "Coming"}</span>
                </div>
                <div class="sc-title">${esc(s.title)}</div>
                <div class="sc-hosts">${esc(s.hosts)}</div>
                <div class="sc-cad">${esc(s.cadence)}</div>
                <p class="sc-desc">${esc(s.desc)}</p>
                ${s.highlight ? `<div class="sc-hl">★ ${esc(s.highlight)}</div>` : ""}
                ${s.slug ? `<div class="sc-watch">${s.episodeCount ? `${s.episodeCount} episodes →` : "Show page →"}</div>` : s.url ? `<div class="sc-watch">▶ Watch</div>` : ""}
              </div>
            </${s.slug || s.url ? "a" : "div"}>`;
          }).join("")}
        </div>

        <div class="section-h" style="margin-top:34px">Always On <span class="n">· the year of Armchair — no dark weeks</span></div>
        <div class="runway">
          ${d.runway.map((r) => `
            <div class="rw ${esc(r.state || "")}">
              <span class="rw-when">${esc(r.when)}</span>
              <span class="rw-dot"></span>
              <span class="rw-what">${esc(r.what)}</span>
            </div>`).join("")}
        </div>
        <p class="panel-note" style="margin-top:14px">The shows are the voice; this platform is the anchor between episodes — live schedules, teams, players and news, every day of the year.</p>
      </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load the slate (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // AUDIENCE — who we are / who's listening (the top of every pitch deck)
  // =====================================================================

  async function showAudience() {
    view.innerHTML = `<div class="shell"><div class="loading">Loading the audience…</div></div>`;
    try {
      const d = await fetchJSON("/api/audience-profile");
      const h = d.headline, o = d.opportunity;
      const ind = (v) => v ? "" : `<span class="ind" title="Indicative — to be replaced with platform-exported figures">indicative</span>`;
      view.innerHTML = `
        <div class="team-hero aud-hero">
          <div class="shell">
            <div class="th-row">
              <div>
                <div class="th-loc">The audience · updated ${esc(d.updated)}</div>
                <h1 class="th-name">Who's in the armchair</h1>
                <div class="th-meta">A national sports audience built over seven years on television — now consolidating onto one platform.</div>
              </div>
            </div>
          </div>
        </div>
        <div class="shell">
          <div class="kpis" style="margin-top:22px">
            <div class="stat"><div class="stat-v tnum">${esc(h.reach)}</div><div class="stat-l">Monthly reach</div><div class="stat-s">${esc(h.reachLabel)}</div></div>
            <div class="stat"><div class="stat-v tnum">${esc(h.years)}</div><div class="stat-l">Years on air</div><div class="stat-s">${esc(h.yearsLabel)}</div></div>
            <div class="stat"><div class="stat-v tnum">${esc(h.codes)}</div><div class="stat-l">Codes covered</div><div class="stat-s">${esc(h.codesLabel)}</div></div>
            <div class="stat stat-hi"><div class="stat-v tnum">${esc(o.stat)}</div><div class="stat-l">The upside</div><div class="stat-s">${esc(o.statLabel)}</div></div>
          </div>

          <div class="section-h" style="margin-top:28px">Where they are <span class="n">· channel by channel</span></div>
          <div class="panel" style="padding:8px 18px">
            ${d.channels.map((c) => `
              <div class="ch-row">
                <span class="ch-name">${esc(c.name)}</span>
                <span class="ch-metric tnum">${esc(c.metric)} <b>${esc(c.unit)}</b>${ind(c.verified)}</span>
                <span class="ch-note">${esc(c.note)}</span>
              </div>`).join("")}
          </div>

          <div class="cols2">
            <div>
              <div class="section-h" style="margin-top:28px">${esc(o.title)}</div>
              <div class="panel"><p class="cap-p" style="margin:0">${esc(o.body)}</p></div>
            </div>
            <div>
              <div class="section-h" style="margin-top:28px">Who they are</div>
              <div class="panel">
                <ul class="who-list">${d.who.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
              </div>
            </div>
          </div>

          <div class="section-h" style="margin-top:28px">The trajectory <span class="n">· fragmented → consolidated → measured</span></div>
          <div class="runway">
            ${d.trajectory.map((t) => `
              <div class="rw ${esc(t.state || "")}"><span class="rw-when">${esc(t.when)}</span><span class="rw-dot"></span><span class="rw-what">${esc(t.what)}</span></div>`).join("")}
          </div>

          <div class="section-h" style="margin-top:28px">The credentials</div>
          <div class="teams-grid">
            ${d.proof.map((p) => `
              <div class="team-card" style="cursor:default">
                <div><div class="tnm" style="font-size:22px">${esc(p.n)}</div><div class="loc" style="text-transform:none; letter-spacing:0; margin-top:4px; line-height:1.4">${esc(p.l)}</div></div>
              </div>`).join("")}
          </div>

          <p class="panel-note" style="margin-top:16px">Figures marked <span class="ind">indicative</span> are the host's current working numbers and will be replaced with platform-exported analytics. Every figure on this page becomes live and audited once the platform's own tracking is running — that's the point of it.</p>
        </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load the audience (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // PARTNER dashboard (Measurement & Attribution, rendered live)
  // =====================================================================

  const fmtN = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);

  function hbars(rows, color, max) {
    const m = max || Math.max(...rows.map((r) => r.taps), 1);
    return rows.map((r) => `
      <div class="hb-row">
        <span class="hb-lbl">${esc(r.label)}</span>
        <span class="hb-track"><span class="hb-fill" style="width:${Math.max(2, r.taps / m * 100)}%;background:${r.color || color}"></span></span>
        <span class="hb-val tnum">${fmtN(r.taps)}</span>
      </div>`).join("");
  }

  function sparkline(trend, color) {
    const w = 560, h = 120, pad = 8;
    const max = Math.max(...trend.map((t) => t.taps), 1);
    const pts = trend.map((t, i) => {
      const x = pad + i * (w - 2 * pad) / (trend.length - 1);
      const y = h - pad - (t.taps / max) * (h - 2 * pad);
      return { x, y, t };
    });
    const path = pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ");
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly watch taps trend">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${color}"><title>${esc(p.t.week)}: ${p.t.taps.toLocaleString()} taps</title></circle>`).join("")}
      <text x="${last.x - 6}" y="${(last.y - 10).toFixed(1)}" text-anchor="end" class="spark-lbl">${fmtN(last.t.taps)}</text>
    </svg>
    <div class="spark-x">${trend.map((t) => `<span>${esc(t.week)}</span>`).join("")}</div>`;
  }

  async function showPartner() {
    view.innerHTML = `<div class="shell"><div class="loading">Loading partner dashboard…</div></div>`;
    try {
      const d = await fetch("/api/partner").then((r) => { if (!r.ok) throw new Error("API " + r.status); return r.json(); });
      const s = d.sample, k = s.kpis;
      const CH = { red: "#C93A52", blue: "#3B7BD0", green: "#2B9166" }; // validated chart marks
      const surfColor = { gotw: CH.red, rtg: CH.blue, wtw: CH.green };
      const conv = (k.signups / k.taps * 100).toFixed(1);
      // funnel starts at taps — reach lives in the KPI row (412k would flatten these bars to slivers)
      const pctOfTaps = (n) => Math.round(n / k.taps * 100) + "% of taps";
      const funnel = [
        { label: "Watch taps", taps: k.taps },
        { label: "Broadcaster landings · " + pctOfTaps(k.landings), taps: k.landings },
        { label: "Attributed sign-ups · " + pctOfTaps(k.signups), taps: k.signups },
      ];
      view.innerHTML = `
        <div class="team-hero partner-hero">
          <div class="shell">
            <div class="th-row">
              <div>
                <div class="th-loc">Armchair Experts × broadcast partner</div>
                <h1 class="th-name">Partner dashboard</h1>
                <div class="th-meta">${esc(s.period)} · <span class="sample-badge">Illustrative sample data</span> · live prototype taps overlaid below</div>
              </div>
            </div>
          </div>
        </div>
        <div class="shell">
          <div class="kpis">
            <div class="stat"><div class="stat-v tnum">${fmtN(k.reach)}</div><div class="stat-l">Audience reached</div><div class="stat-s">episodes + social + platform</div></div>
            <div class="stat"><div class="stat-v tnum">${fmtN(k.taps)}</div><div class="stat-l">Watch taps</div><div class="stat-s">tracked watch CTAs</div></div>
            <div class="stat"><div class="stat-v tnum">${fmtN(k.signups)}</div><div class="stat-l">Attributed sign-ups</div><div class="stat-s">via utm_source=armchair</div></div>
            <div class="stat"><div class="stat-v tnum">${conv}%</div><div class="stat-l">Tap → sign-up</div><div class="stat-s">conversion, 7-day window</div></div>
          </div>

          <div class="section-h" style="margin-top:28px">The funnel <span class="n">· tap → subscriber</span></div>
          <div class="panel">${hbars(funnel, CH.red, k.taps)}</div>

          <div class="cols2">
            <div>
              <div class="section-h" style="margin-top:28px">What's driving taps <span class="n">· by storyline</span></div>
              <div class="panel">${hbars(s.storylines, CH.red)}</div>
            </div>
            <div>
              <div class="section-h" style="margin-top:28px">Where taps happen <span class="n">· by surface</span></div>
              <div class="panel">${hbars(s.surfaces.map((x) => ({ ...x, color: surfColor[x.key] })), CH.red)}</div>
              <div class="section-h" style="margin-top:22px">Weekly taps <span class="n">· season arc</span></div>
              <div class="panel">${sparkline(s.trend, CH.red)}</div>
            </div>
          </div>

          <div class="section-h" style="margin-top:28px">How attribution works</div>
          <div class="panel mech">
            <div class="mech-step"><b>1</b><div><b>Storyline</b><br>Cam & Ben call the game — on the show, on socials, on this platform</div></div>
            <i>→</i>
            <div class="mech-step"><b>2</b><div><b>Tracked tap</b><br>every Watch CTA carries <code>utm_source=armchair</code> + surface + storyline</div></div>
            <i>→</i>
            <div class="mech-step"><b>3</b><div><b>Broadcaster landing</b><br>UTMs flow into the partner's analytics unchanged</div></div>
            <i>→</i>
            <div class="mech-step"><b>4</b><div><b>Attributed sign-up</b><br>subscriptions credited to the storyline that drove them — reported weekly</div></div>
          </div>

          <div class="section-h" style="margin-top:28px">Live prototype taps <span class="n">· recorded this session</span></div>
          <div class="panel">
            ${d.live.length ? `<div class="tbl-wrap" style="border:none"><table class="roster stats" style="min-width:420px">
              <thead><tr><th>Surface</th><th>Campaign</th><th>Storyline</th><th class="tnum">Taps</th></tr></thead>
              <tbody>${d.live.map((l) => `<tr><td>${esc(l.medium)}</td><td>${esc(l.campaign)}</td><td>${esc(l.content)}</td><td class="tnum">${l.count}</td></tr>`).join("")}</tbody>
            </table></div>`
            : `<div class="loading" style="padding:14px 0">No taps recorded yet this session — hit any <b>Watch</b> button on the hub and refresh this page.</div>`}
            <div class="panel-note">Live counters are per-instance for the prototype; production wires this to a persistent store (same pattern as the AFL build).</div>
          </div>
        </div>`;
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load the dashboard (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // router
  // =====================================================================

  // =====================================================================
  // RACING — the fourth code on the same shell. Feed: /api/racing/* (racing.com's
  // national GraphQL). What to Watch = today's meetings ranked by black type;
  // the "ladder" = premierships; the "MCG countdown" = Road to the Cup;
  // "Teams & Players" = jockeys, trainers and horses.
  // =====================================================================
  const RC_STATE_NAME = { VIC: "Victoria", NSW: "New South Wales", QLD: "Queensland", SA: "South Australia",
                          WA: "Western Australia", ACT: "ACT", TAS: "Tasmania", NT: "Northern Territory" };
  const RC_GROUP_CLS = (g) => !g ? "" : g === "Group 1" ? "g1" : g === "Group 2" ? "g2" : g === "Group 3" ? "g3" : "lr";
  const rcGroupChip = (g) => g ? `<span class="rc-grp ${RC_GROUP_CLS(g)}">${esc(g === "Listed" ? "Listed" : g.replace("Group ", "G"))}</span>` : "";
  const rcDay = (d) => { const x = new Date(d + "T12:00:00+10:00"); return { wd: x.toLocaleDateString("en-AU", { weekday: "long", timeZone: "Australia/Melbourne" }), dm: x.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }) }; };
  const rcMelToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
  const rcShift = (d, n) => { const x = new Date(d + "T12:00:00+10:00"); x.setUTCDate(x.getUTCDate() + n); return x.toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" }); };
  const rcWatchFor = (state) => state === "VIC" ? WATCH.racing[0] : WATCH.racing[2];
  const rcWatchBtn = (state, cls) => {
    const p = rcWatchFor(state), rest = WATCH.racing.filter((w) => w !== p);
    return `<span class="watch-row"><a class="watch ${cls || ""}" href="${esc(p.url)}" target="_blank" rel="noopener" data-plat="${esc(p.key)}"><span class="tv">▶</span> Watch on ${esc(p.label)}</a>${rest.map((w) => `<a class="watch-chip" href="${esc(w.url)}" target="_blank" rel="noopener" data-plat="${esc(w.key)}" title="${esc(w.sub)}">${esc(w.label)}</a>`).join("")}</span>`;
  };
  const rcSubnav = (active) => {
    const items = [{ k: "watch", label: "What to Watch", href: "#/racing" }, { k: "prem", label: "Jockeys & Trainers", href: "#/racing/premierships" }];
    return `<nav class="subnav" aria-label="Racing sections"><div class="shell">
      <a class="sn-league" href="#/leagues" title="All leagues"><img src="/img/racing-mark.svg" alt=""><span>Racing</span></a>
      ${items.map((i) => `<a href="${i.href}" class="${i.k === active ? "on" : ""}">${esc(i.label)}</a>`).join("")}
      <a href="https://www.racing.com" target="_blank" rel="noopener" class="sn-tool" title="Full form, replays and vision on Racing.com">Racing.com ↗</a>
    </div></nav>`;
  };
  let rcCountdown = null, rcNextTimer = null, rcSort = "watch";
  // "WINX STAKES [GROUP 1]" -> "Winx Stakes"; keeps apostrophes sane
  const rcTitle = (n) => (n || "").replace(/\s*\[.*?\]\s*/g, "").toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (m, a, b) => a + b.toUpperCase());

  function rcHubHTML(date) {
    const d = rcDay(date), today = date === rcMelToday();
    return `${rcSubnav("watch")}
    <div class="ribbon"><div class="shell">
      <button class="wknav" id="rc-day-prev" aria-label="Previous day">‹</button>
      <span class="wk" id="wk-label">${esc(today ? "Today" : d.wd)} · ${esc(d.dm)} · What to Watch</span>
      <button class="wknav" id="rc-day-next" aria-label="Next day">›</button>
      <span class="sub">Every meeting in every state, jump times in your time.</span>
    </div></div>
    <div class="ticker" id="ticker" hidden><span class="tk-label">Headlines</span><div class="tk-win"><div class="tk-track" id="tk-track"></div></div></div>
    <div class="shell">
      <div id="loading" class="loading">Fetching the fields…</div>
      <div id="content" hidden>
        <div class="hero-split"><section id="lead"></section><section id="rtg"></section></div>
        <section id="rtg-rail"></section>
        <section id="rc-next"></section>
        <section id="vid-wrap"></section>
        <section id="news-wrap" hidden>
          <div class="section-h" style="margin-top:28px">The Big Stories <span class="n" id="news-note">· live from the wires</span></div>
          <div class="news-cols"><div class="news-grid" id="news"></div><aside class="top5" id="top5"></aside></div>
        </section>
        <section id="rc-prem"></section>
        <section id="rc-weekend"></section>
        <div class="section-h" style="margin-top:30px">Race of the Day</div>
        <section class="gotw" id="rc-rod"></section>
        <div class="section-h" style="margin-top:30px">The Meetings <span class="n" id="rc-count"></span></div>
        <div class="controls">
          <div class="seg" role="group" aria-label="Timezone"><span class="k">Times</span>
            <button data-tz="Australia/Sydney">Sydney</button><button data-tz="Australia/Brisbane">Brisbane</button><button data-tz="Australia/Perth">Perth</button></div>
          <div class="seg" role="group" aria-label="Sort"><span class="k">Sort</span>
            <button data-rsort="watch">Watchability</button><button data-rsort="time">First race</button></div>
          <span class="ctl-note" id="tz-note"></span>
        </div>
        <div class="rc-slate" id="rc-slate"></div>
      </div>
    </div>`;
  }

  let rcHub = null;   // {date, slate, features, prem}

  // =====================================================================
  // TOUR HUB — tennis / F1 / golf / UFC: an event, its competitions, the Aussies
  // =====================================================================
  const tourSubnav = (lg, extra) => `<nav class="subnav" aria-label="${esc((LEAGUE_UI[lg] || {}).name || lg)}"><div class="shell">
      <a class="sn-league" href="#/leagues" title="All leagues"><img src="${LG_LOGO(lg)}" alt=""><span>${esc((LEAGUE_UI[lg] || {}).label || lg)}</span></a>
      <a href="#/${lg}" class="on">What to Watch</a>${extra || ""}
    </div></nav>`;
  const flagImg = (a) => a.flag ? `<img class="tr-flag" src="${esc(a.flag)}" alt="${esc(a.country || "")}" title="${esc(a.country || "")}">` : "";
  const auTag = (a) => a.aussie ? `<i class="tr-au">AU</i>` : "";
  const dayLbl = (iso) => { if (!iso) return ""; const k = fmt(iso); return `${k.wd} ${k.day} · ${k.tm} ${TZ_LABEL[tz]}`; };
  const F1_SESSION = { FP1: "Practice 1", FP2: "Practice 2", FP3: "Practice 3", SS: "Sprint Qualifying", SQ: "Sprint Qualifying", SR: "Sprint", Qual: "Qualifying", Race: "Race" };
  const cdown = (iso) => { const ms = new Date(iso) - Date.now(); if (ms <= 0) return ""; const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4); return d ? `${d}d ${h}h` : `${h}h ${m}m`; };

  async function showTour(lg) {
    view.innerHTML = `${tourSubnav(lg)}<div class="shell"><div class="loading">Loading the tour…</div></div>`;
    try {
      const [t, featured, vids] = await Promise.all([
        fetchJSON(`/api/tour/${lg}`),
        fetchJSON(`/api/featured?league=${lg}`).catch(() => null),
        fetchJSON(`/api/videos?league=${lg}`).catch(() => null),
      ]);
      const events = t.events || [];
      const unit = t.unit;
      // hero event: live first, else next upcoming, else the most recent
      const live = events.find((e) => e.state === "in"), next = events.find((e) => e.state === "pre");
      const hero = live || next || events[0];
      const rest = events.filter((e) => e !== hero);
      const compRow = (c) => {
        const done = c.state === "post";
        const cs = c.competitors || [];
        if (unit === "leaderboard") return "";
        const side = (a) => a ? `<span class="tr-side${a.winner ? " won" : ""}${a.aussie ? " au" : ""}">${flagImg(a)}<b>${esc(a.name)}</b>${a.seed ? `<i>(${esc(a.seed)})</i>` : ""}${a.record ? `<i>${esc(a.record)}</i>` : ""}${a.team ? `<i>${esc(a.team)}</i>` : ""}${auTag(a)}</span>` : "<span></span>";
        const score = done && cs.length === 2 && cs[0].linescores.length ? `<span class="tr-score tnum">${cs.map((a) => a.linescores.join(" ")).join(" · ")}</span>` : (done && cs.length === 2 && cs[0].score != null ? `<span class="tr-score tnum">${esc(cs[0].score)} – ${esc(cs[1].score)}</span>` : "");
        return `<div class="tr-comp${done ? " done" : ""}${c.state === "in" ? " live" : ""}">
          <span class="tr-lbl">${esc(unit === "session" ? (F1_SESSION[c.label] || c.label) : c.label)}${c.weight && c.weight !== c.label ? ` · ${esc(c.weight)}` : ""}${c.draw ? ` · ${esc(c.draw)}` : ""}</span>
          <div class="tr-vs">${side(cs[0])}<em>${unit === "fight" ? "vs" : unit === "match" ? "v" : ""}</em>${side(cs[1])}</div>
          <span class="tr-when">${c.state === "in" ? '<span class="badge-live">● Live</span> ' : ""}${done ? esc(c.detail || "Final") : dayLbl(c.date)}${c.venue ? ` · ${esc(c.venue)}` : ""}</span>
          ${score}
        </div>`;
      };
      const leaderboard = (e) => {
        const c = e.competitions[0]; if (!c) return "";
        const rows = c.competitors.slice().sort((a, b) => (a.order || 999) - (b.order || 999));
        return `<div class="tr-lb">
          <div class="tr-lb-h"><span>Pos</span><span>Player</span><span>Score</span><span>Rounds</span></div>
          ${rows.slice(0, 25).map((a) => `<div class="tr-lb-r${a.aussie ? " au" : ""}"><span class="tnum">${a.order ?? ""}</span><span>${flagImg(a)}<b>${esc(a.name)}</b>${auTag(a)}</span><span class="tnum"><b>${esc(a.score ?? "")}</b></span><span class="tnum">${a.linescores.join(" · ")}</span></div>`).join("")}
          ${rows.filter((a) => a.aussie && rows.indexOf(a) >= 25).map((a) => `<div class="tr-lb-r au"><span class="tnum">${a.order ?? ""}</span><span>${flagImg(a)}<b>${esc(a.name)}</b>${auTag(a)}</span><span class="tnum"><b>${esc(a.score ?? "")}</b></span><span class="tnum">${a.linescores.join(" · ")}</span></div>`).join("")}
        </div>`;
      };
      const eventBlock = (e, big) => {
        const comps = e.competitions || [];
        // in tennis, lead with the Aussies' matches, then the latest round; cap the list
        let shown = comps;
        if (unit === "match") {
          const au = comps.filter((c) => c.competitors.some((a) => a.aussie));
          const others = comps.filter((c) => !c.competitors.some((a) => a.aussie));
          const latestRound = others.length ? others[others.length - 1].label : "";
          shown = au.concat(others.filter((c) => c.label === latestRound)).slice(0, big ? 24 : 8);
        } else if (unit === "fight") shown = comps.slice().reverse();  // main event first
        const upcoming = e.state === "pre" && e.date;
        return `<section class="tr-event${big ? " big" : ""}${e.state === "in" ? " live" : ""}">
          <div class="tr-ev-h">
            <div><span class="tr-feed">${esc(e.feed)}${e.major ? " · MAJOR" : ""}</span><h2 class="tr-name">${esc(e.name)}</h2>
              <div class="tr-meta">${e.venue ? esc(e.venue) + " · " : ""}${e.date ? esc(fmt(e.date).wd + " " + fmt(e.date).day) : ""}${e.endDate && e.endDate !== e.date ? " – " + esc(fmt(e.endDate).wd + " " + fmt(e.endDate).day) : ""}${e.state === "in" ? ' · <span class="badge-live">● Live</span>' : e.state === "post" ? " · Final" : ""}</div></div>
            ${upcoming && cdown(e.date) ? `<div class="tr-cd"><b class="tnum">${cdown(e.date)}</b><span>to first ${unit === "session" ? "session" : unit === "fight" ? "walkout" : "ball"}</span></div>` : ""}
          </div>
          ${unit === "leaderboard" ? leaderboard(e) : `<div class="tr-comps">${shown.map(compRow).join("")}</div>`}
          ${unit === "match" && comps.length > shown.length ? `<div class="panel-note">${comps.length} matches in the draw — showing the Australians and the latest round.</div>` : ""}
        </section>`;
      };
      const standings = t.standings ? `
        <div class="section-h" style="margin-top:30px">The Championships <span class="n">· live</span></div>
        <div class="ladder">
          ${["drivers", "constructors"].filter((k) => t.standings[k]).map((k) => `<div class="lad-col">
            <div class="lad-head"><span></span><span></span><span>${k === "drivers" ? "Driver" : "Constructor"}</span><span></span><span></span><span>Pts</span><span></span></div>
            ${t.standings[k].map((r) => `<div class="lad-row${r.rank <= 3 ? " in-six" : ""}${r.aussie ? " au" : ""}"><span class="lad-pos tnum">${r.rank}</span>${r.flag ? `<img class="lad-logo" src="${esc(r.flag)}" alt="">` : r.logo ? `<img class="lad-logo" src="${esc(r.logo)}" alt="">` : "<span></span>"}<span class="lad-team">${esc(r.name)}${r.aussie ? ' <i class="tr-au">AU</i>' : ""}</span><span></span><span></span><span class="lad-pts tnum">${esc(r.points)}</span><span></span></div>`).join("")}
          </div>`).join("")}
        </div>` : "";
      const aussies = t.aussies && t.aussies.length ? `
        <div class="section-h" style="margin-top:30px">The Australians <span class="n">· in the field</span></div>
        <div class="aus">${t.aussies.slice(0, 12).map((a) => `<div class="p"><div class="pos">${flagImg(a)} 🇦🇺 ${esc(a.event)}</div><div class="pn">${esc(a.name)}</div><div class="pt">${esc(a.compLabel || "")}${a.compDate ? " · " + esc(dayLbl(a.compDate)) : ""}</div>${a.team ? `<div class="pg">${esc(a.team)}</div>` : ""}</div>`).join("")}</div>` :
        (lg === "f1" && t.standings && t.standings.drivers ? `
        <div class="section-h" style="margin-top:30px">The Australians <span class="n">· on the grid</span></div>
        <div class="aus">${t.standings.drivers.filter((r) => r.aussie).map((r) => `<div class="p"><div class="pos">🇦🇺 P${r.rank} in the championship</div><div class="pn">${esc(r.name)}</div><div class="pt">${esc(r.points)} points</div></div>`).join("")}</div>` : "");
      view.innerHTML = `${tourSubnav(lg)}
        <div class="ribbon"><div class="shell"><span class="wk">${esc(t.name)} · What to Watch</span><span class="sub">Every ${unit === "session" ? "session" : unit === "fight" ? "fight" : unit === "leaderboard" ? "round" : "match"} in Sydney time.</span></div></div>
        <div class="shell">
          <div class="hero-solo"><section id="lead"></section></div>
          ${hero ? eventBlock(hero, true) : `<div class="panel roster-empty"><p>Nothing on the schedule right now.</p></div>`}
          <div class="watch-row" style="margin-top:12px">${(WATCH[lg] || []).map((w, i) => `<a class="${i ? "watch-chip" : "watch"}" href="${esc(w.url)}" target="_blank" rel="noopener" data-plat="${esc(w.key)}">${i ? "" : "▶ "}${esc(i ? w.label : "Watch on " + w.label)}</a>`).join("")}</div>
          <section id="vid-wrap"></section>
          <section id="news-wrap" hidden>
            <div class="section-h" style="margin-top:28px">The Big Stories <span class="n" id="news-note">· live from the wires</span></div>
            <div class="news-cols"><div class="news-grid" id="news"></div><aside class="top5" id="top5"></aside></div>
          </section>
          ${standings}
          ${aussies}
          ${rest.length ? `<div class="section-h" style="margin-top:30px">${live || next ? "Also on the tour" : "Coming up"}</div>${rest.slice(0, 4).map((e) => eventBlock(e, false)).join("")}` : ""}
        </div>`;
      renderLead(featured); renderNews(featured);
      const vw = $("vid-wrap"); if (vw) vw.innerHTML = videoRailHTML(vids && vids.videos);
      armMotion();
    } catch (err) {
      view.innerHTML = `${tourSubnav(lg)}<div class="shell"><div class="loading">Couldn't load the tour (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // CRICKET HUB — the summer's matches across formats, the BBL ladder, the stories
  // =====================================================================
  async function showCricket() {
    view.innerHTML = `${tourSubnav("cricket")}<div class="shell"><div class="loading">Loading the summer…</div></div>`;
    try {
      const [c, featured, vids] = await Promise.all([
        fetchJSON("/api/cricket"),
        fetchJSON("/api/featured?league=cricket").catch(() => null),
        fetchJSON("/api/videos?league=cricket").catch(() => null),
      ]);
      const ms = c.matches || [];
      const teamCell = (t) => `<span class="ck-team${t.winner ? " won" : ""}">${t.logo ? `<img src="${esc(t.logo)}" alt="">` : ""}<b>${esc(t.name)}</b>${t.score ? `<span class="tnum">${esc(t.score)}</span>` : ""}</span>`;
      const card = (m) => `<a class="ck-match${m.state === "in" ? " live" : m.state === "post" ? " done" : ""}${m.australia ? " au" : ""}" href="${m.id ? "#/cricket" : "#/cricket"}">
          <div class="ck-comp">${esc(m.competition)}${m.state === "in" ? ' <span class="badge-live">● Live</span>' : ""}</div>
          <div class="ck-teams">${(m.teams || []).map(teamCell).join('<em>v</em>')}</div>
          <div class="ck-when">${m.state === "post" ? esc(m.detail || "Result") : dayLbl(m.date)}${m.venue ? " · " + esc(m.venue) : ""}</div>
          ${m.note ? `<div class="ck-note">${esc(m.note)}</div>` : ""}
        </a>`;
      const season = c.season || {};
      view.innerHTML = `${tourSubnav("cricket")}
        <div class="ribbon"><div class="shell"><span class="wk">${esc(season.label || "Cricket")} · What to Watch</span><span class="sub">${esc(season.line || "Every match in Sydney time.")}</span></div></div>
        <div class="shell">
          <div class="hero-solo"><section id="lead"></section></div>
          <div class="section-h" style="margin-top:28px">The Matches <span class="n">· ${ms.length ? "next up across every competition" : "the summer is coming"}</span></div>
          ${ms.length ? `<div class="ck-grid">${ms.slice(0, 12).map(card).join("")}</div>` : `<div class="panel roster-empty"><p>${esc(season.line || "No matches scheduled yet.")}</p></div>`}
          <div class="watch-row" style="margin-top:12px">${(WATCH.cricket || []).map((w, i) => `<a class="${i ? "watch-chip" : "watch"}" href="${esc(w.url)}" target="_blank" rel="noopener" data-plat="${esc(w.key)}">${i ? "" : "▶ "}${esc(i ? w.label : "Watch on " + w.label)}</a>`).join("")}<span class="watch-also">${esc(season.watch || "")}</span></div>
          <section id="vid-wrap"></section>
          <section id="news-wrap" hidden>
            <div class="section-h" style="margin-top:28px">The Big Stories <span class="n" id="news-note">· live from the wires</span></div>
            <div class="news-cols"><div class="news-grid" id="news"></div><aside class="top5" id="top5"></aside></div>
          </section>
          ${c.ladder && c.ladder.length ? `
          <div class="section-h" style="margin-top:30px">Big Bash Ladder <span class="n">· official standings</span></div>
          <div class="lad-wrap solo"><div class="lad-col">
            <div class="lad-head"><span></span><span></span><span>Club</span><span>W–L</span><span>NRR</span><span>Pts</span><span></span></div>
            ${c.ladder.map((r) => `<a class="lad-row${r.rank <= 4 ? " in-six" : ""}" href="#/cricket"><span class="lad-pos tnum">${r.rank}</span>${r.logo ? `<img class="lad-logo" src="${esc(r.logo)}" alt="">` : "<span></span>"}<span class="lad-team">${esc(r.name)}</span><span class="lad-rec tnum">${esc(r.won ?? "")}–${esc(r.lost ?? "")}</span><span class="lad-pct tnum">${esc(r.nrr ?? "")}</span><span class="lad-pts tnum">${esc(r.points ?? "")}</span><span></span></a>`).join("")}
          </div></div>` : ""}
        </div>`;
      renderLead(featured); renderNews(featured);
      const vw = $("vid-wrap"); if (vw) vw.innerHTML = videoRailHTML(vids && vids.videos);
      armMotion();
    } catch (err) {
      view.innerHTML = `${tourSubnav("cricket")}<div class="shell"><div class="loading">Couldn't load cricket (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // LA 2028 — the countdown hub
  // =====================================================================
  let laTimer = null;
  async function showLA2028() {
    clearInterval(laTimer);
    view.innerHTML = `${tourSubnav("la2028")}<div class="shell"><div class="loading">Loading…</div></div>`;
    try {
      const [d, featured] = await Promise.all([fetchJSON("/api/la2028"), fetchJSON("/api/featured?league=la2028").catch(() => null)]);
      const open = new Date(d.opening);
      const k = fmt(d.opening);
      view.innerHTML = `${tourSubnav("la2028")}
        <div class="team-hero la-hero"><div class="shell">
          <div class="th-loc">${esc(d.sub || "")}</div>
          <h1 class="th-name">${esc(d.title || "LA 2028")}</h1>
          <div class="la-cd"><span class="tnum" id="la-cd">—</span><span class="la-cd-l">until the Opening Ceremony · ${esc(k.wd)} ${esc(k.day)} · ${esc(k.tm)} ${TZ_LABEL[tz]}</span></div>
          <p class="la-note">${esc(d.timeNote || "")}</p>
        </div></div>
        <div class="shell">
          <div class="kpis" style="margin-top:22px">${(d.facts || []).map((f) => `<div class="stat"><div class="stat-v">${esc(f.k)}</div><div class="stat-s">${esc(f.l)}</div></div>`).join("")}</div>
          <div class="section-h" style="margin-top:30px">The road to LA</div>
          <div class="runway">${(d.milestones || []).map((m) => `<div class="rw"><span class="rw-when">${esc(m.when)}</span><span class="rw-dot"></span><span class="rw-what">${esc(m.what)}</span></div>`).join("")}</div>
          <div class="section-h" style="margin-top:30px">The sports <span class="n">· where Australia plays</span></div>
          <div class="la-sports">${(d.sports || []).map((s) => `<div class="la-sport"><b>${esc(s.name)}</b><span>${esc(s.note)}</span><i>${esc(s.venue || "")}</i></div>`).join("")}</div>
          <div class="section-h" style="margin-top:30px">The Australians <span class="n">· to watch</span></div>
          <div class="aus">${(d.aussies || []).map((a) => `<div class="p"><div class="pos">🇦🇺 ${esc(a.sport)}</div><div class="pn">${esc(a.name)}</div><div class="pg">${esc(a.hook)}</div></div>`).join("")}</div>
          <div class="watch-row" style="margin-top:16px">${(d.watch || []).map((w, i) => `<a class="${i ? "watch-chip" : "watch"}" href="${esc(w.url)}" target="_blank" rel="noopener">${i ? "" : "▶ "}${esc(i ? w.label : "Watch on " + w.label)}</a>`).join("")}<span class="watch-also">Nine holds the Games through Brisbane 2032.</span></div>
          <section id="news-wrap" hidden>
            <div class="section-h" style="margin-top:28px">The Big Stories <span class="n" id="news-note">· live from the wires</span></div>
            <div class="news-cols"><div class="news-grid" id="news"></div><aside class="top5" id="top5"></aside></div>
          </section>
        </div>`;
      const tick = () => { const el = $("la-cd"); if (!el) { clearInterval(laTimer); return; } const ms = open - Date.now(); const dd = Math.floor(ms / 864e5), hh = Math.floor((ms % 864e5) / 36e5), mm = Math.floor((ms % 36e5) / 6e4), ss = Math.floor((ms % 6e4) / 1e3); el.textContent = `${dd}d ${hh}h ${mm}m ${ss}s`; };
      tick(); laTimer = setInterval(tick, 1000);
      renderNews(featured); armMotion();
    } catch (err) {
      view.innerHTML = `${tourSubnav("la2028")}<div class="shell"><div class="loading">Couldn't load (${esc(err.message)}).</div></div>`;
    }
  }

  async function showRacingHub(date) {
    date = date || rcMelToday();
    clearInterval(rcCountdown); clearInterval(rcNextTimer);
    view.innerHTML = rcHubHTML(date);
    $("rc-day-prev").onclick = () => { location.hash = "#/racing/day/" + rcShift(date, -1); };
    $("rc-day-next").onclick = () => { location.hash = "#/racing/day/" + rcShift(date, 1); };
    view.querySelectorAll("[data-tz]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-tz") === tz));
      b.addEventListener("click", () => { tz = b.getAttribute("data-tz"); localStorage.setItem(TZ_KEY, tz);
        view.querySelectorAll("[data-tz]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); rcPaintSlate(); rcPaintRod(); rcPaintRtg(); rcPaintRail(); });
    });
    view.querySelectorAll("[data-rsort]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-rsort") === rcSort));
      b.addEventListener("click", () => { rcSort = b.getAttribute("data-rsort"); view.querySelectorAll("[data-rsort]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); rcPaintSlate(); });
    });
    try {
      const [slate, features, featured, vids, prem, nxt, weekend] = await Promise.all([
        fetchJSON(`/api/racing/meetings?date=${date}`),
        fetchJSON("/api/racing/features").catch(() => null),
        fetchJSON("/api/featured?league=racing").catch(() => null),
        fetchJSON("/api/videos?league=racing").catch(() => null),
        fetchJSON("/api/racing/premierships?entity=Jockey&size=10").catch(() => null),
        fetchJSON("/api/racing/next").catch(() => null),
        fetchJSON("/api/racing/weekend").catch(() => null),
      ]);
      rcHub = { date, slate, features, prem, nxt, weekend };
      renderLead(featured); renderNews(featured);
      rcPaintRtg(); rcPaintRail(); rcPaintNext(); rcPaintPrem(prem); rcPaintWeekend(); rcPaintRod(); rcPaintSlate();
      const vw = $("vid-wrap"); if (vw) vw.innerHTML = videoRailHTML(vids && vids.videos);
      $("tz-note").textContent = "Jump times converted live to " + TZ_LABEL[tz] + " time";
      armMotion();
      $("loading").hidden = true; $("content").hidden = false;
      if (date === rcMelToday()) rcNextTimer = setInterval(async () => {
        if (document.hidden || !$("rc-next")) return;
        try { rcHub.nxt = await fetchJSON("/api/racing/next"); rcPaintNext(); } catch { /* next tick */ }
      }, 60000);
    } catch (err) {
      $("loading").innerHTML = `We couldn't refresh the racing feed (${esc(err.message)}). <button class="watch sm ghost" id="rc-retry">Try again</button>`;
      $("rc-retry")?.addEventListener("click", () => { _cache.clear(); track("retry_module", "racing"); showRacingHub(date); });
    }
  }

  // Road to the Cup — the MCG-countdown analogue: the season's hero major, with the next major up top
  function rcPaintRtg() {
    const el = $("rtg"); if (!el || !rcHub) return;
    const f = rcHub.features; if (!f || !f.hero) { el.innerHTML = ""; return; }
    const hero = f.hero, nxt = f.next && f.next.key !== hero.key ? f.next : null;
    const k = fmt(hero.time);
    el.innerHTML = `
      <div class="rtg rtg-tall rc-rtg">
        <div class="rtg-kicker">🏇 Road to the Cup</div>
        <div class="rc-cup-h">${esc(hero.name)} <span class="rc-grp g1">G1</span></div>
        <div class="rtg-venue">${esc(hero.venue)} · ${esc(hero.distance)} · ${esc(hero.prize)}</div>
        <div class="rtg-count"><div class="rtg-cd tnum" id="rc-cd">—</div><div class="rtg-cd-lbl">until the ${esc(hero.name)} · ${k.wd} ${k.day} at ${k.tm} ${TZ_LABEL[tz]}</div></div>
        ${nxt ? `<div class="rc-nextmajor"><span class="rc-nm-k">Next up</span> <b>${esc(nxt.name)}</b> ${rcGroupChip(nxt.group)} <span>${esc(nxt.venue)} · ${fmt(nxt.time).wd} ${fmt(nxt.time).day}</span></div>` : ""}
        ${rcWatchBtn(hero.state, "")}
        <div class="rtg-arc">${["Build up", "Carnival", "Cup week"].map((x, i) => `<b class="${i === (Date.now() > new Date(hero.time).getTime() - 7 * 864e5 ? 2 : Date.now() > new Date("2026-10-01T00:00:00Z").getTime() ? 1 : 0) ? "on" : ""}">${x}</b>`).join("<i>→</i>")}</div>
      </div>`;
    clearInterval(rcCountdown);
    const tick = () => { const s = Math.max(0, Math.floor((new Date(hero.time) - Date.now()) / 1000)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; const c = $("rc-cd"); if (c) c.textContent = s ? `${d}d ${h}h ${m}m ${x}s` : "It's on"; };
    tick(); rcCountdown = setInterval(tick, 1000);
  }

  // The Spring — the advent-rail analogue: every major, past ones ticked, next one live
  function rcPaintRail() {
    const el = $("rtg-rail"); if (!el || !rcHub) return;
    const f = rcHub.features; const majors = (f && f.majors) || [];
    if (!majors.length) { el.innerHTML = ""; return; }
    const nextKey = f.next && f.next.key;
    el.innerHTML = `<div class="rtg-rail rc-rail">
      <div class="rtg-rail-h"><b class="rtg-rail-t">THE SPRING</b> — ${esc(f.season)} · every Group 1 that matters, in your time. ${esc(f.note ? "" : "")}</div>
      <div class="rtg-eps">${majors.map((m) => { const k = fmt(m.time); const st = m.past ? "open" : (m.key === nextKey ? "today" : "locked"); return `
        <div class="rtg-ep rc-major adv-${st}${m.hero ? " hero" : ""}">
          <span class="adv-d">${k.wd} ${k.day}</span>
          <span class="n">${esc(m.venue)} · ${esc(m.distance)}</span>
          <span class="t">${esc(m.name)}</span>
          <span class="g">${rcGroupChip(m.group)} ${esc(m.prize)}</span>
          <span class="s">${m.past ? "✓ Run" : (st === "today" ? "● NEXT · " + k.tm + " " + TZ_LABEL[tz] : k.tm + " " + TZ_LABEL[tz])}</span>
        </div>`; }).join("")}</div></div>`;
  }

  function rcPaintNext() {
    const el = $("rc-next"); if (!el || !rcHub) return;
    const races = (rcHub.nxt && rcHub.nxt.races) || [];
    if (!races.length || rcHub.date !== rcMelToday()) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="rc-ntj"><span class="rc-ntj-k">Next to jump</span>${races.slice(0, 6).map((r) => `
      <a class="rc-ntj-i" href="#/racing/race/${esc(r.meetId)}/${r.number}"><b>${esc(r.venue)}</b> R${r.number} ${rcGroupChip(r.group)}<i>${fmt(r.time).tm}</i></a>`).join("")}</div>`;
  }

  // Premierships — the ladder analogue, with this week's black type as the aside
  function rcPaintPrem(prem) {
    const el = $("rc-prem"); if (!el) return;
    const rows = (prem && prem.rows) || [];
    const week = (rcHub && rcHub.features && rcHub.features.week) || [];
    el.innerHTML = `
      <div class="section-h" style="margin-top:30px">The Premiership <span class="n">· ${esc(prem ? prem.label : "")} · national jockeys · <a href="#/racing/premierships">all tables →</a></span></div>
      <div class="lad-wrap${week.length ? "" : " solo"}">
        <div class="lad-col">
          <div class="lad-head rc-ph"><span></span><span>Jockey</span><span>Wins</span><span>Rides</span><span>Strike</span><span>Prize</span></div>
          ${rows.map((r) => `<a class="lad-row rc-pr" href="#/racing/jockey/${esc(r.id)}">
            <span class="lad-pos tnum">${r.rank}</span><span class="lad-team">${esc(r.name)}</span>
            <span class="lad-pts tnum">${r.wins}</span><span class="lad-rec tnum">${r.starts ?? ""}</span>
            <span class="lad-pct tnum">${r.starts ? Math.round(r.wins / r.starts * 100) + "%" : ""}</span><span class="lad-rec tnum">${esc(r.prize || "")}</span></a>`).join("")}
        </div>
        ${week.length ? `<aside class="ldr"><div class="ldr-h">This week's black type</div>
          ${week.slice(0, 12).map((w) => { const k = fmt(w.time); const tbc = /T00:00:00Z$/.test(w.time); return `<a class="ldr-row rc-bt" href="#/racing/race/${esc(w.meetId)}/${w.number}">
            <span class="rc-bt-g">${rcGroupChip(w.group)}</span>
            <span class="ldr-who"><b>${esc(rcTitle(w.name))}</b><i>${esc(w.venue)} · ${esc(w.distance)} · ${k.wd} ${k.day}${tbc ? " · time TBC" : " " + k.tm}</i></span>
          </a>`; }).join("")}
          <div class="ldr-src">Group & Listed races · next 7 days</div></aside>` : ""}
      </div>`;
  }

  // The Weekend — the form-guide analogue: last Saturday's black-type results
  function rcPaintWeekend() {
    const el = $("rc-weekend"); if (!el || !rcHub) return;
    const w = rcHub.weekend; const races = (w && w.races) || [];
    if (!races.length) { el.innerHTML = ""; return; }
    const d = rcDay(w.saturday);
    el.innerHTML = `
      <div class="section-h" style="margin-top:30px">The Weekend <span class="n">· black-type results · ${esc(d.wd)} ${esc(d.dm)} · ${esc([...new Set(races.map((r) => r.venue))].join(", "))}</span></div>
      <div class="rc-wk">${races.map((r) => `
        <a class="rc-wk-card" href="#/racing/race/${esc(r.meetId)}/${r.number}">
          <div class="rc-wk-h">${rcGroupChip(r.group)}<b>${esc(rcTitle(r.name))}</b><i>${esc(r.venue)} · ${esc(r.distance)}</i></div>
          <div class="rc-wk-win">${r.winner.silk ? `<img src="${esc(r.winner.silk)}" alt="">` : ""}<span><b>${esc(r.winner.horse)}</b><i>${esc(r.winner.jockey || "")}${r.winner.trainer ? " · " + esc(r.winner.trainer) : ""}</i></span><em class="tnum">${esc(r.winner.sp || "")}</em></div>
          <div class="rc-wk-plc">${r.placings.slice(1).map((p) => `<span><b>${p.finish}</b> ${esc(p.horse)}${p.margin ? ` <i>${esc(p.margin)}</i>` : ""}</span>`).join("")}</div>
        </a>`).join("")}</div>`;
  }

  // Race of the Day — the Game of the Week analogue
  function rcPaintRod() {
    const el = $("rc-rod"); if (!el || !rcHub) return;
    const r = rcHub.slate && rcHub.slate.raceOfTheDay;
    if (!r) { el.innerHTML = `<div class="loading">No meetings on this date.</div>`; return; }
    const k = fmt(r.time);
    el.innerHTML = `
      <div class="head"><span class="tag">★ ${TIER_LABEL[r.watch.tier]} · ${r.group ? esc(r.group) : "the pick of the day"}</span></div>
      <div class="body">
        <div>
          <div class="rc-rod-t"><span class="rc-rn">R${r.number}</span> <b>${esc(r.name)}</b> ${rcGroupChip(r.group)}</div>
          <div class="rc-rod-m">${esc(r.venue)} · ${esc(r.distance)} · ${r.runners} runners${r.class ? " · " + esc(r.class) : ""}</div>
          ${r.done && r.placings.length ? `<div class="rc-plc">${r.placings.map((p) => `<span class="rc-plc-i"><b>${p.finish}</b>${p.silk ? `<img src="${esc(p.silk)}" alt="">` : ""}${esc(p.horse)}<i>${esc(p.jockey)} · ${esc(p.sp || "")}${p.margin && p.finish > 1 ? " · " + esc(p.margin) : ""}</i></span>`).join("")}</div>`
            : (r.favs.length ? `<div class="rc-favs">${r.favs.map((f) => `<a class="rc-fav" href="#/racing/race/${esc(r.meetId)}/${r.number}">${f.silk ? `<img src="${esc(f.silk)}" alt="">` : ""}<span><b>${esc(f.no)}. ${esc(f.horse)}</b><i>${esc(f.jockey)}</i></span><em class="tnum">${esc(f.win || "")}</em></a>`).join("")}</div>` : "")}
          <a class="rc-field-link" href="#/racing/race/${esc(r.meetId)}/${r.number}">Full field, form & odds →</a>
        </div>
        <div class="kick">
          <div class="when tnum">${k.wd} ${k.day}<br><span class="big">${k.tm}</span></div>
          <div class="slot">${r.done ? "Result in" : "Jump"} · ${TZ_LABEL[tz]}</div>
          ${rcWatchBtn(r.state, "")}
        </div>
      </div>`;
  }

  function rcPaintSlate() {
    const el = $("rc-slate"); if (!el || !rcHub) return;
    let ms = [...((rcHub.slate && rcHub.slate.meetings) || [])];
    if (rcSort === "time") ms.sort((a, b) => (a.first || "").localeCompare(b.first || ""));
    $("rc-count").textContent = `· ${ms.length} meeting${ms.length === 1 ? "" : "s"}`;
    if (!ms.length) { el.innerHTML = `<div class="loading">No racing on this date.</div>`; return; }
    el.innerHTML = ms.map((m) => { const k = m.first ? fmt(m.first) : null; const f = m.feature; return `
      <a class="game rc-meet t${m.watch.tier}${m.done ? " done" : ""}" href="#/racing/meeting/${esc(m.id)}">
        <div class="top"><span class="tier t${m.watch.tier}">${m.done ? "Results in" : TIER_LABEL[m.watch.tier]}</span>${m.metro ? '<span class="rc-metro">Metro</span>' : ""}<span class="rc-state">${esc(m.state)}</span></div>
        <div class="rc-venue">${esc(m.venue)}</div>
        <div class="rc-track">${m.track ? esc(m.track) + (m.rating ? " " + esc(m.rating) : "") : "Track TBC"}${m.rail ? " · Rail " + esc(m.rail) : ""}</div>
        <div class="whenwrap"><span class="when tnum">${k ? k.wd + " " + k.day + (/T00:00:00Z$/.test(m.first) ? " · times TBC" : " · " + k.tm) : ""}</span><span class="slot">First race · ${m.raceCount} races${m.groupRaces ? " · " + m.groupRaces + " black type" : ""}</span></div>
        ${f ? `<div class="rc-feat">Feature · R${f.number} ${rcGroupChip(f.group)} <b>${esc(f.name)}</b> <span>${esc(f.distance)}${f.time ? " · " + fmt(f.time).tm : ""}</span></div>` : ""}
      </a>`; }).join("");
  }

  // ---------- meeting page: every race at the track ----------
  async function showRacingMeeting(meetId) {
    view.innerHTML = `${rcSubnav("watch")}<div class="shell"><div class="loading">Loading the card…</div></div>`;
    try {
      // the meeting lives inside the day's slate; find its date via the race page's meta if needed
      const r1 = await fetchJSON(`/api/racing/race/${encodeURIComponent(meetId)}/1`).catch(() => null);
      const first = r1 ? r1 : null;
      const date = first && first.race.time ? new Date(first.race.time).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" }) : rcMelToday();
      const slate = await fetchJSON(`/api/racing/meetings?date=${date}`);
      const m = (slate.meetings || []).find((x) => x.id === meetId);
      if (!m) throw new Error("meeting not on this date");
      const d = rcDay(date);
      view.innerHTML = `${rcSubnav("watch")}
        <div class="team-hero rc-hero">
          <div class="shell">
            <a class="crumb" href="#/racing/day/${date}">← ${esc(d.wd)}'s racing</a>
            <div class="th-row"><div>
              <div class="th-loc">${esc(RC_STATE_NAME[m.state] || m.state)}${m.metro ? " · Metro" : ""} · ${esc(d.wd)} ${esc(d.dm)}</div>
              <h1 class="th-name">${esc(m.venue)}</h1>
              <div class="th-meta">${[m.track ? "Track " + m.track + (m.rating ? " " + m.rating : "") : "", m.rail ? "Rail " + m.rail : "", m.weather ? m.weather : "", m.raceCount + " races", m.groupRaces ? m.groupRaces + " black-type" : ""].filter(Boolean).map(esc).join(" · ")}</div>
              <div class="th-next">${rcWatchBtn(m.state, "sm")}${m.url ? ` <a class="watch sm ghost" href="${esc(m.url)}" target="_blank" rel="noopener">Full form on Racing.com ↗</a>` : ""}</div>
            </div></div>
          </div>
        </div>
        <div class="shell">
          <div class="section-h" style="margin-top:24px">The card <span class="n">· jump times in ${TZ_LABEL[tz]}</span></div>
          <div class="rc-card">${m.races.map((r) => { const k = fmt(r.time); return `
            <a class="rc-race t${r.watch.tier}${r.done ? " done" : ""}" href="#/racing/race/${esc(m.id)}/${r.number}">
              <span class="rc-rn">R${r.number}</span>
              <span class="rc-race-body"><b>${esc(r.name)}</b> ${rcGroupChip(r.group)}<i>${esc(r.distance)} · ${esc(r.class || "")} · ${r.runners} runners</i>
                ${r.done && r.placings.length ? `<span class="rc-mini-plc">${r.placings.map((p) => `<span><b>${p.finish}</b> ${esc(p.horse)}${p.sp ? " (" + esc(p.sp) + ")" : ""}</span>`).join("")}</span>`
                  : (r.favs.length ? `<span class="rc-mini-fav">${r.favs.map((f) => `<span>${f.silk ? `<img src="${esc(f.silk)}" alt="">` : ""}${esc(f.horse)} <em>${esc(f.win || "")}</em></span>`).join("")}</span>` : "")}
              </span>
              <span class="rc-race-time tnum">${k.tm}<i>${r.done ? "Result" : (r.status && r.status !== "Open" ? esc(r.status) : "Jump")}</i></span>
            </a>`; }).join("")}</div>
        </div>`;
    } catch (err) {
      view.innerHTML = `${rcSubnav("watch")}<div class="shell"><div class="loading">Couldn't load the meeting (${esc(err.message)}).</div></div>`;
    }
  }

  // ---------- race page: the field ----------
  async function showRacingRace(meetId, number) {
    view.innerHTML = `${rcSubnav("watch")}<div class="shell"><div class="loading">Loading the field…</div></div>`;
    try {
      const d = await fetchJSON(`/api/racing/race/${encodeURIComponent(meetId)}/${number}`);
      const r = d.race, mt = d.meeting, k = fmt(r.time);
      const done = r.done || d.field.some((e) => e.finish === 1);
      view.innerHTML = `${rcSubnav("watch")}
        <div class="team-hero rc-hero">
          <div class="shell">
            <a class="crumb" href="#/racing/meeting/${esc(meetId)}">← ${esc(r.venue)} card</a>
            <div class="th-row"><div>
              <div class="th-loc">${esc(r.venue)} · Race ${r.number} · ${k.wd} ${k.day}</div>
              <h1 class="th-name">${esc(r.name)} ${rcGroupChip(r.group)}</h1>
              <div class="th-meta">${[r.distance, r.class, r.runners + " runners", mt.track ? "Track " + mt.track + (mt.rating ? " " + mt.rating : "") : "", mt.rail ? "Rail " + mt.rail : ""].filter(Boolean).map(esc).join(" · ")}</div>
              <div class="sum-chips"><span class="sum"><b class="tnum">${k.tm}</b> ${done ? "ran" : "jump"} · ${TZ_LABEL[tz]}</span><span class="sum"><b>${esc(TIER_LABEL[r.watch.tier])}</b> watchability</span>${r.status ? `<span class="sum"><b>${esc(r.status)}</b></span>` : ""}</div>
              <div class="th-next">${rcWatchBtn(r.state, "sm")}${r.url ? ` <a class="watch sm ghost" href="${esc(r.url)}" target="_blank" rel="noopener">Form & replay on Racing.com ↗</a>` : ""}</div>
            </div></div>
          </div>
        </div>
        <div class="shell">
          <div class="section-h" style="margin-top:24px">${done ? "The result" : "The field"} <span class="n">· ${done ? "finishing order" : "win / place · fixed odds"}</span></div>
          <div class="tbl-wrap"><table class="roster rc-field">
            <thead><tr>${done ? "<th>Fin</th>" : ""}<th>#</th><th>Horse</th><th>Jockey</th><th>Trainer</th><th class="tnum">Bar</th><th class="tnum">Wt</th><th>Last 5</th><th>Career</th>${done ? '<th class="tnum">SP</th><th>Margin</th>' : '<th class="tnum">Win</th><th class="tnum">Place</th>'}</tr></thead>
            <tbody>${[...d.field].sort((a, b) => done ? ((a.finish || 99) - (b.finish || 99)) : ((a.scratched - b.scratched) || (a.no - b.no))).map((e) => `
              <tr class="${e.scratched ? "scr" : ""}${e.fav && !done ? " fav" : ""}${done && e.finish === 1 ? " won" : ""}">
                ${done ? `<td class="tnum"><b>${e.finish ? esc(e.finishAbv || e.finish) : (e.scratched ? "SCR" : "")}</b></td>` : ""}
                <td class="tnum">${esc(e.no ?? "")}</td>
                <td class="pl">${e.silk ? `<img class="hs rc-silk" src="${esc(e.silk)}" alt="">` : `<span class="hs hs-empty"></span>`}<a class="pl-nm" href="#/racing/horse/${esc(e.horseId)}">${esc(e.horse)}${e.country && e.country !== "AUS" ? ` <i class="rc-cty">(${esc(e.country)})</i>` : ""}</a>${e.scratched ? ' <span class="rc-scr">Scratched</span>' : ""}${e.emergency ? ' <span class="rc-scr">Em</span>' : ""}</td>
                <td>${e.jockeyId ? `<a href="#/racing/jockey/${esc(e.jockeyId)}">${esc(e.jockey)}</a>` : esc(e.jockey)}${e.claim ? ` <i class="rc-claim">(a${esc(e.claim)})</i>` : ""}</td>
                <td>${e.trainerId ? `<a href="#/racing/trainer/${esc(e.trainerId)}">${esc(e.trainer)}</a>` : esc(e.trainer)}</td>
                <td class="tnum">${esc(e.barrier ?? "")}</td><td class="tnum">${esc(e.weight || "")}</td>
                <td class="tnum rc-l5">${esc(e.last5 || "")}</td><td class="tnum">${esc(e.record || "")}</td>
                ${done ? `<td class="tnum">${esc(e.sp || "")}</td><td>${esc(e.margin || "")}</td>` : `<td class="tnum"><b>${esc(e.win || "")}</b></td><td class="tnum">${esc(e.place || "")}</td>`}
              </tr>`).join("")}</tbody>
          </table></div>
          <p class="panel-note" style="margin-top:12px">Odds are the market's fixed win/place at time of load — indicative, not an offer. Career = starts: wins-seconds-thirds.</p>
          <div class="section-h" style="margin-top:26px">Rest of the card</div>
          <div class="rc-others">${d.others.map((o) => `<a class="rc-oth${o.number === r.number ? " on" : ""}" href="#/racing/race/${esc(meetId)}/${o.number}"><b>R${o.number}</b><span>${fmt(o.time).tm}</span>${rcGroupChip(o.group)}</a>`).join("")}</div>
        </div>`;
    } catch (err) {
      view.innerHTML = `${rcSubnav("watch")}<div class="shell"><div class="loading">Couldn't load the race (${esc(err.message)}).</div></div>`;
    }
  }

  // ---------- premierships page: the people layer ----------
  const RC_PREM_STATES = [["", "National"], ["VIC", "VIC"], ["NSW", "NSW"], ["QLD", "QLD"], ["SA", "SA"], ["WA", "WA"]];
  let rcPrem = { entity: "Jockey", state: "", metro: false };
  async function showRacingPremierships() {
    view.innerHTML = `${rcSubnav("prem")}<div class="shell">
      ${pageHero("Racing", `Jockeys, trainers &amp; <em>horses</em>.`, "The premierships as they stand — national or by state, metro or everywhere. Every name clicks through to a profile with recent form.")}
      <div class="controls">
        <div class="seg" role="group"><span class="k">Table</span>${["Jockey", "Trainer", "Horse"].map((e) => `<button data-pe="${e}">${e}s</button>`).join("")}</div>
        <div class="seg" role="group"><span class="k">Scope</span>${RC_PREM_STATES.map(([v, l]) => `<button data-ps="${v}">${l}</button>`).join("")}</div>
        <div class="seg" role="group"><span class="k">Meetings</span><button data-pm="0">All</button><button data-pm="1">Metro</button></div>
      </div>
      <div id="rc-prem-body"><div class="loading">Loading the table…</div></div>
    </div>`;
    const sync = () => { view.querySelectorAll("[data-pe]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pe === rcPrem.entity)));
      view.querySelectorAll("[data-ps]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ps === rcPrem.state)));
      view.querySelectorAll("[data-pm]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.pm === "1") === rcPrem.metro))); };
    view.querySelectorAll("[data-pe]").forEach((b) => b.onclick = () => { rcPrem.entity = b.dataset.pe; sync(); rcLoadPrem(); });
    view.querySelectorAll("[data-ps]").forEach((b) => b.onclick = () => { rcPrem.state = b.dataset.ps; sync(); rcLoadPrem(); });
    view.querySelectorAll("[data-pm]").forEach((b) => b.onclick = () => { rcPrem.metro = b.dataset.pm === "1"; sync(); rcLoadPrem(); });
    sync(); rcLoadPrem();
  }
  async function rcLoadPrem() {
    const box = $("rc-prem-body"); if (!box) return;
    box.innerHTML = `<div class="loading">Loading the table…</div>`;
    try {
      const qs = `entity=${rcPrem.entity}&size=30${rcPrem.state ? "&state=" + rcPrem.state : ""}${rcPrem.metro ? "&meetType=Metro" : ""}`;
      const d = await fetchJSON(`/api/racing/premierships?${qs}`);
      const kind = rcPrem.entity.toLowerCase();
      const unit = kind === "horse" ? "Wins" : "Wins";
      box.innerHTML = `
        <div class="section-h">${esc(rcPrem.entity)} premiership <span class="n">· ${esc(d.label)} · ${esc(rcPrem.state || "national")}${rcPrem.metro ? " · metro" : ""}</span></div>
        <div class="tbl-wrap"><table class="roster stats rc-prem-tbl">
          <thead><tr><th class="tnum">#</th><th>${esc(rcPrem.entity)}</th><th class="tnum">${unit}</th><th class="tnum">${kind === "horse" ? "Starts" : (kind === "jockey" ? "Rides" : "Runners")}</th><th class="tnum">Strike</th><th class="tnum">Prize money</th></tr></thead>
          <tbody>${d.rows.map((r) => `<tr data-go="#/racing/${kind}/${esc(r.id)}" tabindex="0"><td class="tnum">${r.rank}</td><td class="pl"><span class="pl-nm">${esc(r.name)}</span></td><td class="tnum"><b>${r.wins}</b></td><td class="tnum">${r.starts ?? ""}</td><td class="tnum">${r.starts ? Math.round(r.wins / r.starts * 100) + "%" : ""}</td><td class="tnum">${esc(r.prize || "")}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="panel-note" style="margin-top:12px">Racing seasons run 1 August – 31 July. Source: racing.com premiership tables.</p>`;
      box.querySelectorAll("[data-go]").forEach((tr) => { const go = () => { location.hash = tr.getAttribute("data-go"); }; tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
    } catch (err) {
      box.innerHTML = `<div class="loading">Couldn't load the table (${esc(err.message)}).</div>`;
    }
  }

  // ---------- profiles: jockey / trainer / horse ----------
  async function showRacingPerson(kind, id) {
    view.innerHTML = `${rcSubnav("prem")}<div class="shell"><div class="loading">Loading…</div></div>`;
    try {
      const d = await fetchJSON(`/api/racing/${kind}/${encodeURIComponent(id)}`);
      const p = d.profile, runs = d.rides || d.runs || [];
      const chips = kind === "horse"
        ? [p.age ? p.age + "yo" : "", p.sex, p.colour, p.country && p.country !== "AUS" ? p.country : "", p.sire ? "by " + p.sire : "", p.dam ? "out of " + p.dam : "", p.trainer ? "Trainer " + p.trainer : ""]
        : kind === "jockey" ? [p.age ? p.age + " yrs" : "", p.weight ? "Rides at " + p.weight : ""] : [p.based ? "Based " + p.based : ""];
      const sums = kind === "horse"
        ? [[p.record, "career"], [p.winPct != null ? p.winPct + "%" : "—", "win"], [p.placePct != null ? p.placePct + "%" : "—", "place"], [p.g1 ?? "0", "Group 1 wins"], [p.prize || "—", "prize money"]]
        : [[p.careerWins ?? "—", "career wins"], [p.seasonWins ?? "—", "this season"], [p.winPct != null ? p.winPct + "%" : "—", "strike rate"], [p.g1 ?? "0", "Group 1 wins"], [p.prize || "—", "prize money"]];
      const backLbl = kind === "horse" && p.trainerId ? `← ${esc(p.trainer)}` : "← Jockeys & Trainers";
      const backHref = kind === "horse" && p.trainerId ? `#/racing/trainer/${esc(p.trainerId)}` : "#/racing/premierships";
      view.innerHTML = `${rcSubnav("prem")}
        <div class="team-hero rc-hero">
          <div class="shell">
            <a class="crumb" href="${backHref}">${backLbl}</a>
            <div class="th-row">
              ${kind === "horse" && p.silk ? `<img class="ph rc-silk-lg" src="${esc(p.silk)}" alt="">` : ""}
              <div>
                <div class="th-loc">${esc(kind)}${p.status && kind === "horse" ? " · " + esc(p.status) : ""}</div>
                <h1 class="th-name">${esc(p.name)}</h1>
                <div class="th-meta">${chips.filter(Boolean).map(esc).join(" · ")}</div>
                <div class="sum-chips">${sums.map(([v, l]) => `<span class="sum"><b class="tnum">${esc(v)}</b> ${esc(l)}</span>`).join("")}</div>
                ${p.url ? `<div class="th-next"><a class="watch sm ghost" href="${esc(p.url)}" target="_blank" rel="noopener">Full profile on Racing.com ↗</a></div>` : ""}
              </div>
            </div>
          </div>
        </div>
        <div class="shell">
          ${kind === "horse" && p.summary ? `<p class="panel-note" style="margin-top:14px">${esc(p.summary)}</p>` : ""}
          <div class="section-h" style="margin-top:26px">${kind === "jockey" ? "Recent rides" : kind === "trainer" ? "Recent runners" : "Recent starts"} <span class="n">· latest first</span></div>
          <div class="tbl-wrap"><table class="roster stats rc-runs">
            <thead><tr><th>Date</th><th>Track</th><th>Race</th><th class="tnum">Fin</th>${kind !== "horse" ? "<th>Horse</th>" : ""}${kind !== "jockey" ? "<th>Jockey</th>" : ""}${kind === "jockey" ? "<th>Trainer</th>" : ""}<th>Margin</th><th class="tnum">SP</th><th class="tnum">Bar</th><th class="tnum">Wt</th></tr></thead>
            <tbody>${runs.filter((x) => !x.trial).map((x) => `
              <tr class="${x.finish === 1 ? "won" : ""}">
                <td>${esc(x.date ? fmt(x.time || x.date + "T00:00:00Z").day : "")}</td>
                <td><a href="#/racing/meeting/${esc(x.meetId)}">${esc(x.venue || "")}</a></td>
                <td><a href="#/racing/race/${esc(x.meetId)}/${x.number}">${esc(x.race || "R" + x.number)}</a> ${rcGroupChip(x.group)} <i class="rc-dist">${esc(x.distance || "")}</i></td>
                <td class="tnum"><b>${x.finish ? esc(x.finishAbv || x.finish) : (x.status && !/paying|final|closed/i.test(x.status) ? esc(x.status) : "")}</b>${x.runners ? `<i class="rc-of">/${x.runners}</i>` : ""}</td>
                ${kind !== "horse" ? `<td>${x.silk ? `<img class="hs rc-silk sm" src="${esc(x.silk)}" alt="">` : ""}${x.horseId ? `<a href="#/racing/horse/${esc(x.horseId)}">${esc(x.horse)}</a>` : esc(x.horse || "")}</td>` : ""}
                ${kind !== "jockey" ? `<td>${x.jockeyId ? `<a href="#/racing/jockey/${esc(x.jockeyId)}">${esc(x.jockey)}</a>` : esc(x.jockey || "")}</td>` : ""}
                ${kind === "jockey" ? `<td>${x.trainerId ? `<a href="#/racing/trainer/${esc(x.trainerId)}">${esc(x.trainer)}</a>` : esc(x.trainer || "")}</td>` : ""}
                <td>${esc(x.margin || "")}</td><td class="tnum">${esc(x.sp || "")}</td><td class="tnum">${esc(x.barrier ?? "")}</td><td class="tnum">${esc(x.weight || "")}</td>
              </tr>`).join("") || `<tr><td colspan="9">No recent starts recorded.</td></tr>`}</tbody>
          </table></div>
        </div>`;
    } catch (err) {
      view.innerHTML = `${rcSubnav("prem")}<div class="shell"><div class="loading">Couldn't load this profile (${esc(err.message)}).</div></div>`;
    }
  }

  function setNav(active) {
    document.querySelectorAll("[data-nav]").forEach((a) =>
      a.classList.toggle("on", a.getAttribute("data-nav") === active));
  }

  // clean URLs (/episode/x, /show/x, /episodes) route like their hash twins
  function pathToHash(p) {
    if (!p || p === "/" || p === "/index.html") return "";
    return "#" + p.replace(/\/$/, "");
  }
  function route() {
    const h = location.hash || pathToHash(location.pathname) || "#/";
    let m;
    clearInterval(rtgTimer);
    clearInterval(leadTimer);
    if (typeof rcCountdown !== "undefined") { clearInterval(rcCountdown); clearInterval(rcNextTimer); }
    window.scrollTo(0, 0);
    const isLanding = h === "#/landing";
    document.body.classList.toggle("landing", isLanding);
    document.body.classList.toggle("is-home", h === "#/" || h === "" || h === "#");
    const LG = "(nfl|afl|nbl|nrl|nba|epl|mlb|cfb)";
    if (isLanding) { setNav(""); showLanding(); }
    else if (h === "#/" || h === "" || h === "#") { setNav("home"); showHome(); }
    else if ((m = h.match(/^#\/episode\/([\w-]+)$/))) { setNav("podcasts"); showEpisode(m[1]); }
    else if ((m = h.match(/^#\/show\/([\w-]+)$/))) { setNav("shows"); showShowPage(m[1]); }
    else if ((m = h.match(/^#\/episodes(?:\/([\w-]+))?$/))) { setNav("podcasts"); showEpisodes(m[1]); }
    else if (h === "#/wrap") { setNav("home"); showWrap(); }
    else if (h === "#/saved") { setNav("leagues"); showSaved(); }
    else if (h === "#/aussies") { setNav("leagues"); showAussiesAbroad(); }
    else if (h === "#/people") { setNav("shows"); showPeople(); }
    else if ((m = h.match(/^#\/people\/([\w-]+)$/))) { setNav("shows"); showPerson(m[1]); }
    else if (h === "#/clips") { location.replace("#/watch"); return; }
    else if ((m = h.match(new RegExp(`^#/${LG}/team/([A-Za-z0-9]{2,8})$`)))) { league = m[1]; setNav("leagues"); showTeam(m[2].toUpperCase()); }
    else if ((m = h.match(new RegExp(`^#/${LG}/player/([\\w-]+)$`)))) { league = m[1]; setNav("leagues"); showPlayer(m[2]); }
    else if ((m = h.match(new RegExp(`^#/${LG}/teams$`)))) { league = m[1]; setNav("leagues"); showTeams(); }
    else if ((m = h.match(new RegExp(`^#/${LG}$`)))) { league = m[1]; setNav("leagues"); showHub(); }
    else if (h === "#/racing") { league = "racing"; setNav("leagues"); showRacingHub(); }
    else if ((m = h.match(/^#\/(tennis|f1|golf|ufc)$/))) { league = m[1]; setNav("leagues"); showTour(m[1]); }
    else if (h === "#/cricket") { league = "cricket"; setNav("leagues"); showCricket(); }
    else if (h === "#/la2028") { league = "la2028"; setNav("leagues"); showLA2028(); }
    else if ((m = h.match(/^#\/racing\/day\/(\d{4}-\d{2}-\d{2})$/))) { league = "racing"; setNav("leagues"); showRacingHub(m[1]); }
    else if ((m = h.match(/^#\/racing\/meeting\/(\d+)$/))) { league = "racing"; setNav("leagues"); showRacingMeeting(m[1]); }
    else if ((m = h.match(/^#\/racing\/race\/(\d+)\/(\d+)$/))) { league = "racing"; setNav("leagues"); showRacingRace(m[1], +m[2]); }
    else if (h === "#/racing/premierships") { league = "racing"; setNav("leagues"); showRacingPremierships(); }
    else if ((m = h.match(/^#\/racing\/(jockey|trainer|horse)\/(\d+)$/))) { league = "racing"; setNav("leagues"); showRacingPerson(m[1], m[2]); }
    else if ((m = h.match(/^#\/watch\/([\w-]+)$/))) { setNav("watch"); showWatch(m[1]); }
    else if (h === "#/watch") { setNav("watch"); showWatch(); }
    // legacy NFL-only paths
    else if ((m = h.match(/^#\/team\/([A-Za-z]{2,4})$/))) { league = "nfl"; setNav("leagues"); showTeam(m[1].toUpperCase()); }
    else if ((m = h.match(/^#\/player\/(\d+)$/))) { league = "nfl"; setNav("leagues"); showPlayer(m[1]); }
    else if (h === "#/teams") { league = "nfl"; setNav("leagues"); showTeams(); }
    else if (h === "#/leagues") { setNav("leagues"); showLeagues(); }
    else if (h === "#/podcasts") { setNav("podcasts"); showEpisodes(); }
    else if (h === "#/christmas") { setNav("shows"); showChristmas(); }
    else if (h === "#/audience") { setNav("audience"); showAudience(); }
    else if (h === "#/shows") { setNav("shows"); showShows(); }
    else if (h === "#/partner") { setNav("partner"); showPartner(); }
    else { league = "nfl"; setNav("leagues"); showHub(); }
  }

  const _route = route;
  route = function () { _route(); setTimeout(armMotion, 400); };
  window.addEventListener("hashchange", route);
  route();
})();
