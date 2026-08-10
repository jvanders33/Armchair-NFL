/* "Running it Back" — the Todd Gurley proposal.
   Rebuild: cd pitch && node gen-gurley.js Running-it-Back-Gurley.pptx
   [BRACKETS] = numbers still to come from Cam / iHeart. */
const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.33, height: 7.5 });
p.layout = "W";

const C = {
  bg: "0F0407", card: "1E0C13", panel: "2A111B", ink: "F9F3F5", ink2: "DCC3CB",
  muted: "A57E8B", line: "43202C", accent: "F5294B", gold: "FFB020", blue: "5AA7FF", go: "43C58C",
};
const DISP = "Arial Narrow", BODY = "Arial";
const M = 0.55, W = 13.33, gap = 0.2;
const col4 = (W - 2 * M - 3 * gap) / 4, x4 = (i) => M + i * (col4 + gap);
const col3 = (W - 2 * M - 2 * gap) / 3, x3 = (i) => M + i * (col3 + gap);

const card = (s, x, y, w, h, fill = C.card, line = C.line) =>
  s.addShape(p.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: line, width: 1 }, rectRadius: 0.09 });
const slide = () => { const s = p.addSlide(); s.background = { color: C.bg }; return s; };
const eyebrow = (s, t, color = C.accent) =>
  s.addText(t, { x: M, y: 0.46, w: 9, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color, charSpacing: 3, margin: 0 });
const title = (s, t, size = 42) =>
  s.addText(t, { x: M - 0.02, y: 0.78, w: 11.8, h: 1.2, fontFace: DISP, fontSize: size, bold: true, color: C.ink, lineSpacingMultiple: 0.95, margin: 0, valign: "top" });
const sub = (s, t, y = 1.95, w = 10.6) =>
  s.addText(t, { x: M, y, w, h: 0.85, fontFace: BODY, fontSize: 14.5, color: C.ink2, lineSpacingMultiple: 1.08, margin: 0, valign: "top" });
const foot = (s, t) =>
  s.addText(t, { x: M, y: 7.0, w: W - 2 * M, h: 0.34, fontFace: BODY, fontSize: 9, color: C.muted, margin: 0, valign: "top" });

function statCard(s, i, big, label, note, y = 3.0, h = 1.5, accent = C.accent) {
  const x = x4(i);
  card(s, x, y, col4, h);
  s.addText([
    { text: big, options: { fontFace: DISP, fontSize: 32, bold: true, color: accent, breakLine: true } },
    { text: label, options: { fontFace: BODY, fontSize: 12, bold: true, color: C.ink, breakLine: true, paraSpaceBefore: 5 } },
    { text: note, options: { fontFace: BODY, fontSize: 9.5, color: C.muted, breakLine: true, paraSpaceBefore: 3 } },
  ], { x: x + 0.16, y: y + 0.14, w: col4 - 0.32, h: h - 0.28, margin: 0, valign: "top", lineSpacingMultiple: 0.98 });
}

/* ---------- 1. COVER ---------- */
const s1 = slide();
s1.addShape(p.ShapeType.roundRect, { x: 0.9, y: 1.35, w: 6.7, h: 3.35, fill: { color: "1A0810" }, line: { color: C.accent, width: 2.5 }, rectRadius: 0.06 });
s1.addText("A PROPOSAL FOR TODD GURLEY", { x: 1.25, y: 1.7, w: 6, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: C.gold, charSpacing: 3.5, margin: 0 });
s1.addText("RUNNING\nIT BACK", { x: 1.2, y: 2.1, w: 6.2, h: 1.9, fontFace: DISP, fontSize: 76, bold: true, color: C.ink, lineSpacingMultiple: 0.86, margin: 0, valign: "top" });
s1.addText("Two NFL seasons. One Olympic Games. Both in your city.", { x: 1.25, y: 4.02, w: 6.2, h: 0.4, fontFace: BODY, fontSize: 14, bold: true, color: C.gold, margin: 0 });
s1.addText([
  { text: "Todd Gurley", options: { color: C.accent, bold: true } },
  { text: "  ·  Cam Luke", options: { color: C.ink2 } },
], { x: 0.95, y: 4.95, w: 7, h: 0.4, fontFace: DISP, fontSize: 26, margin: 0 });
s1.addText("An iHeart America × iHeart Australia co-production — with founding equity for Todd.",
  { x: 0.95, y: 5.45, w: 7.2, h: 0.5, fontFace: BODY, fontSize: 13.5, color: C.ink2, margin: 0, lineSpacingMultiple: 1.1 });

card(s1, 8.4, 1.35, 4.0, 4.85, C.panel, "3A5F8C");
s1.addText("THE ARC", { x: 8.65, y: 1.6, w: 3.5, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.blue, charSpacing: 2, margin: 0 });
[
  ["2026/27", "NFL, weekly.\nFour shows from Super Bowl LXI — SoFi, Los Angeles."],
  ["2027/28", "NFL, weekly.\nA second season, an audience that's compounding."],
  ["LA 2028", "The Olympics, daily.\nBoth of us in LA. A guest every show."],
].forEach((r, i) => {
  const y = 2.1 + i * 1.36;
  s1.addText(r[0], { x: 8.65, y, w: 3.5, h: 0.3, fontFace: DISP, fontSize: 21, bold: true, color: C.accent, margin: 0 });
  s1.addText(r[1], { x: 8.65, y: y + 0.35, w: 3.5, h: 0.9, fontFace: BODY, fontSize: 11.5, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
});
foot(s1, "Confidential proposal · prepared for Todd Gurley · August 2026");

/* ---------- 2. THE OPPORTUNITY ---------- */
const s2 = slide();
eyebrow(s2, "THE OPPORTUNITY");
title(s2, "The most under-served football\nmarket in the world.");
sub(s2, "On 11 September the NFL plays its first ever game in Australia — 100,000 people at the Melbourne Cricket Ground, five weeks from now. A national audience is about to arrive overnight, and there is no established local show waiting to receive it. In America that window closed a decade ago. Here it is wide open, and it needs one credible voice.", 2.15);
statCard(s2, 0, "100k", "At the MCG", "11 Sep — the NFL's first game on Australian soil");
statCard(s2, 1, "#1", "Growth market", "A priority international market for the league");
statCard(s2, 2, "0", "Incumbent voice", "No established Australian NFL show owns this space");
statCard(s2, 3, "3 yrs", "The run", "Two NFL seasons and an Olympic Games", 3.0, 1.5, C.gold);
card(s2, M, 4.85, W - 2 * M, 1.85, C.panel, "3A5F8C");
s2.addText("THE SCHEDULING GIFT", { x: M + 0.28, y: 5.05, w: 6, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.blue, charSpacing: 2, margin: 0 });
s2.addText([
  { text: "Sunday football in America is ", options: { color: C.ink } },
  { text: "Monday daytime in Australia", options: { color: C.accent, bold: true } },
  { text: ". The biggest day in the sport lands in the middle of the Australian working week, every week, for five months a year — and nobody is programming for it. That is not a quirk of the clock. That is an unclaimed audience with a standing appointment.", options: { color: C.ink } },
], { x: M + 0.28, y: 5.45, w: W - 2 * M - 0.56, h: 1.1, fontFace: BODY, fontSize: 14, margin: 0, valign: "top", lineSpacingMultiple: 1.08 });
foot(s2, "Running it Back · an iHeart America × iHeart Australia co-production");

/* ---------- 3. THE THREE SEASONS ---------- */
const s3 = slide();
eyebrow(s3, "THE SHAPE OF IT", C.gold);
title(s3, "Three seasons. One finish line.");
sub(s3, "Not a podcast that runs until it stops — a series with a destination, and the destination is your city.", 2.05);
[
  ["SEASON 1", "NFL 2026/27", C.accent,
   "Weekly through the season. Todd in Los Angeles, Cam in Melbourne — remote, roughly two hours a week.",
   "★ Four shows on the ground at Super Bowl LXI — SoFi Stadium, LA, February 2027. Both hosts in attendance."],
  ["SEASON 2", "NFL 2027/28", C.gold,
   "Weekly again, into an audience with a full year of habit behind it and a commercial story that has matured.",
   "★ A second Super Bowl run to close the season out."],
  ["SEASON 3", "LA 2028", C.blue,
   "The Olympics come to Los Angeles. The show goes daily for the Games — both hosts on the ground.",
   "★ A minimum of one guest every episode. Athletes, medallists, the rooms only Todd can open."],
].forEach((r, i) => {
  const x = x3(i);
  card(s3, x, 2.85, col3, 3.35);
  s3.addText(r[0], { x: x + 0.2, y: 3.05, w: col3 - 0.4, h: 0.28, fontFace: BODY, fontSize: 10, bold: true, color: C.muted, charSpacing: 2.5, margin: 0 });
  s3.addText(r[1], { x: x + 0.2, y: 3.36, w: col3 - 0.4, h: 0.5, fontFace: DISP, fontSize: 30, bold: true, color: r[2], margin: 0 });
  s3.addText(r[3], { x: x + 0.2, y: 3.95, w: col3 - 0.4, h: 1.15, fontFace: BODY, fontSize: 12, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
  s3.addText(r[4], { x: x + 0.2, y: 5.15, w: col3 - 0.4, h: 0.9, fontFace: BODY, fontSize: 11.5, bold: true, color: C.ink, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
});
s3.addText("Football takes it to Los Angeles. The Olympics keep it there.",
  { x: M, y: 6.4, w: W - 2 * M, h: 0.4, fontFace: BODY, fontSize: 14.5, color: C.ink, margin: 0, italic: true });
foot(s3, "Super Bowl LXI: SoFi Stadium, Los Angeles, 14 February 2027 · LA28 Olympic Games: July–August 2028");

/* ---------- 4. THE DEAL ---------- */
const s4 = slide();
eyebrow(s4, "THE PROPOSAL");
title(s4, "You don't host it. You own it.");
sub(s4, "The structure is deliberate: a guaranteed fee so your time is paid for whatever happens, and equity so that if this becomes something, you own a piece of the something. A floor and no ceiling.", 2.0);
[
  ["THE FEE", "[$X]", "Per episode, guaranteed. You're paid for every show you turn up to, regardless of how the business is travelling. [CONFIRM WITH IHEART]"],
  ["THE EQUITY", "[X]%", "Founding stake in the show itself — advertising, sponsorship, the back catalogue, whatever it grows into. [CONFIRM WITH IHEART]"],
  ["THE BACKING", "iHeart", "iHeart America × iHeart Australia carry production, distribution and commercial across both markets."],
  ["YOUR TIME", "~2 hrs", "A week, in season, remote from LA — plus Super Bowl week and the Games, where you're there anyway."],
].forEach((r, i) => {
  const x = x4(i);
  const hot = i < 2;
  card(s4, x, 3.0, col4, 2.3, hot ? C.panel : C.card, hot ? "8C2F45" : C.line);
  s4.addText(r[0], { x: x + 0.16, y: 3.2, w: col4 - 0.32, h: 0.28, fontFace: BODY, fontSize: 10, bold: true, color: C.gold, charSpacing: 2, margin: 0 });
  s4.addText(r[1], { x: x + 0.16, y: 3.5, w: col4 - 0.32, h: 0.62, fontFace: DISP, fontSize: 34, bold: true, color: hot ? C.accent : C.ink, margin: 0 });
  s4.addText(r[2], { x: x + 0.16, y: 4.18, w: col4 - 0.32, h: 1.05, fontFace: BODY, fontSize: 11, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
});
card(s4, M, 5.5, W - 2 * M, 1.25, C.panel, "3A5F8C");
s4.addText("WHY IT'S BUILT THIS WAY", { x: M + 0.28, y: 5.68, w: 6, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: C.blue, charSpacing: 2, margin: 0 });
s4.addText([
  { text: "We want you to make as much out of this as it can possibly make. ", options: { color: C.accent, bold: true } },
  { text: "That isn't generosity, it's alignment — the show grows fastest when the person whose name is on it has every reason to grow it. McAfee, the Kelces: every one of those started as a small show with a big name attached, and the people who took ownership early are the ones who did well out of it.", options: { color: C.ink } },
], { x: M + 0.28, y: 6.02, w: W - 2 * M - 0.56, h: 0.68, fontFace: BODY, fontSize: 13, margin: 0, valign: "top", lineSpacingMultiple: 1.06 });
foot(s4, "Figures in [brackets] to be confirmed with iHeart before issue · indicative structure only");

/* ---------- 5. THE HOSTS ---------- */
const s5 = slide();
eyebrow(s5, "THE PARTNERSHIP");
title(s5, "One who played it.\nOne who explains it.");
[
  ["TODD GURLEY", C.accent,
   "Three-time All-Pro. Offensive Player of the Year. A name that opens any door in the league and a perspective no Australian broadcaster can manufacture — what the game actually feels like from inside it. Based in Los Angeles: the Super Bowl city in 2027 and the Olympic city in 2028."],
  ["CAM LUKE", C.gold,
   "Seven years hosting national sports television in Australia, plus daily national radio. Knows exactly how to bring a new audience into a sport without patronising the people who already love it — and brings a built audience and platform to launch into."],
].forEach((r, i) => {
  const x = M + i * ((W - 2 * M) / 2 + 0.12);
  const w = (W - 2 * M) / 2 - 0.12;
  card(s5, x, 2.75, w, 2.5);
  s5.addText(r[0], { x: x + 0.24, y: 2.98, w: w - 0.48, h: 0.5, fontFace: DISP, fontSize: 30, bold: true, color: r[1], margin: 0 });
  s5.addText(r[2], { x: x + 0.24, y: 3.55, w: w - 0.48, h: 1.6, fontFace: BODY, fontSize: 12.5, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.07 });
});
card(s5, M, 5.45, W - 2 * M, 1.3, C.panel, "8C2F45");
s5.addText([
  { text: "The audience that's just arrived needs both: ", options: { color: C.ink } },
  { text: "someone who has been in the huddle, and someone who can tell them why it matters.", options: { color: C.accent, bold: true } },
  { text: " One without the other is every other podcast.", options: { color: C.ink } },
], { x: M + 0.3, y: 5.72, w: W - 2 * M - 0.6, h: 0.8, fontFace: BODY, fontSize: 15, margin: 0, valign: "middle", lineSpacingMultiple: 1.08 });
foot(s5, "Running it Back · an iHeart America × iHeart Australia co-production");

/* ---------- 6. THE PLATFORM ---------- */
const s6 = slide();
eyebrow(s6, "ALREADY BUILT", C.go);
title(s6, "The show launches onto\na working platform.");
sub(s6, "Not a deck — a live product. Every NFL game in Australian time, all 32 teams, every player, the news aggregated from a dozen mastheads, and the measurement layer that shows partners exactly what the audience did.", 2.05, 11.4);
try {
  s6.addImage({ path: "assets/landing.png", x: M, y: 2.95, w: 6.05, h: 3.79 });
  s6.addImage({ path: "assets/hub.png", x: M + 6.35, y: 2.95, w: 6.05, h: 3.79 });
} catch (e) { /* screenshots optional */ }
foot(s6, "armchair-nfl.vercel.app — live now · AFL, NFL and NBL on one platform");

/* ---------- 7. THE ASK ---------- */
const s7 = slide();
eyebrow(s7, "THE ASK");
title(s7, "Tell us the shape is right.", 46);
s7.addText("If it is, iHeart puts real numbers against the fee and the equity this week, and we paper it properly. Nothing else needs deciding today.",
  { x: M, y: 2.05, w: 9.2, h: 0.9, fontFace: BODY, fontSize: 15.5, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.1 });
[
  ["1", "Agree the shape", "Three seasons, weekly NFL, daily for the Games. Fee plus equity."],
  ["2", "iHeart put numbers to it", "America and Australia meet this week to confirm the structure."],
  ["3", "Announce into the season", "Launch with the NFL year in front of us and the LA run ahead."],
].forEach((r, i) => {
  const x = x3(i);
  card(s7, x, 3.3, col3, 1.95);
  s7.addShape(p.ShapeType.ellipse, { x: x + 0.2, y: 3.5, w: 0.42, h: 0.42, fill: { color: C.accent } });
  s7.addText(r[0], { x: x + 0.2, y: 3.53, w: 0.42, h: 0.36, align: "center", fontFace: DISP, fontSize: 17, bold: true, color: "FFFFFF", margin: 0 });
  s7.addText(r[1], { x: x + 0.72, y: 3.52, w: col3 - 0.92, h: 0.4, fontFace: DISP, fontSize: 20, bold: true, color: C.ink, margin: 0 });
  s7.addText(r[2], { x: x + 0.2, y: 4.12, w: col3 - 0.4, h: 0.95, fontFace: BODY, fontSize: 12, color: C.ink2, margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
});
card(s7, M, 5.55, W - 2 * M, 1.2, C.panel, "8C2F45");
s7.addText([
  { text: "A market with no incumbent, a Super Bowl in your city, and a home Olympics to finish on. ", options: { color: C.accent, bold: true } },
  { text: "We'd rather build it with you than around you.", options: { color: C.ink } },
], { x: M + 0.3, y: 5.78, w: W - 2 * M - 0.6, h: 0.75, fontFace: BODY, fontSize: 16, margin: 0, valign: "middle", lineSpacingMultiple: 1.08 });
foot(s7, "Cam Luke · Armchair Experts · [email] · [phone] — armchair-nfl.vercel.app");

const OUT = process.argv[2] || "Running-it-Back-Gurley.pptx";
p.writeFile({ fileName: OUT }).then((f) => console.log("wrote", f));
