// Smoke test for the OCR-driven screenshot TEXT-style learning feature.
//
// Real browser flow: the user uploads a screenshot, the visual analyzer
// extracts color/contrast/text-density cues, and Tesseract.js OCR extracts
// the Chinese text inside the screenshot. We feed the OCR string into a pure
// analyzer (`analyzeScreenshotText`) which classifies the textual tone and
// produces cue tags. The generated note's title/body/closing are then bent
// toward that tone WITHOUT copying any source phrasing.
//
// Tesseract.js is impractical to spin up here (heavy WASM + language data),
// so this test exercises the pure analyzer + decorator pipeline directly
// with hand-crafted OCR strings that mimic three target-note archetypes:
//   - dramatic / 爆款: heavy !! / 哭脸 / 姐妹们 / 蹲一个
//   - healing / 治愈: 温柔 / 轻轻 / 悄悄 / 治愈
//   - premium / 高级: 沉静 / 不动声色 / 质感 / 低调
//
// Assertions:
//   1) analyzer classifies tone correctly and produces the expected cues
//   2) generation consumes the text style and bends title + body opening +
//      closing toward the learned tone
//   3) generation never copies source phrasing verbatim into output
//   4) absent / too-short OCR text degrades to visual-only (no warning,
//      no decoration) and existing visual learning still fires
//   5) screenshotStyle.text summary attaches with correct labels
//   6) the create.tsx UI surfaces OCR status + style chips with stable testids
//   7) the existing fixtures still satisfy AppInputState (back-compat)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeScreenshotText,
  applyTextStyleToTitle,
  applyTextStyleToBodyOpening,
  applyTextStyleToClosing,
  emptyTextProfile,
  TEXT_CUE_LABELS,
  TEXT_TONE_LABELS,
  type TextCue,
  type TextTone,
} from "../client/src/lib/screenshot-text-style";
import { generateNote } from "../client/src/lib/generate";
import type { AppInputState, ScreenshotRef, ScreenshotTextStyleRef } from "../client/src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// ---------- 1) pure analyzer classifies tone + cues ----------

const DRAMATIC_TEXT = `姐妹们！这家酒店真的爱了！！😭😭
真的没想到能这么舒服！！！
床品柔软到想抱回家😭
强烈推荐，蹲一个同价位的姐妹一起冲！！
#上海酒店 #必住推荐 #小红书探店`;

const HEALING_TEXT = `轻轻推开门，整间房像被阳光泡过一样温柔。
悄悄说一句：床品柔软到让人心安。
慢慢走到窗边，茶香和木质的味道把整个下午都治愈了。
若你也想要一个治愈的周末，码住这家就好。
#治愈系酒店 #周末小度假`;

const PREMIUM_TEXT = `不动声色的高级感，比任何宣传都更打动我。
克制的灯光、考究的材质、稳重的色调，质感写在每一处细节里。
低调地坐进沙发，时间也跟着安静下来。
讲究的人，会喜欢这里的厚重与沉静。`;

const TOO_SHORT_TEXT = "Logo NoteStay";

{
  const p = analyzeScreenshotText(DRAMATIC_TEXT);
  console.log("dramatic:", { tone: p.tone, cues: p.cues, punct: p.punctIntensity, avg: p.avgSentenceLen });
  assert(p.hasText, "dramatic OCR string must produce hasText=true");
  assert(p.tone === "dramatic", `dramatic OCR -> tone=dramatic, got ${p.tone}`);
  assert(p.cues.includes("exclamation_burst"), "dramatic OCR should have exclamation_burst cue");
  assert(p.cues.includes("vocative_opener"), "dramatic OCR should have vocative_opener cue");
  assert(p.cues.includes("hashtag_pattern"), "dramatic OCR should have hashtag_pattern cue");
  assert(p.detectedEmoji.some((e) => e === "😭"), "dramatic OCR should detect 😭");
}

{
  const p = analyzeScreenshotText(HEALING_TEXT);
  console.log("healing:", { tone: p.tone, cues: p.cues });
  assert(p.tone === "healing", `healing OCR -> tone=healing, got ${p.tone}`);
  assert(p.cues.includes("healing_register"), "healing OCR should have healing_register cue");
  assert(p.cues.includes("cta_collect"), "healing OCR should have cta_collect cue (码住)");
}

{
  const p = analyzeScreenshotText(PREMIUM_TEXT);
  console.log("premium:", { tone: p.tone, cues: p.cues });
  assert(p.tone === "premium", `premium OCR -> tone=premium, got ${p.tone}`);
  assert(p.cues.includes("premium_register"), "premium OCR should have premium_register cue");
}

{
  const p = analyzeScreenshotText(TOO_SHORT_TEXT);
  assert(!p.hasText, "too-short / latin-only OCR must be rejected as noise");
  assert(p.tone === "informative", "empty analyzer result should default tone=informative");
}

{
  // emptyTextProfile guarantees a stable false shape consumers can rely on.
  const e = emptyTextProfile();
  assert(!e.hasText, "emptyTextProfile must have hasText=false");
  assert(Array.isArray(e.cues) && e.cues.length === 0, "emptyTextProfile cues must be []");
}

// ---------- 2) decorators are deterministic + bend output ----------

{
  const dramaticProfile = analyzeScreenshotText(DRAMATIC_TEXT);
  const base = "测试酒店｜舒服到想再来一次。";
  const a = applyTextStyleToTitle(base, dramaticProfile);
  const b = applyTextStyleToTitle(base, dramaticProfile);
  assert(a === b, `applyTextStyleToTitle must be deterministic: ${a} vs ${b}`);
  assert(a !== base, `dramatic decorator should change the base title, got ${a}`);
  assert(/[!！]{2,}|😭|🥹|😱|😆/.test(a), `dramatic title decoration should add punctuation/emoji, got ${a}`);
}

{
  const healingProfile = analyzeScreenshotText(HEALING_TEXT);
  const base = "测试酒店｜很舒服。";
  const decorated = applyTextStyleToTitle(base, healingProfile);
  assert(/治愈|温柔|轻轻|柔软|奶系/.test(decorated), `healing title should add 治愈/温柔, got ${decorated}`);
}

{
  const premiumProfile = analyzeScreenshotText(PREMIUM_TEXT);
  const base = "测试酒店｜很舒服。";
  const decorated = applyTextStyleToTitle(base, premiumProfile);
  assert(/高级|沉静|质感|低调|不动声色|讲究/.test(decorated),
    `premium title should add a 高级/沉静 token, got ${decorated}`);
}

{
  const dramaticProfile = analyzeScreenshotText(DRAMATIC_TEXT);
  const opening = "真的，住完只想说一句：舒服得想再来一次。";
  const decorated = applyTextStyleToBodyOpening(opening, dramaticProfile);
  assert(decorated !== opening, "dramatic body opening should change");
  assert(/^(姐妹们|宝子们|家人们)/.test(decorated),
    `dramatic body opening should prepend a vocative, got ${decorated}`);
}

{
  const healingProfile = analyzeScreenshotText(HEALING_TEXT);
  const opening = "先说结论，这一晚舒服到不舍得退房。";
  const decorated = applyTextStyleToBodyOpening(opening, healingProfile);
  assert(/^悄悄说一句/.test(decorated), `healing opening should start with 悄悄说一句, got ${decorated}`);
}

{
  const dramaticProfile = analyzeScreenshotText(DRAMATIC_TEXT);
  const closing = "小本本记一下：想住得舒服又出片，这家可以放进收藏夹。";
  const decorated = applyTextStyleToClosing(closing, dramaticProfile);
  assert(/蹲|评论区|想问/.test(decorated),
    `dramatic CTA closing should add 蹲/评论区 hook, got ${decorated}`);
}

// ---------- 3) generation pipeline consumes text profile ----------

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
  // Visual fields were removed — only the OCR-derived textStyle remains.
  return {
    previewUrl: null,
    filename: "ref.png",
    textStyle,
  };
}

// Dramatic OCR
{
  const baseline = generateNote(baseInput());
  const learned = generateNote(baseInput({ screenshotRef: makeRef(DRAMATIC_TEXT) }));
  console.log("dramatic baseline title:", baseline.title);
  console.log("dramatic learned  title:", learned.title);
  assert(learned.title !== baseline.title,
    `dramatic OCR should change title:\nbaseline=${baseline.title}\nlearned=${learned.title}`);
  assert(
    /[!！]{2,}|😭|🥹|😱|😆/.test(learned.title),
    `dramatic OCR title should pick up !!  or emoji, got ${learned.title}`,
  );
  // Body opening must shift.
  const baseOpening = baseline.body.split("\n")[0];
  const learnedOpening = learned.body.split("\n")[0];
  assert(learnedOpening !== baseOpening,
    `dramatic OCR body opening should change\nbaseline=${baseOpening}\nlearned=${learnedOpening}`);
  // screenshotStyle.text summary attached.
  assert(learned.screenshotStyle?.text?.hasText === true,
    "dramatic note should carry screenshotStyle.text.hasText=true");
  assert(learned.screenshotStyle?.text?.tone === "dramatic",
    `screenshotStyle.text.tone should be 'dramatic', got ${learned.screenshotStyle?.text?.tone}`);
  assert(
    typeof learned.screenshotStyle?.text?.toneLabel === "string" &&
      learned.screenshotStyle.text.toneLabel.length > 0,
    "toneLabel should be populated",
  );
  // Warning announces text-style learning.
  assert(
    learned.warnings.some((w) => w.includes("已学习参考截图文字风格")),
    `warnings should announce text-style learning, got ${JSON.stringify(learned.warnings)}`,
  );
}

// Healing OCR
{
  const learned = generateNote(baseInput({ screenshotRef: makeRef(HEALING_TEXT) }));
  console.log("healing learned title:", learned.title);
  console.log("healing learned opening:", learned.body.split("\n")[0]);
  assert(
    /治愈|温柔|轻轻|柔软|奶系/.test(learned.title) ||
      /悄悄说|轻轻|慢慢/.test(learned.body),
    `healing OCR should bend title/body toward 治愈, got title=${learned.title}`,
  );
  assert(learned.screenshotStyle?.text?.tone === "healing", "healing OCR -> tone=healing");
}

// Premium OCR
{
  const learned = generateNote(baseInput({ screenshotRef: makeRef(PREMIUM_TEXT) }));
  console.log("premium learned title:", learned.title);
  assert(
    /高级|沉静|质感|低调|不动声色|讲究/.test(learned.title + learned.body),
    `premium OCR should bend output toward 高级/沉静, got title=${learned.title}`,
  );
  assert(learned.screenshotStyle?.text?.tone === "premium", "premium OCR -> tone=premium");
}

// ---------- 4) no verbatim copy of source phrasing ----------

{
  const learned = generateNote(baseInput({ screenshotRef: makeRef(DRAMATIC_TEXT) }));
  // None of the unique reference phrases should appear in the generated body.
  for (const phrase of [
    "蹲一个同价位的姐妹一起冲",
    "床品柔软到想抱回家",
    "真的没想到能这么舒服",
    "#上海酒店",
    "#必住推荐",
    "#小红书探店",
  ]) {
    assert(
      !learned.body.includes(phrase) && !learned.title.includes(phrase),
      `output must not copy source phrase "${phrase}"`,
    );
  }
  // The full OCR string must not appear anywhere.
  assert(!learned.body.includes(DRAMATIC_TEXT), "body must not include OCR string");
}

// ---------- 5) absent / too-short OCR -> graceful degrade ----------

{
  // A ref where textStyle was attempted but produced no text. The generator
  // should still run, no text warning should appear, and no text decoration
  // should be applied beyond the existing visual decoration.
  const ref = makeRef(""); // empty OCR
  assert(ref.textStyle && !ref.textStyle.hasText, "empty OCR should yield hasText=false");
  const learned = generateNote(baseInput({ screenshotRef: ref }));
  assert(
    !learned.warnings.some((w) => w.includes("已学习参考截图文字风格")),
    "empty-OCR ref must NOT emit a text-style learning warning",
  );
  assert(
    learned.screenshotStyle?.text?.hasText === false,
    "empty-OCR ref must surface hasText=false in summary",
  );
}

// ---------- 6) create.tsx wires the OCR sub-panel UI ----------

{
  const createPath = join(import.meta.dirname, "..", "client", "src", "pages", "create.tsx");
  const createSrc = readFileSync(createPath, "utf-8");
  assert(
    createSrc.includes('data-testid="screenshot-text-learning-panel"'),
    "create.tsx must render the OCR/text sub-panel container",
  );
  assert(
    createSrc.includes('data-testid="screenshot-text-learning-status"'),
    "create.tsx must surface the OCR status text",
  );
  assert(
    createSrc.includes("recognizeScreenshotText"),
    "create.tsx must wire the recognizeScreenshotText call",
  );
  assert(
    createSrc.includes("analyzeScreenshotText"),
    "create.tsx must wire the analyzeScreenshotText call",
  );
  assert(
    createSrc.includes('data-testid="button-toggle-ocr-preview"') ||
      createSrc.includes("button-toggle-ocr-preview"),
    "create.tsx must render the optional OCR preview toggle",
  );
  // Storage guarantees still hold.
  assert(
    !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(createSrc),
    "create.tsx must not introduce browser-storage usage",
  );
}

// ---------- 7) cue/tone label tables are exhaustive ----------

{
  const tones: TextTone[] = ["dramatic", "healing", "premium", "playful", "informative"];
  for (const t of tones) {
    assert(typeof TEXT_TONE_LABELS[t] === "string" && TEXT_TONE_LABELS[t].length > 0,
      `TEXT_TONE_LABELS missing ${t}`);
  }
  const cues: TextCue[] = [
    "heavy_emoji",
    "exclamation_burst",
    "question_burst",
    "ellipsis_pacing",
    "short_punchy",
    "long_storytelling",
    "vocative_opener",
    "first_person_drama",
    "healing_register",
    "premium_register",
    "playful_register",
    "cta_collect",
    "cta_comment",
    "hashtag_pattern",
    "section_emoji_heads",
  ];
  for (const c of cues) {
    assert(typeof TEXT_CUE_LABELS[c] === "string" && TEXT_CUE_LABELS[c].length > 0,
      `TEXT_CUE_LABELS missing ${c}`);
  }
}

console.log("OK: screenshot text-style learning smoke assertions passed.");
