/* Armchair Experts — What to Watch hub.
   Live data via /api/schedule (ESPN public feed, normalised server-side). */
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
  let view = null; // null = ESPN "current"; else {year, seasontype, week}
  let data = null;
  let aussies = [];

  const $ = (id) => document.getElementById(id);

  // ---------- formatting ----------
  const fmt = (iso) => {
    const d = new Date(iso);
    const wd = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: tz }).format(d).toUpperCase();
    const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: tz }).format(d);
    const tm = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
      .format(d).toUpperCase().replace(" ", "");
    return { wd, day, tm };
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- storyline generator (deterministic, data-driven) ----------
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

  // ---------- building blocks ----------
  function teamHTML(t, big, showScore) {
    const score = showScore && t.score != null ? ` <span class="sc tnum">${esc(t.score)}</span>` : "";
    return `<div class="team">
      <img class="logo${big ? "" : " sm"}" src="${esc(t.logo)}" alt="${esc(t.displayName)} logo" loading="lazy">
      <div><div class="nm">${esc(t.name)}</div><div class="rec">${esc(t.record)}${score}</div></div>
    </div>`;
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
    const wk = data && data.week ? data.week.number : "";
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

  // ---------- sections ----------
  function renderGotw() {
    const g = data.games.find((x) => x.id === data.gotw) || data.games[0];
    if (!g) { $("gotw").innerHTML = ""; return; }
    const k = fmt(g.date);
    const showScore = g.status.state !== "pre";
    $("gotw").innerHTML = `
      <div class="ey">★ Marquee · ${TZ_LABEL[tz]} prime viewing</div>
      <div class="body">
        <div>
          <div class="matchup">${teamHTML(g.away, true, showScore)}<span class="at">at</span>${teamHTML(g.home, true, showScore)}</div>
          <p class="why">${why(g)}</p>
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
    let list = data.games.slice();
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
          ${statusBadge(g)}
          <button class="star" data-star="${esc(g.id)}" aria-pressed="${on}" title="Add to my watchlist" aria-label="Add to watchlist">${on ? "★" : "☆"}</button>
        </div>
        <div class="mu">${teamHTML(g.away, false, showScore)}<span class="at">at</span>${teamHTML(g.home, false, showScore)}</div>
        ${meter(g)}
        <div class="row">
          <div class="whenwrap"><span class="when tnum">${k.wd} ${k.day} · ${k.tm}</span><span class="slot">${esc(g.slot)}${g.broadcast ? " · " + esc(g.broadcast) : ""}</span></div>
        </div>
        <p class="why">${why(g)}</p>
        <div class="foot">${aus}${watchBtn(g, "sm ghost")}</div>
      </article>`;
    }).join("");
    $("slate-count").textContent = "· " + list.length + (list.length === 1 ? " game" : " games");
    bindStars();
    bindWatch($("slate"));
  }

  function renderAussies() {
    const byTeam = {};
    data.games.forEach((g) => {
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
    const s = data.season, w = data.week;
    const cal = data.calendar || [];
    const idx = cal.findIndex((c) => c.seasontype === s.type && c.week === w.number);
    const label = idx >= 0 ? cal[idx].label : "Week " + w.number;
    const stName = { 1: "Preseason", 2: "", 3: "Postseason" }[s.type] || "";
    $("wk-label").textContent = [stName, label].filter(Boolean).join(" · ") + " · What to Watch";
    $("wk-prev").disabled = idx <= 0;
    $("wk-next").disabled = idx < 0 || idx >= cal.length - 1;
    $("wk-prev").onclick = () => { if (idx > 0) jump(cal[idx - 1]); };
    $("wk-next").onclick = () => { if (idx >= 0 && idx < cal.length - 1) jump(cal[idx + 1]); };
  }

  function jump(entry) {
    view = { year: data.season.year, seasontype: entry.seasontype, week: entry.week };
    load();
  }

  // ---------- interactions ----------
  let toastTimer = null;
  function toast(html) {
    const el = $("toast");
    el.innerHTML = html;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
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

  function setTzNote() {
    $("tz-note").textContent = "Kick-offs converted live to " + TZ_LABEL[tz] + " time";
    $("ribbon-sub").textContent = "Every game in " + TZ_LABEL[tz] + " time, one tap to stream.";
  }

  document.querySelectorAll("[data-tz]").forEach((b) => {
    b.addEventListener("click", () => {
      tz = b.getAttribute("data-tz");
      localStorage.setItem(TZ_KEY, tz);
      document.querySelectorAll("[data-tz]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderGotw(); renderSlate(); renderAussies(); setTzNote();
    });
  });
  document.querySelectorAll("[data-sort]").forEach((b) => {
    b.addEventListener("click", () => {
      sort = b.getAttribute("data-sort");
      document.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderSlate();
    });
  });
  document.querySelectorAll("[data-tz]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.getAttribute("data-tz") === tz)));

  // ---------- load ----------
  async function load() {
    $("loading").hidden = false;
    $("content").hidden = true;
    const qs = view ? `?year=${view.year}&seasontype=${view.seasontype}&week=${view.week}` : "";
    try {
      const [sched, aus] = await Promise.all([
        fetch("/api/schedule" + qs).then((r) => { if (!r.ok) throw new Error("API " + r.status); return r.json(); }),
        aussies.length ? Promise.resolve(null) : fetch("/api/aussies").then((r) => r.json()),
      ]);
      data = sched;
      if (aus) aussies = aus.players || [];
      $("source-line").textContent = "Data: " + (data.source || "");
      renderRibbon(); renderGotw(); renderSlate(); renderAussies(); setTzNote();
      $("loading").hidden = true;
      $("content").hidden = false;
    } catch (err) {
      $("loading").textContent = "Couldn't reach the live feed (" + err.message + "). Refresh to retry.";
    }
  }

  load();
})();
