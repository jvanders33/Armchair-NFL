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
    nfl: [
      { key: "7plus", label: "7plus", sub: "free", url: "https://7plus.com.au/nfl" },
      { key: "kayo", label: "Kayo", sub: "ESPN", url: "https://kayosports.com.au/sports/nfl" },
      { key: "gamepass", label: "Game Pass", sub: "every game", url: "https://www.dazn.com/en-AU/l/nfl-game-pass" },
    ],
    afl: [
      { key: "7plus", label: "7plus", sub: "free", url: "https://7plus.com.au/afl" },
      { key: "kayo", label: "Kayo", sub: "Fox Footy", url: "https://kayosports.com.au/sports/afl" },
    ],
    nbl: [
      { key: "9now", label: "9Now", sub: "free", url: "https://www.9now.com.au" },
      { key: "kayo", label: "Kayo", sub: "ESPN", url: "https://kayosports.com.au/sports/basketball" },
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
  let weekView = null; // null = ESPN "current"; else {year, seasontype, week}
  let hubData = null;
  let aussies = [];

  const $ = (id) => document.getElementById(id);
  const view = $("view");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const _cache = new Map();
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
        </div>
        <div class="slate" id="slate"></div>
        ${league === "nfl" ? `<div class="section-h" style="margin-top:32px">Aussies in the NFL <span class="n" id="aus-note">· this week</span></div>
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
    const bits = [];
    const sp = g.odds && g.odds.spread != null ? Math.abs(g.odds.spread) : null;
    const ou = g.odds && g.odds.overUnder;
    const hot = (r) => { const [w, l] = (r || "0-0").split("-").map(Number); return w + l > 0 && w / (w + l) >= 0.65; };
    if (g.status.state === "in") bits.push("Live right now — " + g.status.detail);
    if (hot(g.home.record) && hot(g.away.record)) bits.push("two of the form teams in football");
    if (sp !== null && sp <= 2.5) bits.push("a genuine coin-flip");
    else if (sp !== null && sp <= 4.5) bits.push("tight line");
    if (ou && ou >= 48) bits.push("shootout script (O/U " + ou + ")");
    if (/NFL Kickoff/.test(g.slot)) bits.push("the season opener — standalone national window");
    else if (/Night Football/.test(g.slot)) bits.push("the prime-time window");
    if (!bits.length) bits.push(g.odds && g.odds.details ? "Line: " + g.odds.details : "One for the completists");
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
    const [p, ...rest] = opts;
    return `<span class="watch-row">
      <a class="watch ${cls || ""}" target="_blank" rel="noopener" data-plat="${esc(p.key)}"
        href="${esc(p.url)}${p.url.includes("?") ? "&" : "?"}${utm}" data-watch="${esc(g.away.abbr)}@${esc(g.home.abbr)}">
        <span class="tv">▶</span> ${verb} on ${esc(p.label)}</a>
      ${rest.map((w) => `<a class="watch-chip" target="_blank" rel="noopener" data-plat="${esc(w.key)}" title="${esc(w.label)} · ${esc(w.sub)}"
        href="${esc(w.url)}${w.url.includes("?") ? "&" : "?"}${utm}" data-watch="${esc(g.away.abbr)}@${esc(g.home.abbr)}">${esc(w.label)}</a>`).join("")}
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
          <button class="star" data-star="${esc(g.id)}" aria-pressed="${on}" title="Add to my watchlist" aria-label="Add to watchlist">${on ? "★" : "☆"}</button>
        </div>
        <div class="mu">${teamHTML(g.away, false, showScore)}<span class="at">at</span>${teamHTML(g.home, false, showScore)}</div>
        ${meter(g)}
        <div class="row">
          <div class="whenwrap"><span class="when tnum">${k.wd} ${k.day} · ${k.tm}</span><span class="slot">${esc(g.slot)}${g.broadcast ? " · " + esc(g.broadcast) : ""}</span></div>
        </div>
        <p class="why">${why(g)}</p>
        ${expertCallHTML(g)}
        <div class="foot">${aus}${watchBtn(g, "sm ghost")}</div>
      </article>`;
    }).join("");
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
      if (!g) return `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${ab.toLowerCase()}.png`;
      return g.home.abbr === ab ? g.home.logo : g.away.logo;
    };
    const card = (p) => {
      const g = byTeam[p.team];
      let ctx = "No game this week";
      if (g) {
        const opp = g.home.abbr === p.team ? "vs " + g.away.name : "at " + g.home.name;
        const k = fmt(g.date);
        ctx = `${opp} · ${k.wd} ${k.tm}`;
      }
      return `<div class="p">
        <div class="pos"><img src="${logoOf(p.team)}" alt="" loading="lazy">🇦🇺 ${esc(p.pos)} · ${esc(p.team)}</div>
        <div class="pn">${esc(p.name)}</div>
        <div class="pt">${esc(ctx)}</div>
        <div class="pg">${esc(p.hook)}</div>
      </div>`;
    };
    const list = playing.concat(off).slice(0, 8);
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
    leadersData = leaders && (leaders.categories || []).length ? leaders.categories : null;
    leadersSeason = leaders && leaders.season ? leaders.season : null;
    const lines = {};
    (lad.lines || []).forEach((l) => { lines[l.after] = l; });
    const wildTo = Math.max(...(lad.lines || []).map((l) => l.after), 0);
    const pctLbl = league === "afl" ? "%" : "Win%";
    const formDots = (f) => f ? `<span class="lf">${[...f].map((c) =>
      `<i class="${c === "W" ? "w" : c === "L" ? "l" : "d"}" title="${c}"></i>`).join("")}</span>` : "<span></span>";
    const posCls = (r) => r.rank <= 6 ? " in-six" : (r.rank <= wildTo && league === "afl" ? " in-wild" : "");
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
    const sub = league === "afl" ? "· live · top 6 straight through · 7–10 play the wildcard round" : "· live";
    wrap.innerHTML = `
      <div class="section-h" style="margin-top:30px">The Ladder <span class="n">${sub}</span></div>
      <div class="lad-wrap${leadersData ? "" : " solo"}">
        <div class="lad-col">
          <div class="lad-head"><span></span><span></span><span>Club</span><span>W–L</span><span>${pctLbl}</span><span>Pts</span><span>Form</span></div>
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
    const idx = cal.findIndex((c) => c.seasontype === s.type && c.week === w.number);
    const label = idx >= 0 ? cal[idx].label : "Week " + w.number;
    const stName = { 1: "Preseason", 2: "", 3: "Postseason" }[s.type] || "";
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

  function bindStars() {
    $("slate").querySelectorAll("[data-star]").forEach((s) => {
      s.addEventListener("click", () => {
        const id = s.getAttribute("data-star");
        const set = new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]"));
        const on = set.has(id);
        if (on) set.delete(id); else set.add(id);
        localStorage.setItem(STAR_KEY, JSON.stringify([...set]));
        s.setAttribute("aria-pressed", String(!on));
        s.textContent = on ? "☆" : "★";
        if (!on) toast("Added to your watchlist — we'll remind you before kick-off");
      });
    });
  }

  let episodeHTML = "";
  function setTzNote() {
    $("tz-note").textContent = "Kick-offs converted live to " + TZ_LABEL[tz] + " time";
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
    const qs = (weekView ? `?year=${weekView.year}&seasontype=${weekView.seasontype}&week=${weekView.week}` : "?") + `&league=${league}`;
    try {
      const [sched, aus, rtg, featured, vids, lad, ldrs, form, finals] = await Promise.all([
        fetch("/api/schedule" + qs).then((r) => { if (!r.ok) throw new Error("API " + r.status); return r.json(); }),
        league === "nfl" && !aussies.length ? fetchJSON("/api/aussies") : Promise.resolve(null),
        league === "nfl" ? fetchJSON("/api/road-to-the-g").catch(() => null) : Promise.resolve(null),
        fetchJSON(`/api/featured?league=${league}`).catch(() => null),
        fetchJSON(`/api/videos?league=${league}`).catch(() => null),
        league !== "nfl" ? fetchJSON(`/api/ladder?league=${league}`).catch(() => null) : Promise.resolve(null),
        league !== "nfl" ? fetchJSON(`/api/leaders?league=${league}`).catch(() => null) : Promise.resolve(null),
        league === "afl" ? fetchJSON("/api/afl/form").catch(() => null) : Promise.resolve(null),
        league === "afl" ? fetchJSON("/api/afl/finals").catch(() => null) : Promise.resolve(null),
      ]);
      hubData = sched;
      if (aus) aussies = aus.players || [];

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
      $("loading").textContent = "Couldn't reach the live feed (" + err.message + "). Refresh to retry.";
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
    const qs = (weekView ? `?year=${weekView.year}&seasontype=${weekView.seasontype}&week=${weekView.week}` : "?") + `&league=${league}`;
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
                      <span class="pl-nm">${esc(p.name)}</span>${p.aussie ? ' <span title="Australian">🇦🇺</span>' : ""}
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
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load ${esc(abbr)} (${esc(err.message)}).</div></div>`;
    }
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
                  <span class="pl-nm">${esc(p.name)}</span>
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
                  <span class="pl-nm">${esc(p.name)}</span>
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
      const d = await fetchJSON("/api/player/" + encodeURIComponent(pid));
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
            ${p.team.abbr ? `<a class="crumb" href="#/team/${esc(p.team.abbr)}">← ${esc(p.team.displayName)}</a>` : `<a class="crumb" href="#/teams">← Teams</a>`}
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
                    <td>${s.team ? `<a href="#/team/${esc(s.team)}">${esc(s.team)}</a>` : ""}</td>
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
            <a href="#/partner" class="ch-partner">PARTNER</a>
          </nav>
          <div class="land-soc" aria-label="Socials">
            <a href="https://www.youtube.com/watch?v=gQ2gNGiNLa4" target="_blank" rel="noopener" title="YouTube">YT</a>
            <a title="Instagram — handle to come">IG</a>
            <a title="TikTok — handle to come">TT</a>
            <a title="X — handle to come">𝕏</a>
            <a title="iHeart">♥</a>
          </div>
          <a class="land-strip" href="#/nfl">🏈 The 10-day countdown to the MCG starts Sep 1 — one episode a day&nbsp;<b>→</b></a>
        </div>
        <div class="land-foot">
          <span class="lf-partner">Every game · <b>7plus · Kayo · 9Now</b> — we tell you where</span>
          <span class="lf-soc">Armchair Experts — voice up front, a live sports-data spine underneath</span>
        </div>
      </section>`;
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

  function LG_LOGO(k) { return `https://a.espncdn.com/i/teamlogos/leagues/500-dark/${k}.png`; }
  const LEAGUES = [
    { key: "NFL", name: "NFL", logo: LG_LOGO("nfl"), c1: "#013369", c2: "#D50A0A", status: "live",
      tag: "American football", line: "Every game in your time",
      desc: "What to Watch in AEST · all 32 teams · every player's career · the big stories, live.",
      cta: "Enter the NFL hub", href: "#/nfl" },
    { key: "AFL", name: "AFL", logo: LG_LOGO("afl"), c1: "#003C9D", c2: "#D50A0A", status: "live",
      tag: "Australian football", line: "Every round, every club",
      desc: "The live ladder and fixture, all 19 clubs and their lists — plus ListTrac for trades, contracts and the draft.",
      cta: "Enter the AFL hub", href: "#/afl" },
    { key: "NBL", name: "NBL", logo: LG_LOGO("nbl"), c1: "#0B1F3A", c2: "#E4002B", status: "live",
      tag: "Basketball", line: "Every game, every club",
      desc: "The same what-to-watch engine pointed at Australian hoops — fixtures, clubs and rosters.",
      cta: "Enter the NBL hub", href: "#/nbl" },
    { key: "RACING", name: "Racing", logo: "", c1: "#1E5E3A", c2: "#C9A227", status: "next",
      tag: "The punt", line: "Built around Spring",
      desc: "The fourth code — form, previews and the big carnivals. Format in the works.",
      cta: "", href: "" },
  ];

  function showLeagues() {
    view.innerHTML = `<div class="shell">
      ${pageHero("The codes", `Every sport.<br><em>One armchair.</em>`, "Four codes, one platform. Live fixtures, real data, and the tools fans come back to daily — under one masthead.")}
      <div class="lg-grid">
        ${LEAGUES.map((l) => `
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
          </${l.href ? "a" : "div"}>`).join("")}
      </div>
      <div class="section-h" style="margin-top:36px">The Monday Armchair <span class="n">· five minutes with your coffee</span></div>
      <div class="capture">
        <div class="cap-card">
          <div class="cap-h">📬 Get the Monday Armchair</div>
          <p class="cap-p">The week in sport, in your inbox — what happened, what's on, and what's worth your time.</p>
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
        ${pageHero("The channel", `<em>Watch</em>.`, "Every show, every episode — straight from the channel, updating itself.")}
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
            <${s.url ? `a href="${esc(s.url)}"${s.url.startsWith("#") ? "" : ` target="_blank" rel="noopener"`}` : "div"} class="show-card" style="--sc1:${look.c1}; --sc2:${look.c2}">
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
                ${s.url ? `<div class="sc-watch">▶ Watch</div>` : ""}
              </div>
            </${s.url ? "a" : "div"}>`;
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

  function setNav(active) {
    document.querySelectorAll("[data-nav]").forEach((a) =>
      a.classList.toggle("on", a.getAttribute("data-nav") === active));
  }

  function route() {
    const h = location.hash || "#/";
    let m;
    clearInterval(rtgTimer);
    clearInterval(leadTimer);
    window.scrollTo(0, 0);
    const isLanding = h === "#/" || h === "" || h === "#";
    document.body.classList.toggle("landing", isLanding);
    const LG = "(nfl|afl|nbl)";
    if (isLanding) { setNav(""); showLanding(); }
    else if ((m = h.match(new RegExp(`^#/${LG}/team/([A-Za-z]{2,5})$`)))) { league = m[1]; setNav("leagues"); showTeam(m[2].toUpperCase()); }
    else if ((m = h.match(new RegExp(`^#/${LG}/player/([\\w-]+)$`)))) { league = m[1]; setNav("leagues"); showPlayer(m[2]); }
    else if ((m = h.match(new RegExp(`^#/${LG}/teams$`)))) { league = m[1]; setNav("leagues"); showTeams(); }
    else if ((m = h.match(new RegExp(`^#/${LG}$`)))) { league = m[1]; setNav("leagues"); showHub(); }
    else if ((m = h.match(/^#\/watch\/([\w-]+)$/))) { setNav("watch"); showWatch(m[1]); }
    else if (h === "#/watch") { setNav("watch"); showWatch(); }
    // legacy NFL-only paths
    else if ((m = h.match(/^#\/team\/([A-Za-z]{2,4})$/))) { league = "nfl"; setNav("leagues"); showTeam(m[1].toUpperCase()); }
    else if ((m = h.match(/^#\/player\/(\d+)$/))) { league = "nfl"; setNav("leagues"); showPlayer(m[1]); }
    else if (h === "#/teams") { league = "nfl"; setNav("leagues"); showTeams(); }
    else if (h === "#/leagues") { setNav("leagues"); showLeagues(); }
    else if (h === "#/podcasts") { setNav("podcasts"); showPodcasts(); }
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
