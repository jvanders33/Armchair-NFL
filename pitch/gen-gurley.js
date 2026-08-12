/* "Running it Back" — the Todd Gurley proposal.
   Rebuild: cd pitch && node gen-gurley.js Running-it-Back-Gurley.pptx
   [BRACKETS] = numbers still to come from Cam / iHeart.

   Imagery: Todd's headshot and league/club marks come from ESPN's public CDN
   (identification use, same source the platform uses). Cam's portrait is from
   the Armchair deck. Swap in licensed hero photography before any external
   distribution beyond Todd himself. */
const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.33, height: 7.5 });
p.layout = "W";

const C = {
  bg: "0F0407", card: "1E0C13", panel: "2A111B", ink: "F9F3F5", ink2: "DCC3CB",
  muted: "A57E8B", line: "43202C", accent: "F5294B", gold: "FFB020", blue: "5AA7FF",
  go: "43C58C", deep: "8C0F27",
};
const DISP = "Arial Narrow", BODY = "Arial";
const M = 0.55, W = 13.33, H = 7.5, gap = 0.2;
const col4 = (W - 2 * M - 3 * gap) / 4, x4 = (i) => M + i * (col4 + gap);
const col3 = (W - 2 * M - 2 * gap) / 3, x3 = (i) => M + i * (col3 + gap);
const IMG = (f) => `assets/img/${f}`;

const card = (s, x, y, w, h, fill = C.card, line = C.line) =>
  s.addShape(p.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: line, width: 1 }, rectRadius: 0.09 });
const slide = () => { const s = p.addSlide(); s.background = { color: C.bg }; return s; };
const eyebrow = (s, t, color = C.accent) =>
  s.addText(t, { x: M, y: 0.44, w: 9, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color, charSpacing: 3, margin: 0 });
const title = (s, t, size = 40, w = 11.8) =>
  s.addText(t, { x: M - 0.02, y: 0.76, w, h: 1.15, fontFace: DISP, fontSize: size, bold: true, color: C.ink, lineSpacingMultiple: 0.95, margin: 0, valign: "top" });
const sub = (s, t, y = 1.92, w = 10.6) =>
  s.addText(t, { x: M, y, w, h: 0.85, fontFace: BODY, fontSize: 14, color: C.ink2, lineSpacingMultiple: 1.08, margin: 0, valign: "top" });
const foot = (s, t) =>
  s.addText(t, { x: M, y: 7.02, w: W - 2 * M, h: 0.32, fontFace: BODY, fontSize: 9, color: C.muted, margin: 0, valign: "top" });
// a soft red wash behind imagery so photos sit in the brand rather than on it
const glow = (s, x, y, w, h, color = C.deep, transparency = 62) =>
  s.addShape(p.ShapeType.ellipse, { x, y, w, h, fill: { color, transparency }, line: { color, width: 0, transparency: 100 } });

function statCard(s, i, big, label, note, y = 3.0, h = 1.5, accent = C.accent) {
  const x = x4(i);
  card(s, x, y, col4, h);
  s.addText([
    { text: big, options: { fontFace: DISP, fontSize: 32, bold: true, color: accent, breakLine: true } },
    { text: label, options: { fontFace: BODY, fontSize: 12, bold: true, color: C.ink, breakLine: true, paraSpaceBefore: 5 } },
    { text: note, options: { fontFace: BODY, fontSize: 9.5, color: C.muted, breakLine: true, paraSpaceBefore: 3 } },
  ], { x: x + 0.16, y: y + 0.14, w: col4 - 0.32, h: h - 0.28, margin: 0, valign: "top", lineSpacingMultiple: 0.98 });
}

/* ================= 1. COVER — Todd, large ================= */
const s1 = slide();
glow(s1, 6.2, -1.4, 8.6, 8.6);
s1.addImage({ path: IMG("gurley.png"), x: 7.55, y: 1.25, w: 5.1, h: 4.94 });

s1.addText("A PROPOSAL FOR TODD GURLEY", { x: M, y: 1.5, w: 6.4, h: 0.3, fontFace: BODY, fontSize: 11.5, bold: true, color: C.gold, charSpacing: 3.5, margin: 0 });
s1.addText("RUNNING\nIT BACK", { x: M - 0.04, y: 1.92, w: 6.6, h: 2.5, fontFace: DISP, fontSize: 88, bold: true, color: C.ink, lineSpacingMultiple: 0.85, margin: 0, valign: "top" });
s1.addShape(p.ShapeType.rect, { x: M, y: 4.42, w: 2.0, h: 0.055, fill: { color: C.accent }, line: { width: 0 } });
s1.addText("Two NFL seasons.\nAnd a Super Bowl in your city.",
  { x: M, y: 4.66, w: 6.4, h: 0.8, fontFace: DISP, fontSize: 24, bold: true, color: C.gold, lineSpacingMultiple: 0.98, margin: 0, valign: "top" });
s1.addText([
  { text: "Todd Gurley", options: { color: C.accent, bold: true } },
  { text: "   ·   Cam Luke   ·   Armchair Experts", options: { color: C.ink2 } },
], { x: M, y: 5.62, w: 8.2, h: 0.4, fontFace: DISP, fontSize: 23, margin: 0 });
s1.addText("An iHeart America × iHeart Australia co-production — with founding equity for Todd.",
  { x: M, y: 6.08, w: 7.4, h: 0.4, fontFace: BODY, fontSize: 13, color: C.ink2, margin: 0 });
foot(s1, "Confidential proposal · prepared for Todd Gurley · August 2026");

/* ================= 2. THE OPPORTUNITY ================= */
const s2 = slide();
eyebrow(s2, "THE OPPORTUNITY");
title(s2, "The most under-served football\nmarket in the world.");
sub(s2, "On 11 September the NFL plays its first ever game in Australia — 100,000 people at the Melbourne Cricket Ground, five weeks from now. A national audience is about to arrive overnight, and there is no established local show waiting to receive it. In America that window closed a decade ago. Here it is wide open, and it needs one credible voice.", 2.1, 9.6);
s2.addImage({ path: IMG("nfl.png"), x: 11.35, y: 0.72, w: 1.35, h: 1.35, transparency: 25 });
statCard(s2, 0, "100k", "At the MCG", "11 Sep — the NFL's first game on Australian soil");
statCard(s2, 1, "#1", "Growth market", "A priority international market for the league");
statCard(s2, 2, "0", "Incumbent voice", "No established Australian NFL show owns this space");
statCard(s2, 3, "2", "Seasons", "A two-year run, weekly through both", 3.0, 1.5, C.gold);
card(s2, M, 4.85, W - 2 * M, 1.85, C.panel, "3A5F8C");
s2.addText("THE SCHEDULING GIFT", { x: M + 0.28, y: 5.05, w: 6, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.blue, charSpacing: 2, margin: 0 });
s2.addText([
  { text: "Sunday football in America is ", options: { color: C.ink } },
  { text: "Monday daytime in Australia", options: { color: C.accent, bold: true } },
  { text: ". The biggest day in the sport lands in the middle of the Australian working week, every week, for five months a year — and nobody is programming for it. That is not a quirk of the clock. That is an unclaimed audience with a standing appointment.", options: { color: C.ink } },
], { x: M + 0.28, y: 5.45, w: W - 2 * M - 0.56, h: 1.1, fontFace: BODY, fontSize: 14, margin: 0, valign: "top", lineSpacingMultiple: 1.08 });
foot(s2, "Running it Back · an iHeart America × iHeart Australia co-production");

/* ================= 3. THE SHOW ================= */
const s3 = slide();
eyebrow(s3, "THE SHOW");
title(s3, "Running it Back.", 44, 7.4);
sub(s3, "Weekly through the NFL season. You bring the player's eye — what actually happens out there, what a locker room sounds like in December, who's about to get found out. Cam brings the audience that doesn't know any of it yet and desperately wants to.", 2.0, 7.4);
glow(s3, 8.0, 1.1, 5.6, 5.6, C.deep, 70);
s3.addImage({ path: IMG("gurley.png"), x: 9.15, y: 2.15, w: 3.55, h: 3.44 });
s3.addImage({ path: IMG("rams.png"), x: 8.35, y: 5.15, w: 0.85, h: 0.85, transparency: 20 });
[
  ["FORMAT", "Weekly, in season. Todd in Los Angeles, Cam in Melbourne — recorded remotely, roughly two hours a week."],
  ["THE HOOK", "A player's read on the tape, translated for an audience that has just arrived. One without the other is every other podcast."],
  ["THE NAME", "The run game, the rewatch, and the return. It works for the football, the format, and what comes after."],
].forEach((r, i) => {
  const y = 3.15 + i * 1.28;
  card(s3, M, y, 7.4, 1.12);
  s3.addText(r[0], { x: M + 0.22, y: y + 0.16, w: 1.6, h: 0.3, fontFace: BODY, fontSize: 10, bold: true, color: C.gold, charSpacing: 2, margin: 0 });
  s3.addText(r[1], { x: M + 1.75, y: y + 0.14, w: 5.4, h: 0.85, fontFace: BODY, fontSize: 12.5, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
});
foot(s3, "Running it Back · an iHeart America × iHeart Australia co-production");

/* ================= 4. THE TWO SEASONS ================= */
const s4 = slide();
eyebrow(s4, "THE SHAPE OF IT", C.gold);
title(s4, "Two seasons. One marquee.");
sub(s4, "Weekly through the NFL year, twice — with the biggest week in the sport landing in the middle of it, in your city.", 2.0);
[
  ["SEASON 1", "NFL 2026/27", C.accent, "nfl.png",
   "Weekly through the season. Todd in Los Angeles, Cam in Melbourne — recorded remotely, roughly two hours a week.",
   "Launching into the MCG game, when the whole country is watching football for the first time."],
  ["THE MARQUEE", "SUPER BOWL LXI", C.gold, "rams.png",
   "SoFi Stadium, Los Angeles — February 2027. Four shows on the ground across the week, both hosts in attendance.",
   "★ The biggest week in the sport, in Todd's own city, with the show already a season old."],
  ["SEASON 2", "NFL 2027/28", C.blue, "nfl.png",
   "Weekly again, into an audience with a full year of habit behind it and a commercial story that has matured.",
   "A second Super Bowl run to close it out — and a show with real momentum behind it."],
].forEach((r, i) => {
  const x = x3(i);
  const hero = i === 1;
  card(s4, x, 2.8, col3, 3.4, hero ? C.panel : C.card, hero ? "8C2F45" : C.line);
  s4.addShape(p.ShapeType.rect, { x, y: 2.8, w: col3, h: hero ? 0.11 : 0.075, fill: { color: r[2] }, line: { width: 0 } });
  s4.addText(r[0], { x: x + 0.2, y: 3.04, w: col3 - 0.4, h: 0.28, fontFace: BODY, fontSize: 10, bold: true, color: C.muted, charSpacing: 2.5, margin: 0 });
  s4.addText(r[1], { x: x + 0.2, y: 3.34, w: col3 - 1.0, h: 0.5, fontFace: DISP, fontSize: hero ? 26 : 30, bold: true, color: r[2], margin: 0 });
  s4.addImage({ path: IMG(r[3]), x: x + col3 - 0.95, y: 3.3, w: 0.7, h: 0.7, transparency: 35 });
  s4.addText(r[4], { x: x + 0.2, y: 3.95, w: col3 - 0.4, h: 1.0, fontFace: BODY, fontSize: 12, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
  s4.addText(r[5], { x: x + 0.2, y: 5.05, w: col3 - 0.4, h: 1.0, fontFace: BODY, fontSize: 11.5, bold: true, color: hero ? C.gold : C.ink, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
});
s4.addText("Two full seasons, and the Super Bowl comes to you.",
  { x: M, y: 6.42, w: W - 2 * M, h: 0.4, fontFace: DISP, fontSize: 22, bold: true, color: C.gold, margin: 0 });
foot(s4, "Super Bowl LXI: SoFi Stadium, Los Angeles, 14 February 2027");

/* ================= 5. THE PARTNERSHIP — both faces ================= */
const s5 = slide();
eyebrow(s5, "THE PARTNERSHIP");
title(s5, "One who played it.\nOne who explains it.");
const halfW = (W - 2 * M - 0.24) / 2;
[
  ["gurley-circle.png", "TODD GURLEY", C.accent, "Los Angeles",
   "Three-time All-Pro. Offensive Player of the Year. First-round pick, 2015. A name that opens any door in the league — and a read on the game no Australian broadcaster can manufacture."],
  ["cam-circle.png", "CAM LUKE", C.gold, "Melbourne",
   "Seven years hosting national sports television, plus daily national radio. Knows how to bring a brand-new audience into a sport without patronising the people who already love it."],
].forEach((r, i) => {
  const x = M + i * (halfW + 0.24);
  card(s5, x, 2.3, halfW, 3.55);
  glow(s5, x + 0.42, 2.52, 1.9, 1.9, C.deep, 70);
  s5.addImage({ path: IMG(r[0]), x: x + 0.5, y: 2.6, w: 1.75, h: 1.75 });
  s5.addText(r[1], { x: x + 2.5, y: 2.92, w: halfW - 2.75, h: 0.5, fontFace: DISP, fontSize: 29, bold: true, color: r[2], margin: 0 });
  s5.addText(r[3], { x: x + 2.5, y: 3.46, w: halfW - 2.75, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.muted, charSpacing: 2, margin: 0 });
  s5.addText(r[4], { x: x + 0.32, y: 4.6, w: halfW - 0.64, h: 1.1, fontFace: BODY, fontSize: 12.5, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.08 });
});
card(s5, M, 6.08, W - 2 * M, 0.78, C.panel, "8C2F45");
s5.addText([
  { text: "The audience that's just arrived needs both: ", options: { color: C.ink } },
  { text: "someone who has been in the huddle, and someone who can tell them why it matters.", options: { color: C.accent, bold: true } },
], { x: M + 0.3, y: 6.16, w: W - 2 * M - 0.6, h: 0.62, fontFace: BODY, fontSize: 14, margin: 0, valign: "middle" });
foot(s5, "Running it Back · an iHeart America × iHeart Australia co-production");

/* ================= 6. THE DEAL ================= */
const s6 = slide();
eyebrow(s6, "THE PROPOSAL");
title(s6, "You don't host it. You own it.");
sub(s6, "The structure is deliberate: a guaranteed fee so your time is paid for whatever happens, and equity so that if this becomes something, you own a piece of the something. A floor, and no ceiling.", 1.98);
[
  ["THE FEE", "[$X]", "Per episode, guaranteed. You're paid for every show you turn up to, regardless of how the business is travelling.  [CONFIRM WITH IHEART]"],
  ["THE EQUITY", "[X]%", "Founding stake in the show itself — advertising, sponsorship, the back catalogue, whatever it grows into.  [CONFIRM WITH IHEART]"],
  ["THE BACKING", "iHeart", "iHeart America × iHeart Australia carry production, distribution and commercial across both markets."],
  ["YOUR TIME", "~2 hrs", "A week, in season, remote from LA — plus Super Bowl week, which is on your doorstep anyway."],
].forEach((r, i) => {
  const x = x4(i);
  const hot = i < 2;
  card(s6, x, 2.95, col4, 2.35, hot ? C.panel : C.card, hot ? "8C2F45" : C.line);
  s6.addText(r[0], { x: x + 0.16, y: 3.14, w: col4 - 0.32, h: 0.28, fontFace: BODY, fontSize: 10, bold: true, color: C.gold, charSpacing: 2, margin: 0 });
  s6.addText(r[1], { x: x + 0.16, y: 3.44, w: col4 - 0.32, h: 0.62, fontFace: DISP, fontSize: 34, bold: true, color: hot ? C.accent : C.ink, margin: 0 });
  s6.addText(r[2], { x: x + 0.16, y: 4.12, w: col4 - 0.32, h: 1.1, fontFace: BODY, fontSize: 11, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
});
card(s6, M, 5.5, W - 2 * M, 1.28, C.panel, "3A5F8C");
s6.addText("WHY IT'S BUILT THIS WAY", { x: M + 0.28, y: 5.68, w: 6, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.blue, charSpacing: 2, margin: 0 });
s6.addText([
  { text: "We want you to make as much out of this as it can possibly make. ", options: { color: C.accent, bold: true } },
  { text: "That isn't generosity, it's alignment — a show grows fastest when the person whose name is on it has every reason to grow it. McAfee, the Kelces: every one of those started as a small show with a big name attached, and the people who took ownership early are the ones who did well out of it.", options: { color: C.ink } },
], { x: M + 0.28, y: 6.02, w: W - 2 * M - 0.56, h: 0.7, fontFace: BODY, fontSize: 12.5, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
foot(s6, "Figures in [brackets] to be confirmed with iHeart before issue · indicative structure only");

/* ================= 7. THE PLATFORM ================= */
const s7 = slide();
eyebrow(s7, "ALREADY BUILT", C.go);
title(s7, "It launches onto a platform\nthat already works.", 38);
sub(s7, "Not a deck — a live product. Every NFL game in Australian time, all 32 teams, every player, news aggregated from a dozen mastheads, and the measurement layer that shows partners exactly what the audience did.", 2.0, 11.6);
try {
  s7.addImage({ path: "assets/landing.png", x: M, y: 2.9, w: 6.05, h: 3.79 });
  s7.addImage({ path: "assets/hub.png", x: M + 6.35, y: 2.9, w: 6.05, h: 3.79 });
} catch (e) { /* screenshots optional */ }
foot(s7, "armchair-nfl.vercel.app — live now · AFL, NFL and NBL on one platform");

/* ================= 8. THE ASK ================= */
const s8 = slide();
glow(s8, 7.6, 0.6, 7.2, 7.2, C.deep, 68);
s8.addImage({ path: IMG("gurley.png"), x: 8.85, y: 2.25, w: 4.0, h: 3.87 });
eyebrow(s8, "THE ASK");
title(s8, "Tell us the shape\nis right.", 46, 8.0);
s8.addText("If it is, iHeart puts real numbers against the fee and the equity this week, and we paper it properly. Nothing else needs deciding today.",
  { x: M, y: 2.2, w: 7.8, h: 0.9, fontFace: BODY, fontSize: 14.5, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.1 });
[
  ["1", "Agree the shape", "Two NFL seasons, weekly, plus Super Bowl week. Fee and equity."],
  ["2", "iHeart put numbers to it", "America and Australia meet this week to confirm the structure."],
  ["3", "Announce into the season", "Launch with the NFL year in front of us and the Super Bowl ahead."],
].forEach((r, i) => {
  const y = 3.25 + i * 1.05;
  card(s8, M, y, 7.8, 0.92);
  s8.addShape(p.ShapeType.ellipse, { x: M + 0.22, y: y + 0.24, w: 0.44, h: 0.44, fill: { color: C.accent }, line: { width: 0 } });
  s8.addText(r[0], { x: M + 0.22, y: y + 0.28, w: 0.44, h: 0.36, align: "center", fontFace: DISP, fontSize: 18, bold: true, color: "FFFFFF", margin: 0 });
  s8.addText(r[1], { x: M + 0.82, y: y + 0.14, w: 3.0, h: 0.36, fontFace: DISP, fontSize: 20, bold: true, color: C.ink, margin: 0 });
  s8.addText(r[2], { x: M + 0.82, y: y + 0.48, w: 6.7, h: 0.36, fontFace: BODY, fontSize: 11.5, color: C.ink2, margin: 0, valign: "top" });
});
card(s8, M, 6.42, 7.8, 0.72, C.panel, "8C2F45");
s8.addText([
  { text: "A market with no incumbent, a Super Bowl in your city, and a two-year run to build it. ", options: { color: C.accent, bold: true } },
  { text: "We'd rather build it with you than around you.", options: { color: C.ink } },
], { x: M + 0.28, y: 6.5, w: 7.24, h: 0.58, fontFace: BODY, fontSize: 12.5, margin: 0, valign: "middle", lineSpacingMultiple: 1.06 });
foot(s8, "Cam Luke · Armchair Experts · [email] · [phone] — armchair-nfl.vercel.app");

const OUT = process.argv[2] || "Running-it-Back-Gurley.pptx";
p.writeFile({ fileName: OUT }).then((f) => console.log("wrote", f));
