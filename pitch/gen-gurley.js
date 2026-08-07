/* "Running it Back" — the Todd Gurley pitch deck.
   Rebuild: cd pitch && node gen-gurley.js Running-it-Back-Gurley.pptx
   Placeholders in [SQUARE BRACKETS] are waiting on Cam / iHeart terms. */
const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.33, height: 7.5 });
p.layout = "W";

const C = {
  bg: "0F0407", card: "1E0C13", panel: "2A111B", ink: "F9F3F5", ink2: "DCC3CB",
  muted: "A57E8B", line: "43202C", accent: "F5294B", gold: "FFB020", blue: "5AA7FF", go: "43C58C",
};
const DISP = "Arial Narrow", BODY = "Arial";
const M = 0.55, W = 13.33;
const gap = 0.2;
const col4 = (W - 2 * M - 3 * gap) / 4;
const x4 = (i) => M + i * (col4 + gap);
const col3 = (W - 2 * M - 2 * gap) / 3;
const x3 = (i) => M + i * (col3 + gap);

function card(s, x, y, w, h, fill = C.card, line = C.line) {
  s.addShape(p.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: line, width: 1 }, rectRadius: 0.09 });
}
function slide(bg = C.bg) {
  const s = p.addSlide();
  s.background = { color: bg };
  return s;
}
function eyebrow(s, t, color = C.accent) {
  s.addText(t, { x: M, y: 0.46, w: 9, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color, charSpacing: 3, margin: 0 });
}
function title(s, t, size = 42) {
  s.addText(t, { x: M - 0.02, y: 0.78, w: 11.6, h: 1.2, fontFace: DISP, fontSize: size, bold: true, color: C.ink, lineSpacingMultiple: 0.95, margin: 0, valign: "top" });
}
function sub(s, t, y = 1.95) {
  s.addText(t, { x: M, y, w: 10.4, h: 0.8, fontFace: BODY, fontSize: 14.5, color: C.ink2, lineSpacingMultiple: 1.08, margin: 0, valign: "top" });
}
function foot(s, t) {
  s.addText(t, { x: M, y: 7.0, w: W - 2 * M, h: 0.34, fontFace: BODY, fontSize: 9, color: C.muted, margin: 0, valign: "top" });
}
function statCard(s, i, big, label, note, y = 3.0, h = 1.5, accent = C.accent) {
  const x = x4(i);
  card(s, x, y, col4, h);
  s.addText([
    { text: big, options: { fontFace: DISP, fontSize: 33, bold: true, color: accent, breakLine: true } },
    { text: label, options: { fontFace: BODY, fontSize: 12, bold: true, color: C.ink, breakLine: true, paraSpaceBefore: 5 } },
    { text: note, options: { fontFace: BODY, fontSize: 9.5, color: C.muted, breakLine: true, paraSpaceBefore: 3 } },
  ], { x: x + 0.16, y: y + 0.14, w: col4 - 0.32, h: h - 0.28, margin: 0, valign: "top", lineSpacingMultiple: 0.98 });
}

/* ---------- 1. COVER ---------- */
const s1 = slide();
s1.addShape(p.ShapeType.rect, { x: 0, y: 0, w: W, h: 7.5, fill: { color: C.bg } });
s1.addShape(p.ShapeType.roundRect, { x: 0.9, y: 1.5, w: 6.6, h: 3.3, fill: { color: "1A0810" }, line: { color: C.accent, width: 2.5 }, rectRadius: 0.06 });
s1.addText("A PROPOSAL FOR TODD GURLEY", { x: 1.25, y: 1.85, w: 6, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: C.gold, charSpacing: 3.5, margin: 0 });
s1.addText("RUNNING\nIT BACK", { x: 1.2, y: 2.25, w: 6, h: 1.9, fontFace: DISP, fontSize: 76, bold: true, color: C.ink, lineSpacingMultiple: 0.86, margin: 0, valign: "top" });
s1.addText("An iHeart America × iHeart Australia co-production", { x: 1.25, y: 4.15, w: 6, h: 0.35, fontFace: BODY, fontSize: 13, color: C.ink2, margin: 0 });
s1.addText([
  { text: "Todd Gurley", options: { color: C.accent, bold: true } },
  { text: "  ·  Cam Luke  ·  Armchair Experts", options: { color: C.ink2 } },
], { x: 0.95, y: 5.1, w: 7, h: 0.4, fontFace: DISP, fontSize: 24, margin: 0 });
s1.addText("Founding equity in the show that owns American football in Australia.", { x: 0.95, y: 5.6, w: 7.2, h: 0.5, fontFace: BODY, fontSize: 13.5, color: C.ink2, margin: 0, lineSpacingMultiple: 1.1 });
card(s1, 8.4, 1.5, 4.0, 4.7, C.panel, "3A5F8C");
s1.addText("WHY NOW", { x: 8.65, y: 1.75, w: 3.5, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.blue, charSpacing: 2, margin: 0 });
[
  ["11 SEP 2026", "The NFL plays its first ever game in Australia — 100,000 at the MCG."],
  ["A NEW MARKET", "American football is the fastest-growing sport in Australia, with no dominant local voice."],
  ["FIRST MOVER", "The show that owns this moment owns the category for a decade."],
].forEach((r, i) => {
  const y = 2.25 + i * 1.32;
  s1.addText(r[0], { x: 8.65, y, w: 3.5, h: 0.3, fontFace: DISP, fontSize: 19, bold: true, color: C.ink, margin: 0 });
  s1.addText(r[1], { x: 8.65, y: y + 0.34, w: 3.5, h: 0.85, fontFace: BODY, fontSize: 11.5, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
});
foot(s1, "Confidential proposal · prepared for Todd Gurley · August 2026");

/* ---------- 2. THE MOMENT ---------- */
const s2 = slide();
eyebrow(s2, "THE MOMENT");
title(s2, "A country discovers the NFL —\nin one night.");
sub(s2, "On 11 September 2026 the 49ers and Rams play a regular-season game at the Melbourne Cricket Ground. It is the NFL's first game in Australia, in a 100,000-seat stadium, in the country's sporting cathedral. Every Australian sports fan will be watching something they've never seen before.");
statCard(s2, 0, "100k", "At the MCG", "The NFL's first game on Australian soil");
statCard(s2, 1, "#1", "Growth market", "Australia is a priority international market for the league");
statCard(s2, 2, "0", "Incumbent voice", "No established Australian NFL show owns this space");
statCard(s2, 3, "5 wks", "Until kick-off", "The window to launch into the moment is now", 3.0, 1.5, C.gold);
card(s2, M, 4.85, W - 2 * M, 1.85, C.panel, "3A5F8C");
s2.addText("THE INSIGHT", { x: M + 0.28, y: 5.05, w: 6, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.blue, charSpacing: 2, margin: 0 });
s2.addText([
  { text: "Sunday football in America is ", options: { color: C.ink } },
  { text: "Monday daytime in Australia", options: { color: C.accent, bold: true } },
  { text: ". Every week, the best day of American sport lands in the middle of the Australian working week — and nobody is programming for it. That's not a scheduling quirk. That's an unclaimed audience, every single week, for five months a year.", options: { color: C.ink } },
], { x: M + 0.28, y: 5.45, w: W - 2 * M - 0.56, h: 1.1, fontFace: BODY, fontSize: 14, margin: 0, valign: "top", lineSpacingMultiple: 1.08 });
foot(s2, "Running it Back · an iHeart America × iHeart Australia co-production");

/* ---------- 3. THE SHOW ---------- */
const s3 = slide();
eyebrow(s3, "THE SHOW");
title(s3, "Running it Back");
sub(s3, "A weekly NFL show for the Australian market, hosted by Todd Gurley and Cam Luke — an All-Pro who lived it and a broadcaster who translates it. Recorded remotely, released for the Australian Monday.");
[
  ["THE FORMAT", "Weekly through the NFL season. What happened, what it means, and what to watch — with a player's eye on the tape and a broadcaster's ear for the audience that's just arriving."],
  ["THE HOSTS", "Todd brings the credibility no Australian show can manufacture: three-time All-Pro, Offensive Player of the Year, a name that opens every door in the league. Cam brings seven years of national broadcast and a built audience."],
  ["THE COMMITMENT", "Roughly two hours a week, remote, in season. Production, editing, distribution and commercial all carried by iHeart and the Armchair team. [CONFIRM: recording cadence & windows]"],
].forEach((r, i) => {
  const x = x3(i);
  card(s3, x, 3.0, col3, 2.5);
  s3.addText(r[0], { x: x + 0.2, y: 3.22, w: col3 - 0.4, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.gold, charSpacing: 2, margin: 0 });
  s3.addText(r[1], { x: x + 0.2, y: 3.62, w: col3 - 0.4, h: 1.75, fontFace: BODY, fontSize: 12.5, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
});
card(s3, M, 5.72, W - 2 * M, 1.0, C.panel, "3A5F8C");
s3.addText([
  { text: "The name: ", options: { color: C.ink2 } },
  { text: "Running it Back", options: { color: C.accent, bold: true, fontFace: DISP, fontSize: 20 } },
  { text: "  — the run game, the rewatch, and the return. It works for the football, for the format, and for what comes after it.", options: { color: C.ink2 } },
], { x: M + 0.28, y: 5.95, w: W - 2 * M - 0.56, h: 0.6, fontFace: BODY, fontSize: 13.5, margin: 0, valign: "middle" });
foot(s3, "Running it Back · an iHeart America × iHeart Australia co-production");

/* ---------- 4. THE ARC ---------- */
const s4 = slide();
eyebrow(s4, "THE ARC", C.gold);
title(s4, "Three seasons, one story.");
sub(s4, "This isn't a one-season podcast. It's a three-year run at a market that opens in September and peaks in Los Angeles.");
[
  ["2026", "THE LAUNCH", "The MCG game lands and a country pays attention for the first time. Running it Back launches into the wave with the NFL season behind it.", C.accent],
  ["2027", "THE HABIT", "A full season builds the weekly ritual — Monday mornings become Running it Back. The audience compounds; the commercial story matures.", C.gold],
  ["2028", "LA & THE GAMES", "The Olympics come to Todd's city. A track-and-field pedigree plus an NFL platform makes him the only voice who can carry both — and the show runs it back to where it started. [SCOPE TBC]", C.blue],
].forEach((r, i) => {
  const x = x3(i);
  card(s4, x, 3.0, col3, 2.85);
  s4.addText(r[0], { x: x + 0.2, y: 3.2, w: col3 - 0.4, h: 0.6, fontFace: DISP, fontSize: 40, bold: true, color: r[3], margin: 0 });
  s4.addText(r[1], { x: x + 0.2, y: 3.85, w: col3 - 0.4, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: C.ink, charSpacing: 2, margin: 0 });
  s4.addText(r[2], { x: x + 0.2, y: 4.22, w: col3 - 0.4, h: 1.5, fontFace: BODY, fontSize: 12, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
});
s4.addText("A show with a destination is worth more than a show with a schedule — to audiences, to partners, and to the people who own it.", { x: M, y: 6.15, w: W - 2 * M, h: 0.5, fontFace: BODY, fontSize: 14, color: C.ink, margin: 0, italic: true });
foot(s4, "Running it Back · an iHeart America × iHeart Australia co-production");

/* ---------- 5. THE DEAL ---------- */
const s5 = slide();
eyebrow(s5, "THE PROPOSAL");
title(s5, "You don't host it. You own it.");
sub(s5, "This is not a fee-for-appearance. It's founding equity in a media property built for a market at its starting line — structured so that the upside belongs to the people who make it work.");
[
  ["EQUITY", "[X]%", "Founding stake in the show entity, alongside iHeart and Armchair. [CONFIRM STRUCTURE]"],
  ["THE BACKING", "iHeart", "iHeart America × iHeart Australia co-production: production, distribution and commercial sales across both markets. [CONFIRM COMMITMENTS]"],
  ["THE FEE", "[$X]", "A base per-episode fee alongside the equity, scaling with audience milestones. [CONFIRM MIX]"],
  ["YOUR INPUT", "~2 hrs", "Per week, in season, remote. Everything else is carried."],
].forEach((r, i) => {
  const x = x4(i);
  card(s5, x, 3.0, col4, 2.2, i === 0 ? C.panel : C.card, i === 0 ? "8C2F45" : C.line);
  s5.addText(r[0], { x: x + 0.16, y: 3.2, w: col4 - 0.32, h: 0.28, fontFace: BODY, fontSize: 10, bold: true, color: C.gold, charSpacing: 2, margin: 0 });
  s5.addText(r[1], { x: x + 0.16, y: 3.52, w: col4 - 0.32, h: 0.6, fontFace: DISP, fontSize: 34, bold: true, color: i === 0 ? C.accent : C.ink, margin: 0 });
  s5.addText(r[2], { x: x + 0.16, y: 4.18, w: col4 - 0.32, h: 0.95, fontFace: BODY, fontSize: 11, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
});
card(s5, M, 5.42, W - 2 * M, 1.3, C.panel, "3A5F8C");
s5.addText("THE COMPARISON", { x: M + 0.28, y: 5.6, w: 6, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.blue, charSpacing: 2, margin: 0 });
s5.addText("Pat McAfee licensed his show to ESPN while keeping ownership. The Kelces took New Heights to Amazon. Athlete-owned media is now an asset class — and every one of those deals started as a small show with a big name attached. This is that entry point, in a market with no competition for the seat.", { x: M + 0.28, y: 5.95, w: W - 2 * M - 0.56, h: 0.7, fontFace: BODY, fontSize: 13, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
foot(s5, "All figures in [brackets] to be confirmed with iHeart before issue · indicative structure only");

/* ---------- 6. THE PLATFORM ---------- */
const s6 = slide();
eyebrow(s6, "THIS ALREADY EXISTS", C.go);
title(s6, "Not a pitch deck. A platform.");
sub(s6, "The show launches onto infrastructure that's already built and running on live data — every NFL game in Australian time, all 32 teams, every player, and the measurement layer that proves what the audience does.");
try {
  s6.addImage({ path: "assets/landing.png", x: M, y: 2.95, w: 6.05, h: 3.79 });
  s6.addImage({ path: "assets/advent.png", x: M + 6.35, y: 2.95, w: 6.05, h: 3.79 });
} catch (e) { /* screenshots optional */ }
foot(s6, "armchair-nfl.vercel.app — live now · built on the Armchair data engine");

/* ---------- 7. THE ASK ---------- */
const s7 = slide();
s7.addShape(p.ShapeType.rect, { x: 0, y: 0, w: W, h: 7.5, fill: { color: C.bg } });
eyebrow(s7, "THE ASK");
title(s7, "Say yes to season one.", 46);
s7.addText([
  { text: "One season. Your name, your voice, your equity. iHeart papers the deal and carries the production; Cam and the Armchair team carry the craft; the platform carries the audience.", options: { color: C.ink2, breakLine: true } },
], { x: M, y: 2.0, w: 8.6, h: 1.0, fontFace: BODY, fontSize: 15.5, margin: 0, valign: "top", lineSpacingMultiple: 1.1 });
[
  ["1", "Agree the structure", "Equity, fee and term with iHeart. [TARGET: week of ___]"],
  ["2", "Announce into the moment", "Reveal ahead of the MCG game — the launch has its own news cycle."],
  ["3", "First episode, Week 1", "Recording remote, releasing for the Australian Monday."],
].forEach((r, i) => {
  const x = x3(i);
  card(s7, x, 3.3, col3, 1.9);
  s7.addShape(p.ShapeType.ellipse, { x: x + 0.2, y: 3.5, w: 0.42, h: 0.42, fill: { color: C.accent } });
  s7.addText(r[0], { x: x + 0.2, y: 3.53, w: 0.42, h: 0.36, align: "center", fontFace: DISP, fontSize: 17, bold: true, color: "FFFFFF", margin: 0 });
  s7.addText(r[1], { x: x + 0.72, y: 3.52, w: col3 - 0.92, h: 0.4, fontFace: DISP, fontSize: 20, bold: true, color: C.ink, margin: 0 });
  s7.addText(r[2], { x: x + 0.2, y: 4.12, w: col3 - 0.4, h: 0.9, fontFace: BODY, fontSize: 12, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
});
card(s7, M, 5.5, W - 2 * M, 1.2, C.panel, "8C2F45");
s7.addText([
  { text: "The MCG game happens once. ", options: { color: C.accent, bold: true } },
  { text: "The show that owns that moment owns American football in Australia — and we'd rather build it with you than around you.", options: { color: C.ink } },
], { x: M + 0.3, y: 5.72, w: W - 2 * M - 0.6, h: 0.8, fontFace: BODY, fontSize: 16, margin: 0, valign: "middle", lineSpacingMultiple: 1.08 });
foot(s7, "Cam Luke · Armchair Experts · [email] · [phone] — armchair-nfl.vercel.app");

const OUT = process.argv[2] || "Running-it-Back-Gurley.pptx";
p.writeFile({ fileName: OUT }).then((f) => console.log("wrote", f));
