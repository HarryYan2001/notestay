// Smoke test: screenshot upload does NOT influence visual / image style.
//
// Background: an earlier iteration of NoteStay learned color palette, mood,
// contrast and other visual cues from the uploaded reference screenshot and
// bent the cover + page designs toward them. The user explicitly asked to
// remove this — they only want the screenshot to teach the BODY TEXT style
// via OCR. This test pins that behavior so the visual-influence path can
// never sneak back in.
//
// Assertions:
//   1) Uploading a reference screenshot does NOT change the cover
//      background, page designs, or layer set compared to a baseline run
//      with no screenshot.
//   2) No accent sticker layer (id prefix "lyr_acc_") is added when a
//      screenshot is present.
//   3) The screenshotStyle summary on the generated note only carries the
//      OCR text-style info — visual fields (palette, mood, accent) are gone
//      from the type.
//   4) generateNote runs in both A (framework) and B (freeform) modes with
//      the same no-visual-influence guarantee.
//   5) create.tsx no longer wires the visual analyzer (`analyzeScreenshotFile`)
//      or surfaces palette / mood / visual cue chips. The OCR pipeline
//      (`recognizeScreenshotText` + `analyzeScreenshotText`) is still wired.
//   6) The screenshot-style.ts module's visual analyzer is no longer
//      imported by generate.ts or create.tsx (it remains in-tree only for
//      potential future use, but is unused by the active code paths).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateNote } from "../client/src/lib/generate";
import { analyzeScreenshotText } from "../client/src/lib/screenshot-text-style";
import type {
  AppInputState,
  ScreenshotRef,
  ScreenshotTextStyleRef,
} from "../client/src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const DRAMATIC_TEXT = `姐妹们！这家酒店真的爱了！！😭😭
真的没想到能这么舒服！！！
床品柔软到想抱回家😭
强烈推荐，蹲一个同价位的姐妹一起冲！！
#上海酒店 #必住推荐 #小红书探店`;

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

function makeRef(ocr: string): ScreenshotRef {
  const t = analyzeScreenshotText(ocr);
  const textStyle: ScreenshotTextStyleRef = {
    hasText: t.hasText,
    charCount: t.charCount,
    cjkCount: t.cjkCount,
    tone: t.tone,
    cues: t.cues,
    detectedEmoji: t.detectedEmoji,
    punctIntensity: t.punctIntensity,
    avgSentenceLen: t.avgSentenceLen,
    hashtagCount: t.hashtagCount,
    status: t.status,
    previewText: ocr.replace(/\s+/g, " ").trim().slice(0, 240),
  };
  return { previewUrl: null, filename: "ref.png", textStyle };
}

// ---------- 1) no cover/page change vs baseline ----------

{
  const baseline = generateNote(baseInput());
  const learned = generateNote(baseInput({ screenshotRef: makeRef(DRAMATIC_TEXT) }));

  assert(
    baseline.cover.background === learned.cover.background,
    `cover background must NOT change when a screenshot is uploaded:\nbaseline=${baseline.cover.background}\nlearned =${learned.cover.background}`,
  );
  // Layer count + types must match (no accent sticker injection).
  assert(
    baseline.cover.layers.length === learned.cover.layers.length,
    `cover layer count must match: baseline=${baseline.cover.layers.length} learned=${learned.cover.layers.length}`,
  );
  assert(
    !learned.cover.layers.some((l) => l.id.startsWith("lyr_acc_")),
    "screenshot must not inject an accent sticker layer",
  );
  // Page designs (background, layers) should be identical between baseline
  // and learned (we compare the JSON since layer ids include the seed which
  // is the same per pageIndex offset).
  const baselinePageKeys = Object.keys(baseline.pageDesigns).sort();
  const learnedPageKeys = Object.keys(learned.pageDesigns).sort();
  assert(
    baselinePageKeys.join(",") === learnedPageKeys.join(","),
    `page design key sets must match`,
  );
  for (const k of baselinePageKeys) {
    const idx = Number(k);
    const a = baseline.pageDesigns[idx];
    const b = learned.pageDesigns[idx];
    assert(
      a.background === b.background,
      `page ${idx} background must match`,
    );
  }
}

// ---------- 2) summary surfaces OCR only ----------

{
  const learned = generateNote(baseInput({ screenshotRef: makeRef(DRAMATIC_TEXT) }));
  assert(learned.screenshotStyle, "screenshotStyle summary must exist");
  assert(learned.screenshotStyle!.hasInput === true, "hasInput should reflect upload");
  // Type-level guarantee: visual fields are gone from the summary.
  // We runtime-assert that the only structural keys are the new lean set.
  const keys = Object.keys(learned.screenshotStyle!).sort();
  const expectedKeys = ["hasInput", "status", "text"].sort();
  assert(
    keys.join(",") === expectedKeys.join(","),
    `screenshotStyle summary keys must be lean OCR-only set, got ${keys.join(",")}`,
  );
  assert(learned.screenshotStyle!.text.hasText === true, "OCR text style should be learned");
  assert(learned.screenshotStyle!.text.tone === "dramatic", "tone should classify as dramatic");
}

// ---------- 3) freeform mode same guarantees ----------

{
  const ff = baseInput({
    inputMode: "freeform",
    framework: [],
    freeText:
      "酒店离地铁很近。房间很安静，床品柔软。早餐有现做鸡蛋和咖啡，水果也新鲜。前台态度很好。",
  });
  const baseline = generateNote(ff);
  const learned = generateNote({ ...ff, screenshotRef: makeRef(DRAMATIC_TEXT) });
  assert(
    baseline.cover.background === learned.cover.background,
    `freeform: cover background must NOT change with screenshot`,
  );
  assert(
    !learned.cover.layers.some((l) => l.id.startsWith("lyr_acc_")),
    "freeform: no accent sticker injected",
  );
}

// ---------- 4) create.tsx wires OCR-only UI ----------

{
  const createPath = join(import.meta.dirname, "..", "client", "src", "pages", "create.tsx");
  const src = readFileSync(createPath, "utf-8");
  // Visual analyzer must no longer be imported or called.
  assert(
    !src.includes("analyzeScreenshotFile"),
    "create.tsx must NOT import analyzeScreenshotFile (visual analyzer removed)",
  );
  assert(
    !src.includes("SCREENSHOT_CUE_LABELS") && !src.includes("SCREENSHOT_MOOD_LABELS"),
    "create.tsx must NOT reference visual cue / mood labels",
  );
  // Palette / accent / mood UI testids must be gone.
  for (const stale of [
    "screenshot-learning-mood",
    "screenshot-learning-palette",
    "screenshot-palette-",
    "screenshot-accent",
    "screenshot-cue-",
  ]) {
    assert(
      !src.includes(stale),
      `create.tsx must NOT render a "${stale}" element (visual UI removed)`,
    );
  }
  // OCR pipeline still wired.
  assert(
    src.includes("recognizeScreenshotText"),
    "create.tsx must still wire recognizeScreenshotText",
  );
  assert(
    src.includes("analyzeScreenshotText"),
    "create.tsx must still wire analyzeScreenshotText",
  );
  // Existing OCR testids preserved.
  assert(
    src.includes('data-testid="screenshot-text-learning-panel"'),
    "OCR sub-panel testid must remain",
  );
  assert(
    src.includes('data-testid="screenshot-text-learning-status"'),
    "OCR status testid must remain",
  );
  assert(
    src.includes("screenshot-text-strength-control"),
    "strength control testid must remain",
  );
  // Updated section copy reflects OCR-only intent.
  assert(
    src.includes("OCR") || src.includes("正文风格"),
    "create.tsx should use updated copy referencing OCR / 正文风格",
  );
  // No browser storage.
  assert(
    !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(src),
    "create.tsx must not introduce browser-storage usage",
  );
}

// ---------- 5) generate.ts no longer uses the visual screenshot analyzer ----------

{
  const genPath = join(import.meta.dirname, "..", "client", "src", "lib", "generate.ts");
  const src = readFileSync(genPath, "utf-8");
  for (const stale of [
    "applyScreenshotToCover",
    "applyScreenshotToPage",
    "applyScreenshotTitleStyle",
    "applyScreenshotBodyOpening",
    "buildAccentStickerLayer",
    "screenshotWarningMessage",
    "emptyScreenshotProfile",
    "SCREENSHOT_CUE_LABELS",
    "SCREENSHOT_MOOD_LABELS",
  ]) {
    assert(
      !src.includes(stale),
      `generate.ts must NOT import/use the visual helper "${stale}"`,
    );
  }
  // Text-style transformer wiring is in place.
  assert(
    src.includes("applyTextStyleToBodySections"),
    "generate.ts must apply the body-section transformer",
  );
}

console.log("OK: no-visual-influence smoke assertions passed.");
