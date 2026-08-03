/* Armchair Experts — the Australian NFL platform.
   Hash-routed SPA: #/ (What to Watch) · #/teams · #/team/{abbr} · #/player/{id}
   Live data via /api/* (ESPN public feeds, normalised + cached server-side). */
(function () {
  "use strict";

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

  const HUB_HTML = `
    <div class="ribbon">
      <div class="shell">
        <button class="wknav" id="wk-prev" aria-label="Previous week">‹</button>
        <span class="wk" id="wk-label">Loading…</span>
        <button class="wknav" id="wk-next" aria-label="Next week">›</button>
        <span class="sub" id="ribbon-sub">Every game, your kick-off time, one tap to stream.</span>
      </div>
    </div>
    <div class="shell">
      <div id="loading" class="loading">Fetching the live slate…</div>
      <div id="content" hidden>
        <section id="rtg"></section>
        <div class="section-h">Game of the Week</div>
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
        <div class="section-h" style="margin-top:32px">Aussies in the NFL <span class="n" id="aus-note">· this week</span></div>
        <div class="aus" id="aus"></div>
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

  function renderRtg(rtg) {
    const el = $("rtg");
    if (!rtg || !rtg.game) { el.innerHTML = ""; return; }
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
      <div class="rtg">
        <div class="rtg-top">
          <span class="rtg-ey">🏟 ${esc(s.title || "California to the G")}</span>
          <span class="rtg-arc">${stages.map((x, i) => `<b class="${i === stage ? "on" : ""}">${x}</b>`).join("<i>→</i>")}</span>
        </div>
        <div class="rtg-body">
          <div class="rtg-mu">
            <img src="${esc(g.away.logo)}" alt="${esc(g.away.displayName)}">
            <span class="vs">vs</span>
            <img src="${esc(g.home.logo)}" alt="${esc(g.home.displayName)}">
            <div class="rtg-names">
              <div class="rtg-nm">${esc(g.away.name)} vs ${esc(g.home.name)}</div>
              <div class="rtg-venue">${esc(g.venue)} · the NFL's first game in Australia</div>
            </div>
          </div>
          ${centre}
          <div class="rtg-cta">
            <a class="watch" target="_blank" rel="noopener" data-watch="${esc(g.away.abbr)}@${esc(g.home.abbr)}"
               href="https://www.disneyplus.com/?utm_source=armchair&utm_medium=rtg&utm_campaign=mcg&utm_content=${esc(g.away.abbr)}@${esc(g.home.abbr)}">
               <span class="tv">▶</span> ${done ? "Relive it on Disney+" : "Watch it live on Disney+"}</a>
            <div class="rtg-your-tz">${k.wd} ${k.day} · ${k.tm} ${TZ_LABEL[tz]}</div>
          </div>
        </div>
        ${(s.episodes || []).length ? `
        <div class="rtg-rail">
          <div class="rtg-rail-h">${esc(s.sub || "")}</div>
          <div class="rtg-eps">
            ${s.episodes.map((e) => `
              <a class="rtg-ep${e.url ? "" : " soon"}" ${e.url ? `href="${esc(e.url)}" target="_blank" rel="noopener"` : ""}>
                <span class="n">EP ${esc(e.n)}</span>
                <span class="t">${esc(e.title)}</span>
                <span class="g">${esc(e.guest)}</span>
                <span class="s">${e.url ? "▶ Watch" : "Coming soon"}</span>
              </a>`).join("")}
          </div>
        </div>` : ""}
      </div>`;

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

  function why(g) {
    const bits = [];
    const sp = g.odds && g.odds.spread != null ? Math.abs(g.odds.spread) : null;
    const ou = g.odds && g.odds.overUnder;
    const hot = (r) => { const [w, l] = (r || "0-0").split("-").map(Number); return w + l > 0 && w / (w + l) >= 0.65; };
    if (g.status.state === "in") bits.push("Live right now — " + g.status.detail);
    if (sp !== null && sp <= 2.5) bits.push("a genuine coin-flip");
    else if (sp !== null && sp <= 4.5) bits.push("tight line");
    if (ou && ou >= 48) bits.push("shootout script (O/U " + ou + ")");
    if (hot(g.home.record) && hot(g.away.record)) bits.push("two form sides");
    if (/Night Football/.test(g.slot)) bits.push("prime-time window");
    if (g.aussies.length) bits.push("🇦🇺 " + g.aussies.map((a) => a.name).join(" & ") + " on the field");
    if (!bits.length) bits.push(g.odds && g.odds.details ? "Line: " + g.odds.details : "One for the completists");
    let s = bits.join(" · ");
    return s.charAt(0).toUpperCase() + s.slice(1) + ".";
  }

  function teamHTML(t, big, showScore) {
    const score = showScore && t.score != null ? ` <span class="sc tnum">${esc(t.score)}</span>` : "";
    return `<a class="team" href="#/team/${esc(t.abbr)}">
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
    const label = g.status.state === "post" ? "Replay on Disney+" : "Watch on Disney+";
    const utm = `utm_source=armchair&utm_medium=wtw&utm_campaign=week${wk}&utm_content=${g.away.abbr}@${g.home.abbr}`;
    return `<a class="watch ${cls || ""}" target="_blank" rel="noopener"
      href="https://www.disneyplus.com/?${utm}" data-watch="${esc(g.away.abbr)}@${esc(g.home.abbr)}">
      <span class="tv">▶</span> ${label}</a>`;
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
      const aus = g.aussies.length
        ? `<span class="aus-flag" title="${esc(g.aussies[0].hook)}">🇦🇺 ${esc(g.aussies.map((a) => a.name + " (" + a.pos + ")").join(", "))}</span>`
        : `<span></span>`;
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

  function renderRibbon() {
    const s = hubData.season, w = hubData.week;
    const cal = hubData.calendar || [];
    const idx = cal.findIndex((c) => c.seasontype === s.type && c.week === w.number);
    const label = idx >= 0 ? cal[idx].label : "Week " + w.number;
    const stName = { 1: "Preseason", 2: "", 3: "Postseason" }[s.type] || "";
    $("wk-label").textContent = [stName, label].filter(Boolean).join(" · ") + " · What to Watch";
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
        toast(`Deep-link to Disney+ · <span class="u">utm_source=armchair&amp;game=${esc(b.getAttribute("data-watch"))}</span> — click tracked to sign-up`);
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
    const qs = weekView ? `?year=${weekView.year}&seasontype=${weekView.seasontype}&week=${weekView.week}` : "";
    try {
      const [sched, aus, rtg] = await Promise.all([
        fetch("/api/schedule" + qs).then((r) => { if (!r.ok) throw new Error("API " + r.status); return r.json(); }),
        aussies.length ? Promise.resolve(null) : fetchJSON("/api/aussies"),
        fetchJSON("/api/road-to-the-g").catch(() => null),
      ]);
      hubData = sched;
      if (aus) aussies = aus.players || [];
      $("source-line").textContent = "Data: " + (hubData.source || "");
      const ep = hubData.experts && hubData.experts.episode;
      if (ep && ep.title) {
        const show = (hubData.experts.show || {});
        episodeHTML = `🎙 This week on ${esc(show.name || "the show")}: <b>${esc(ep.title)}</b>` +
          (ep.url ? ` · <a href="${esc(ep.url)}" target="_blank" rel="noopener">listen</a>` : "");
      } else {
        episodeHTML = "";
      }
      renderRibbon(); renderRtg(rtg); renderGotw(); renderSlate(); renderAussies(); setTzNote();
      $("loading").hidden = true;
      $("content").hidden = false;
    } catch (err) {
      $("loading").textContent = "Couldn't reach the live feed (" + err.message + "). Refresh to retry.";
    }
  }

  function showHub() {
    view.innerHTML = HUB_HTML;
    bindHubControls();
    loadHub();
  }

  // =====================================================================
  // TEAMS grid
  // =====================================================================

  async function showTeams() {
    view.innerHTML = `<div class="shell"><div class="loading">Loading the 32 clubs…</div></div>`;
    try {
      const d = await fetchJSON("/api/teams");
      view.innerHTML = `<div class="shell">
        <div class="section-h" style="margin-top:18px">Teams</div>
        ${d.divisions.map((div) => `
          <div class="div-h">${esc(div.name)}</div>
          <div class="teams-grid">
            ${div.teams.map((t) => `
              <a class="team-card" href="#/team/${esc(t.abbr)}">
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
      const d = await fetchJSON("/api/team/" + encodeURIComponent(abbr));
      const t = d.team;
      let next = "";
      if (t.nextEvent && t.nextEvent.date) {
        const k = fmt(t.nextEvent.date);
        next = `Next: ${esc(t.nextEvent.shortName)} · ${k.wd} ${k.day} ${k.tm} ${TZ_LABEL[tz]}`;
      }
      const aussieCount = d.groups.reduce((n, g) => n + g.players.filter((p) => p.aussie).length, 0);
      view.innerHTML = `
        <div class="team-hero" style="background:linear-gradient(120deg,#${esc(t.color || "222")}E6,#${esc(t.color || "222")}66),var(--card)">
          <div class="shell">
            <a class="crumb" href="#/teams">← All teams</a>
            <div class="th-row">
              <img class="th-logo" src="${esc(t.logo)}" alt="">
              <div>
                <div class="th-loc">${esc(t.location)}</div>
                <h1 class="th-name">${esc(t.name)}</h1>
                <div class="th-meta">${esc(t.record)} · ${esc(t.standing)} · ${esc(t.division)}${aussieCount ? ` · 🇦🇺 ${aussieCount} Aussie${aussieCount > 1 ? "s" : ""} on the list` : ""}</div>
                ${next ? `<div class="th-next">${next}</div>` : ""}
              </div>
            </div>
          </div>
        </div>
        <div class="shell">
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
        const go = () => { location.hash = "#/player/" + tr.getAttribute("data-player"); };
        tr.addEventListener("click", go);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      });
    } catch (err) {
      view.innerHTML = `<div class="shell"><div class="loading">Couldn't load ${esc(abbr)} (${esc(err.message)}).</div></div>`;
    }
  }

  // =====================================================================
  // PLAYER page
  // =====================================================================

  async function showPlayer(pid) {
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
    window.scrollTo(0, 0);
    if ((m = h.match(/^#\/team\/([A-Za-z]{2,4})$/))) { setNav("teams"); showTeam(m[1].toUpperCase()); }
    else if ((m = h.match(/^#\/player\/(\d+)$/))) { setNav("teams"); showPlayer(m[1]); }
    else if (h === "#/teams") { setNav("teams"); showTeams(); }
    else { setNav("watch"); showHub(); }
  }

  window.addEventListener("hashchange", route);
  route();
})();
