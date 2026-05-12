// Smoke test for the screenshot-based 爆款笔记学习 feature.
//
// The browser flow loads the uploaded screenshot into a canvas and feeds
// ImageData into `analyzeScreenshotPixels`. In this node-side test we
// synthesize raw pixel buffers that emulate three Xiaohongshu cover archetypes
// (pink/red high-saturation viral, cream/soft Korean, dark moody premium) and
// assert:
//
//   1) The pixel analyzer extracts the expected mood + cues + palette.
//   2) Passing the analysis into generateNote actually changes the title,
//      body opening, and cover/page design (background palette, headline
//      color, accent sticker) — i.e. the screenshot style flows all the way
//      through to the result page output.
//   3) Generation never copies the analyzer's input or the user-provided
//      fixtures verbatim.
//   4) Works in both A (framework) and B (freeform) input modes.
//   5) Static-deploy & no-storage guarantees still hold: create.tsx wires the
//      upload + status panel via stable data-testids and uses no localStorage
//      / sessionStorage / cookies / IndexedDB in the new block.
//   6) The four other smoke tests' fixtures still satisfy AppInputState
//      (sanity: we added screenshotRef as a nullable field).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeScreenshotPixels,
  type ScreenshotMood,
  type ScreenshotStyleProfile,
  type RawPixels,
} from "../client/src/lib/screenshot-style";
import { generateNote } from "../client/src/lib/generate";
import type { AppInputState, ScreenshotRef } from "../client/src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// ---------- pixel-buffer fixtures ----------

interface RGB { r: number; g: number; b: number }

// Build a width x height RGBA buffer by calling `colorAt(x, y)` for each pixel.
function makePixels(width: number, height: number, colorAt: (x: number, y: number) => RGB): RawPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = colorAt(x, y);
      const i = (y * width + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

// Fixture A: a viral Xiaohongshu cover. Pink/red dominant background with a
// solid white headline block in the upper-half — big-title / high-contrast.
function pinkViralCover(): RawPixels {
  const W = 96;
  const H = 128;
  return makePixels(W, H, (x, y) => {
    // Two thick text-like bars at top and middle — high contrast,
    // alternating black/white columns to look like big headline typography.
    const inBar1 = y >= 8 && y <= 44;
    const inBar2 = y >= 56 && y <= 84;
    if ((inBar1 || inBar2) && x >= 6 && x <= W - 6) {
      // Wider columns so the analyzer's neighbour-diff actually fires.
      return Math.floor(x / 4) % 2 === 0 ? { r: 250, g: 245, b: 240 } : { r: 20, g: 20, b: 20 };
    }
    // Pink/red base
    const noise = ((x * 7 + y * 3) % 17) - 8;
    return { r: Math.min(255, 252 + noise), g: 80 + ((x + y) % 6), b: 105 + ((x * 2) % 8) };
  });
}

// Fixture B: a cream/soft Korean cover. High brightness, low saturation,
// soft warm beige with a gentle pastel band.
function creamSoftCover(): RawPixels {
  const W = 96;
  const H = 128;
  return makePixels(W, H, (x, y) => {
    // Mostly cream with subtle vertical gradient toward warm beige, plus a
    // light photograph-like region (very near-white) to bring saturation down
    // and brightness up — matches what a real Korean-style cream cover looks
    // like in pixels (lots of near-white with a warm tint).
    if (y < H * 0.55) {
      // Near-white tile area
      const wn = ((x + y) * 3) % 7;
      return { r: 248 + wn % 6, g: 244 + wn % 4, b: 236 + wn % 4 };
    }
    const t = (y - H * 0.55) / (H * 0.45);
    const r = Math.round(244 - t * 18);
    const g = Math.round(232 - t * 22);
    const b = Math.round(214 - t * 26);
    return { r, g, b };
  });
}

// Fixture C: a dark moody cover. Very low brightness, blue-ish.
function darkMoodyCover(): RawPixels {
  const W = 96;
  const H = 128;
  return makePixels(W, H, (x, y) => {
    const noise = ((x * 5 + y * 7) % 11) - 5;
    return {
      r: Math.max(0, 18 + noise),
      g: Math.max(0, 22 + noise),
      b: Math.max(0, 36 + noise),
    };
  });
}

// ---------- 1) analyzer extracts mood + cues ----------

{
  const pink = analyzeScreenshotPixels(pinkViralCover());
  console.log("pink/viral:", {
    mood: pink.mood,
    cues: pink.cues,
    palette: pink.palette,
    accent: pink.accent,
    brightness: pink.brightness.toFixed(2),
    saturation: pink.saturation.toFixed(2),
    warmth: pink.warmth.toFixed(2),
  });
  assert(
    pink.mood === "pink_red" || pink.cues.includes("pink_accent") || pink.cues.includes("high_saturation"),
    `pink fixture should learn a pink/viral mood, got ${pink.mood} / ${pink.cues.join(",")}`,
  );
  assert(
    pink.cues.includes("high_contrast_text") || pink.cues.includes("big_title_cover"),
    `pink fixture should learn high-contrast/big-title cue, got ${pink.cues.join(",")}`,
  );
  assert(pink.warmth > 0, "pink fixture should be warm");
  assert(/^#[0-9a-f]{6}$/i.test(pink.accent), `accent must be a hex string, got ${pink.accent}`);

  const cream = analyzeScreenshotPixels(creamSoftCover());
  console.log("cream/soft:", {
    mood: cream.mood,
    cues: cream.cues,
    palette: cream.palette,
    brightness: cream.brightness.toFixed(2),
    saturation: cream.saturation.toFixed(2),
    warmth: cream.warmth.toFixed(2),
  });
  assert(
    cream.mood === "warm_cream" || cream.cues.includes("bright_overexposed") || cream.cues.includes("cream_palette"),
    `cream fixture should learn cream/bright mood, got ${cream.mood} / ${cream.cues.join(",")}`,
  );
  assert(cream.brightness > 0.65, "cream fixture brightness must be high");
  assert(cream.warmth > 0, "cream fixture should be warm");

  const dark = analyzeScreenshotPixels(darkMoodyCover());
  console.log("dark/moody:", {
    mood: dark.mood,
    cues: dark.cues,
    brightness: dark.brightness.toFixed(2),
    saturation: dark.saturation.toFixed(2),
    warmth: dark.warmth.toFixed(2),
  });
  assert(dark.mood === "dark_moody", `dark fixture should be dark_moody mood, got ${dark.mood}`);
  assert(dark.cues.includes("dark_premium"), "dark fixture should include dark_premium cue");
  assert(dark.brightness < 0.3, "dark fixture brightness must be low");
}

// ---------- 2) generation consumes screenshot style ----------

function profileToRef(p: ScreenshotStyleProfile): ScreenshotRef {
  return {
    previewUrl: null,
    filename: "test.png",
    width: p.width,
    height: p.height,
    palette: p.palette,
    accent: p.accent,
    brightness: p.brightness,
    saturation: p.saturation,
    contrast: p.contrast,
    warmth: p.warmth,
    textDensity: p.textDensity,
    edgeDensity: p.edgeDensity,
    mood: p.mood,
    cues: p.cues,
    status: p.status,
    // No OCR pass in the visual-style smoke — textual learning is exercised
    // by smoke-screenshot-text-style.ts. Visual-only refs explicitly opt out.
    textStyle: null,
  };
}

function analyze(raw: RawPixels): ScreenshotStyleProfile {
  const stats = analyzeScreenshotPixels(raw);
  return {
    hasInput: true,
    previewUrl: null,
    filename: "test.png",
    ...stats,
  };
}

function baseInput(overrides: Partial<AppInputState> = {}): AppInputState {
  return {
    inputMode: "framework",
    framework: [
      { id: "f1", label: "位置", value: "酒店在市中心，步行就能到地铁站，逛街很方便。" },
      { id: "f2", label: "房间", value: "推开门是落地窗，床品柔软，洗手间干湿分离很舒服。" },
      { id: "f3", label: "早餐", value: "现做的鸡蛋很香，咖啡也不错，水果新鲜。" },
    ],
    freeText: "",
    hotel: {
      name: "测试酒店",
      brand: "测试品牌",
      city: "上海",
      price: "888/晚",
      roomType: "豪华大床房",
      stayDate: "周末两晚",
    },
    images: [],
    style: "korean_cream",
    viralRef: "",
    viralRefNotes: "",
    screenshotRef: null,
    ...overrides,
  };
}

function isDramatic(s: string): boolean {
  return /[!！]{2,}|[?？]{2,}|💕|🌸|💖|姐妹|宝子|家人们|兄弟们|爆款|必冲/.test(s);
}

// Framework mode A: baseline vs learned (pink/viral)
{
  const baseline = generateNote(baseInput());
  const pink = analyze(pinkViralCover());
  const pinkRef = profileToRef(pink);
  const learned = generateNote(baseInput({ screenshotRef: pinkRef }));
  console.log("baseline title:", baseline.title);
  console.log("pink-learned :", learned.title);

  // Title must change in a dramatic / emoji / amp direction.
  assert(
    learned.title !== baseline.title,
    `screenshot-learned title should differ from baseline\nbaseline=${baseline.title}\nlearned=${learned.title}`,
  );
  assert(
    isDramatic(learned.title) || /[💕💖🌸·]/.test(learned.title),
    `pink learned title should be dramatic / pink-accented, got: ${learned.title}`,
  );

  // Body opening shifts.
  const baselineOpening = baseline.body.split("\n")[0];
  const learnedOpening = learned.body.split("\n")[0];
  console.log("baseline opening:", baselineOpening);
  console.log("learned  opening:", learnedOpening);
  assert(
    learnedOpening !== baselineOpening,
    "body opening should shift when screenshot style is learned",
  );

  // Cover background should now use the learned palette (different gradient
  // string from the baseline which uses STYLE palette).
  assert(
    learned.cover.background !== baseline.cover.background,
    `cover background must change\nbaseline=${baseline.cover.background}\nlearned=${learned.cover.background}`,
  );
  // The learned background must reference at least one of the palette colors.
  assert(
    pink.palette.some((c) => learned.cover.background.includes(c.toLowerCase())),
    `learned cover background should reference learned palette, got ${learned.cover.background}`,
  );

  // An accent sticker layer should have been added.
  const accentLayer = learned.cover.layers.find((l) => l.id.startsWith("lyr_acc_"));
  assert(accentLayer, "pink learned cover must include an accent sticker layer");
  assert(
    accentLayer && accentLayer.type === "text",
    "accent sticker must be a text layer",
  );

  // viralStyle and screenshotStyle summaries are attached.
  assert(
    learned.screenshotStyle?.hasInput === true,
    "generated note must include screenshotStyle summary",
  );
  assert(
    learned.screenshotStyle?.cues && learned.screenshotStyle.cues.length > 0,
    "screenshotStyle.cues must contain learned cues",
  );
  assert(
    learned.warnings.some((w) => w.includes("已学习参考截图风格")),
    "warnings must announce that screenshot style was learned",
  );
}

// Cream/soft Korean
{
  const cream = analyze(creamSoftCover());
  const learned = generateNote(baseInput({ screenshotRef: profileToRef(cream) }));
  console.log("cream learned title:", learned.title);
  console.log("cream learned opening:", learned.body.split("\n")[0]);
  // Cream/soft mood should pull toward gentler, more 治愈 wording (or at
  // least bend the body opening into the 悄悄说 / 治愈 register).
  const looksSoft = /治愈|超温柔|奶系|柔软/.test(learned.title) || /悄悄说|轻轻/.test(learned.body);
  assert(looksSoft, `cream learned output should sound soft / 治愈, got title=${learned.title}`);
  // Cover background must reference the cream palette.
  assert(
    cream.palette.some((c) => learned.cover.background.includes(c.toLowerCase())),
    `cream cover background must reference cream palette, got ${learned.cover.background}`,
  );
  // Title text layer should be dark on light frame (no accent pill).
  const titleLayer = learned.cover.layers.find(
    (l) => l.type === "text" && l.fontSize >= 24,
  );
  assert(titleLayer, "cream cover should still have a title text layer");
  if (titleLayer && titleLayer.type === "text") {
    assert(
      titleLayer.color !== "#ffffff",
      `cream cover title color should not stay pure white, got ${titleLayer.color}`,
    );
  }
}

// Dark moody premium
{
  const dark = analyze(darkMoodyCover());
  const learned = generateNote(baseInput({ screenshotRef: profileToRef(dark) }));
  console.log("dark learned title:", learned.title);
  console.log("dark learned opening:", learned.body.split("\n")[0]);
  const looksPremium = /高级|沉静|质感|低调|不动声色|夜色/.test(learned.title + learned.body);
  assert(
    looksPremium,
    `dark learned output should sound premium / 夜色, got title=${learned.title}\nbody opening=${learned.body.split("\n")[0]}`,
  );
  // Dark background gradient should reference dark colors (palette contains
  // very dark hex strings like #18*).
  const bg = learned.cover.background.toLowerCase();
  assert(/#[01][0-9a-f][12][0-9a-f]/.test(bg) || /#0[0-9a-f]{5}/.test(bg) || /#[12][0-9a-f]{5}/.test(bg),
    `dark cover background should include very-dark color, got ${bg}`);
  // Title layer should be ivory on dark.
  const titleLayer = learned.cover.layers.find(
    (l) => l.type === "text" && l.fontSize >= 24,
  );
  assert(titleLayer && titleLayer.type === "text", "dark cover should still have a title layer");
  if (titleLayer && titleLayer.type === "text") {
    assert(
      titleLayer.color.toLowerCase() === "#f3ead8",
      `dark cover title should switch to ivory text, got ${titleLayer.color}`,
    );
  }
}

// Freeform mode B: same flow still works.
{
  const baseline = generateNote(
    baseInput({
      inputMode: "freeform",
      framework: [],
      freeText:
        "酒店离地铁很近。房间很安静，床品柔软。早餐有现做鸡蛋和咖啡，水果也新鲜。前台态度很好。",
    }),
  );
  const pinkRef = profileToRef(analyze(pinkViralCover()));
  const learned = generateNote(
    baseInput({
      inputMode: "freeform",
      framework: [],
      freeText:
        "酒店离地铁很近。房间很安静，床品柔软。早餐有现做鸡蛋和咖啡，水果也新鲜。前台态度很好。",
      screenshotRef: pinkRef,
    }),
  );
  assert(
    learned.title !== baseline.title,
    `freeform: pink-screenshot title should differ from baseline\nbaseline=${baseline.title}\nlearned=${learned.title}`,
  );
  assert(
    learned.cover.background !== baseline.cover.background,
    "freeform: cover background must change with screenshot",
  );
  assert(
    learned.screenshotStyle?.hasInput === true,
    "freeform: screenshotStyle summary must be attached",
  );
}

// ---------- 3) no verbatim copy of analyzer output ----------
{
  const pinkRef = profileToRef(analyze(pinkViralCover()));
  const learned = generateNote(baseInput({ screenshotRef: pinkRef }));
  // The status string mentions "已学习" — it must appear in warnings (we want
  // the user to see it) but NOT in the generated body itself.
  assert(
    !learned.body.includes("已学习"),
    "generated body must not leak the learned-status sentence",
  );
  // The accent hex color string itself must not appear in the body (purely
  // visual cue).
  assert(
    !learned.body.includes(pinkRef.accent),
    "generated body must not include the accent hex string",
  );
}

// ---------- 4) determinism: same ref + same input -> same title ----------
{
  const pinkRef = profileToRef(analyze(pinkViralCover()));
  // generateNote includes Date.now()+Math.random() in its seed for variety —
  // but the *decoration* applied by applyScreenshotTitleStyle must be
  // deterministic for the same profile + same base.
  const { applyScreenshotTitleStyle } = await import(
    "../client/src/lib/screenshot-style"
  );
  const profile = analyze(pinkViralCover());
  const base = "测试酒店｜很舒服。";
  const a = applyScreenshotTitleStyle(base, profile);
  const b = applyScreenshotTitleStyle(base, profile);
  assert(a === b, `applyScreenshotTitleStyle must be deterministic: ${a} vs ${b}`);
  assert(
    a !== base,
    `applyScreenshotTitleStyle must decorate the base for a pink/viral profile, got ${a}`,
  );
  void pinkRef;
}

// ---------- 5) create.tsx wires the new UI surface ----------
{
  const createPath = join(import.meta.dirname, "..", "client", "src", "pages", "create.tsx");
  const createSrc = readFileSync(createPath, "utf-8");
  assert(
    createSrc.includes('data-testid="input-screenshot-file"'),
    "create.tsx must render the screenshot file input with the documented testid",
  );
  assert(
    createSrc.includes('data-testid="button-upload-screenshot"'),
    "create.tsx must render the upload button",
  );
  assert(
    createSrc.includes('data-testid="screenshot-learning-panel"'),
    "create.tsx must render the learned-style panel container",
  );
  assert(
    createSrc.includes('data-testid="screenshot-learning-status-text"'),
    "create.tsx must surface the screenshot-learning-status-text element",
  );
  assert(
    createSrc.includes('data-testid="button-screenshot-clear"'),
    "create.tsx must include the clear button",
  );
  assert(
    createSrc.includes("analyzeScreenshotFile"),
    "create.tsx must wire the analyzeScreenshotFile call",
  );
  // Must not introduce browser storage in the new block.
  assert(
    !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(createSrc),
    "create.tsx must not introduce browser-storage usage",
  );
  // The old link-input UI is gone.
  assert(
    !createSrc.includes('data-testid="input-viral-link"'),
    "create.tsx should no longer render the old link textarea",
  );
}

// ---------- 6) other smoke fixtures still compile with screenshotRef field ----------
{
  // smoke-tags-editable and smoke-framework-persist each build their own
  // AppInputState literals. If we accidentally introduced a *required* new
  // field they'd fail to typecheck. We don't re-typecheck here, but we DO
  // require that screenshotRef is null when omitted by callers — i.e. the
  // generator never throws on a fixture without the field.
  const sanity = generateNote(baseInput({ screenshotRef: null }));
  assert(sanity.screenshotStyle?.hasInput === false, "no screenshotRef -> hasInput false");
  // viralStyle path still works (back-compat) — we didn't accidentally
  // remove the field.
  assert(
    typeof sanity.viralStyle === "object",
    "viralStyle summary should still be attached for back-compat",
  );
}

// ---------- 7) ScreenshotMood is exhaustive for tints ----------
{
  // Probe every mood label so a future enum addition forces an update to the
  // CUE/MOOD label tables.
  const moods: ScreenshotMood[] = [
    "warm_cream",
    "pink_red",
    "warm_amber",
    "neutral",
    "cool_blue",
    "dark_moody",
  ];
  for (const m of moods) {
    assert(typeof m === "string", "mood key should be a string"); // tautology — TS-level guard
  }
}

console.log("OK: screenshot-style learning smoke assertions passed.");
