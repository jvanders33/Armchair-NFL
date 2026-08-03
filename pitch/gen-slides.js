const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.33, height: 7.5 });
p.layout = "W";

const C = {
  bg:"0A111E", card:"132339", panel:"16273F", ink:"F3F6FB", ink2:"B7C4D8",
  muted:"7E8FA8", line:"26374F", accent:"FFB020", accentInk:"0A111E", disney:"5AA7FF", go:"46C58C"
};
const DISP = "Arial Narrow", BODY = "Arial";
const M = 0.5, W = 13.33, gap = 0.18;
const cardW = (W - 2*M - 3*gap) / 4;              // 4-up cards
const colX = i => M + i*(cardW+gap);
const L = { x:M, w:7.15 }, R = { x:M+7.15+0.3, w:W-2*M-7.15-0.3 };  // 2-col split

function card(s, x, y, w, h, fill=C.card, line=C.line){
  s.addShape(p.ShapeType.roundRect, { x,y,w,h, fill:{color:fill}, line:{color:line,width:1}, rectRadius:0.09 });
}
function brand(s){
  s.addText([
    {text:"Armchair", options:{color:C.ink}},
    {text:"·", options:{color:C.accent}},
    {text:"Experts", options:{color:C.ink}},
  ], { x:W-4-0.5, y:0.42, w:4, h:0.3, align:"right", fontFace:DISP, fontSize:14, bold:true, margin:0 });
  s.addText([
    {text:"STREAMING PARTNER · ", options:{color:C.muted}},
    {text:"Disney+", options:{color:C.disney, bold:true}},
  ], { x:W-4-0.5, y:0.74, w:4, h:0.25, align:"right", fontFace:BODY, fontSize:9.5, charSpacing:1, margin:0 });
}
function header(s, eyebrow, titleLines, sub){
  s.addText(eyebrow, { x:M, y:0.5, w:8, h:0.3, fontFace:BODY, fontSize:11, bold:true, color:C.accent, charSpacing:3, margin:0 });
  s.addText(titleLines, { x:M-0.02, y:0.82, w:9.2, h:1.25, fontFace:DISP, fontSize:41, bold:true, color:C.ink,
    lineSpacingMultiple:0.95, margin:0, valign:"top" });
  s.addText(sub, { x:M, y:2.12, w:8.4, h:0.7, fontFace:BODY, fontSize:14, color:C.ink2, lineSpacingMultiple:1.05, margin:0, valign:"top" });
}
function footer(s, txt){
  s.addText(txt, { x:M, y:7.02, w:W-2*M, h:0.35, fontFace:BODY, fontSize:9.5, color:C.muted, margin:0, valign:"top" });
}

/* ---------------- SLIDE A ---------------- */
const a = p.addSlide();
a.background = { color:C.bg };
brand(a);
header(a, "THE AUDIENCE",
  [{text:"Who Disney+ is really buying", options:{}}],
  "Not impressions — a pre-qualified pool of streaming-ready NFL fans, indexed exactly where the league wants Australian growth.");

const stats = [
  ["000k","Monthly audience","Across audio, video & social"],
  ["00%","Watch-through","Avg completion on the video show"],
  ["00%","Men 18–34","The NFL's core AU growth demo"],
  ["000k","Social reach / mo","Instagram + TikTok combined"],
];
const stY = 2.95, stH = 1.55;
stats.forEach((s0,i)=>{
  const x = colX(i);
  card(a, x, stY, cardW, stH);
  a.addText([
    {text:s0[0], options:{fontFace:DISP, fontSize:34, bold:true, color:C.accent, breakLine:true}},
    {text:s0[1], options:{fontFace:BODY, fontSize:12.5, bold:true, color:C.ink, breakLine:true, paraSpaceBefore:6}},
    {text:s0[2], options:{fontFace:BODY, fontSize:9.5, color:C.muted, breakLine:true, paraSpaceBefore:3}},
  ], { x:x+0.16, y:stY+0.14, w:cardW-0.32, h:stH-0.28, margin:0, valign:"top", lineSpacingMultiple:0.98 });
});

const spY = 4.72, spH = 2.12;
// who (left)
card(a, L.x, spY, L.w, spH);
a.addText("WHO THEY ARE", { x:L.x+0.22, y:spY+0.18, w:L.w-0.44, h:0.3, fontFace:BODY, fontSize:12, bold:true, color:C.ink2, charSpacing:2, margin:0 });
a.addText([
  {text:"Already NFL-curious but under-served — no trusted Australian voice, no clear place to watch.", options:{bullet:{code:"25B8"}, color:C.ink, breakLine:true, paraSpaceAfter:7}},
  {text:"Streaming-native: they subscribe readily and follow talent across platforms.", options:{bullet:{code:"25B8"}, color:C.ink, breakLine:true, paraSpaceAfter:7}},
  {text:"Concentrated in the metro markets and the exact demo Disney+ and the NFL both want.", options:{bullet:{code:"25B8"}, color:C.ink, breakLine:true}},
], { x:L.x+0.22, y:spY+0.56, w:L.w-0.44, h:spH-0.72, fontFace:BODY, fontSize:12.5, color:C.ink, margin:0, valign:"top", lineSpacingMultiple:1.02 });
// why (right)
card(a, R.x, spY, R.w, spH, C.panel, "2E5B8C");
a.addText("WHY IT MATTERS TO DISNEY+", { x:R.x+0.22, y:spY+0.2, w:R.w-0.44, h:0.3, fontFace:BODY, fontSize:10.5, bold:true, color:C.disney, charSpacing:1.5, margin:0 });
a.addText([
  {text:"Every other slide is inventory. This is the ", options:{color:C.ink}},
  {text:"reason to buy it", options:{color:C.accent, bold:true}},
  {text:" — audited reach, engaged completion, and fit.", options:{color:C.ink}},
], { x:R.x+0.22, y:spY+0.66, w:R.w-0.44, h:spH-0.9, fontFace:BODY, fontSize:15, margin:0, valign:"top", lineSpacingMultiple:1.08 });

footer(a, "Draft — replace bracketed figures with Armchair's actuals (downloads, watch-time, audience survey, socials). Concept for pitch purposes; not affiliated with the NFL, ESPN or Disney+.");

/* ---------------- SLIDE B ---------------- */
const b = p.addSlide();
b.background = { color:C.bg };
brand(b);
header(b, "THE PROOF",
  [{text:"How we prove it drove subscriptions", options:{}}],
  "Turning “awareness” into a number Disney+ can bank — one tracked path from a mention to a sign-up.");

const steps = [
  ["01","Awareness","Show, social & the iHeart network put the NFL story in front of fans.","Reach & impressions"],
  ["02","Intent","A unique tracked deep-link & on-air promo code in every episode.","Click-through rate"],
  ["03","Conversion","A co-branded, code-gated giveaway page captures the referral.","Attributed sign-ups"],
  ["04","Prove it","A shared dashboard reconciles spend against sign-ups fortnightly.","Cost per acquisition"],
];
const fY = 2.95, fH = 2.02;
steps.forEach((st,i)=>{
  const x = colX(i);
  card(b, x, fY, cardW, fH);
  b.addText([
    {text:st[0], options:{fontFace:DISP, fontSize:16, bold:true, color:C.accent, breakLine:true, charSpacing:2}},
    {text:st[1], options:{fontFace:DISP, fontSize:16, bold:true, color:C.ink, breakLine:true, paraSpaceBefore:3, charSpacing:0.5}},
    {text:st[2], options:{fontFace:BODY, fontSize:9.5, color:C.ink2, breakLine:true, paraSpaceBefore:6}},
  ], { x:x+0.16, y:fY+0.14, w:cardW-0.32, h:1.28, margin:0, valign:"top", lineSpacingMultiple:1.0 });
  b.addText([
    {text:"MEASURED BY", options:{fontFace:BODY, fontSize:8, color:C.muted, charSpacing:1.5, breakLine:true}},
    {text:st[3], options:{fontFace:BODY, fontSize:11.5, bold:true, color:C.go, breakLine:true, paraSpaceBefore:2}},
  ], { x:x+0.16, y:fY+fH-0.62, w:cardW-0.32, h:0.5, margin:0, valign:"top" });
  if(i<3) b.addText("›", { x:x+cardW-0.02, y:fY+fH/2-0.28, w:gap+0.04, h:0.5, align:"center", fontFace:BODY, fontSize:20, bold:true, color:C.muted, margin:0 });
});

const wY = 5.12, wH = 1.72;
card(b, L.x, wY, L.w, wH);
b.addText("HOW IT'S WIRED", { x:L.x+0.22, y:wY+0.16, w:L.w-0.44, h:0.3, fontFace:BODY, fontSize:12, bold:true, color:C.ink2, charSpacing:2, margin:0 });
b.addText([
  {text:"A unique UTM deep-link & Disney+ promo code per episode — credit is unambiguous.", options:{bullet:{type:"number"}, color:C.ink, breakLine:true, paraSpaceAfter:6}},
  {text:"A giveaway landing page that gates entry behind the sign-up path.", options:{bullet:{type:"number"}, color:C.ink, breakLine:true, paraSpaceAfter:6}},
  {text:"A fortnightly report to Disney+ — reach, clicks, sign-ups, CPA. Nothing behind the curtain.", options:{bullet:{type:"number"}, color:C.ink, breakLine:true}},
], { x:L.x+0.22, y:wY+0.52, w:L.w-0.44, h:wH-0.66, fontFace:BODY, fontSize:12, color:C.ink, margin:0, valign:"top", lineSpacingMultiple:1.02 });

card(b, R.x, wY, R.w, wH, C.panel, "2E5B8C");
b.addText("THE UNLOCK", { x:R.x+0.22, y:wY+0.18, w:R.w-0.44, h:0.3, fontFace:BODY, fontSize:10.5, bold:true, color:C.disney, charSpacing:1.5, margin:0 });
b.addText([
  {text:"Every ", options:{color:C.ink}},
  {text:"“Watch on Disney+”", options:{color:C.accent, bold:true}},
  {text:" tap in the weekly hub is one of these tracked links. The product and the measurement are the same system.", options:{color:C.ink}},
], { x:R.x+0.22, y:wY+0.58, w:R.w-0.44, h:wH-0.72, fontFace:BODY, fontSize:13.5, margin:0, valign:"top", lineSpacingMultiple:1.06 });

footer(b, "Draft. Palette & type match the “What to Watch” hub prototype so the pitch reads as one platform. Concept for pitch purposes; not affiliated with the NFL, ESPN or Disney+.");

const OUT = process.argv[2] || "Armchair-Disney-two-slides.pptx";
p.writeFile({ fileName: OUT }).then(f => console.log("wrote", f));
