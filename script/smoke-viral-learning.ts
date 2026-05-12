// Smoke test for the 爆款笔记学习 viral-style-learning feature.
//
// Asserts:
//   1) analyzeViralReference recognizes the sample Xiaohongshu share text
//      (亚朵 example), extracts the bracket title, identifies the URL, and
//      surfaces the expected style cues (强情绪 / emoji / 口语化 / 悬念).
//   2) generateNote influenced by that share text produces a title that is
//      stylistically different from the baseline (extra emoji, repeated
//      punctuation, or hook prefix); body opens with a more colloquial /
//      dramatic hook.
//   3) When only a bare URL with no parsable title is provided, the
//      analyzer falls back gracefully and reports isFallback=false +
//      isXhsLink=true.
//   4) Random / unrelated text still parses without throwing and sets
//      isFallback=true and isXhsLink=false.
//   5) Original copyrighted text is NEVER copied into the generated title
//      or body verbatim — even the bracketed title characters must not show
//      up literally.
//   6) create.tsx wires the textarea + status panel with the documented
//      data-testid surface.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeViralReference,
  applyTitleStyle,
} from "../client/src/lib/viral-style";
import { generateNote } from "../client/src/lib/generate";
import type { AppInputState } from "../client/src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const SAMPLE_SHARE =
  "49 【亚朵你还我萨和！！！😭😭😭 - 晨钟去哪玩 | 小红书 - 你的生活兴趣社区】 😆 hsjTXluHJhCKGf5 😆 https://www.xiaohongshu.com/discovery/item/67565633000000000600e195?app_platform=android";

// ---------- 1) analyzer recognizes the share card ----------
{
  const profile = analyzeViralReference(SAMPLE_SHARE);
  console.log("--- analyzer on sample share ---");
  console.log(profile);

  assert(profile.hasInput, "hasInput must be true for the sample share text");
  assert(profile.isXhsLink, "must detect xiaohongshu.com URL");
  assert(
    profile.extractedUrl?.includes("xiaohongshu.com"),
    "extractedUrl must include xiaohongshu.com",
  );
  assert(
    profile.extractedTitle === "亚朵你还我萨和！！！😭😭😭",
    `extractedTitle mismatch: ${profile.extractedTitle}`,
  );
  assert(profile.punctIntensity >= 2, "punctIntensity must reflect repeated !!!");
  assert(profile.detectedEmoji.includes("😭"), "must detect 😭");
  assert(
    profile.cues.includes("high_emotion_title"),
    "must learn high_emotion_title cue",
  );
  assert(
    profile.cues.includes("crying_or_strong_emoji"),
    "must learn crying_or_strong_emoji cue",
  );
  assert(
    profile.cues.includes("complaint_hook"),
    "must learn complaint_hook cue (还我 trigger)",
  );
  assert(
    profile.cues.includes("repeated_punctuation"),
    "must learn repeated_punctuation cue",
  );
  assert(
    profile.cues.includes("travel_or_hotel_topic"),
    "must learn travel_or_hotel_topic cue (亚朵 trigger)",
  );
  assert(
    profile.status.startsWith("已学习"),
    `status should begin with 已学习, got: ${profile.status}`,
  );
}

// ---------- 2) generated note differs in style ----------
function baseInput(overrides: Partial<AppInputState> = {}): AppInputState {
  return {
    inputMode: "framework",
    framework: [
      { id: "f1", label: "位置", value: "酒店在市中心,步行就能到地铁站,逛街很方便。" },
      { id: "f2", label: "房间", value: "推开门是落地窗,床品柔软,洗手间干湿分离很舒服。" },
      { id: "f3", label: "早餐", value: "现做的鸡蛋很香,咖啡也不错,水果新鲜。" },
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
    ...overrides,
  };
}

// Helper: count exclamation/question/emoji decorations.
function isDramatic(s: string): boolean {
  return /[!！]{2,}|[?？]{2,}|😭|😱|🥲|💔|救命|谁懂|破防|气死|没想到|真的会/.test(s);
}

// Framework mode A: compare baseline vs learned.
{
  const baseline = generateNote(baseInput());
  const learned = generateNote(baseInput({ viralRef: SAMPLE_SHARE }));
  console.log("--- framework: baseline title vs learned title ---");
  console.log("baseline:", baseline.title);
  console.log("learned :", learned.title);

  assert(
    isDramatic(learned.title),
    `learned title should be dramatic / emoji'd / punctuated, got: ${learned.title}`,
  );
  assert(
    !isDramatic(baseline.title),
    `baseline title (no viralRef) should NOT be dramatic, got: ${baseline.title}`,
  );

  // Body opening hook should be more colloquial / dramatic too.
  const learnedOpening = learned.body.split("\n")[0];
  const baselineOpening = baseline.body.split("\n")[0];
  console.log("baseline opening:", baselineOpening);
  console.log("learned  opening:", learnedOpening);
  assert(
    learnedOpening !== baselineOpening,
    "opening hook should differ when viral reference is supplied",
  );
  assert(
    /姐妹们|宝子|家人们|兄弟们|!!|！！/.test(learnedOpening),
    `opening hook should include a colloquial vocative or amplified punctuation, got: ${learnedOpening}`,
  );

  // viralStyle summary is attached to the note for the UI / tests.
  assert(learned.viralStyle?.hasInput === true, "viralStyle.hasInput must be true");
  assert(
    learned.viralStyle?.cues.includes("high_emotion_title"),
    "viralStyle.cues must include high_emotion_title",
  );

  // Warnings array carries the learned status sentence.
  assert(
    learned.warnings.some((w) => w.includes("已学习参考笔记风格")),
    "warnings must announce that viral style was learned",
  );
}

// Freeform mode B: same checks.
{
  const baseline = generateNote(
    baseInput({
      inputMode: "freeform",
      framework: [],
      freeText:
        "酒店离地铁很近。房间很安静,床品柔软。早餐有现做鸡蛋和咖啡,水果也新鲜。前台态度很好。",
    }),
  );
  const learned = generateNote(
    baseInput({
      inputMode: "freeform",
      framework: [],
      freeText:
        "酒店离地铁很近。房间很安静,床品柔软。早餐有现做鸡蛋和咖啡,水果也新鲜。前台态度很好。",
      viralRef: SAMPLE_SHARE,
    }),
  );
  console.log("--- freeform: baseline vs learned ---");
  console.log("baseline title:", baseline.title);
  console.log("learned  title:", learned.title);
  assert(
    isDramatic(learned.title),
    `freeform learned title should be dramatic, got: ${learned.title}`,
  );
  assert(
    !isDramatic(baseline.title),
    `freeform baseline title should NOT be dramatic, got: ${baseline.title}`,
  );
}

// ---------- 3) bare URL fallback ----------
{
  const profile = analyzeViralReference("https://www.xiaohongshu.com/discovery/item/67565633");
  assert(profile.hasInput, "bare URL must register hasInput");
  assert(profile.isXhsLink, "bare URL must be detected as xhs link");
  assert(profile.extractedTitle === null, "bare URL has no extractable title");
  assert(
    !profile.isFallback,
    "bare xhs URL should NOT be marked as fallback (it's a real recognized link)",
  );
  // Even with no title we should still get the share-format cue.
  assert(
    profile.cues.includes("xhs_share_format"),
    "bare URL should still raise xhs_share_format cue",
  );
}

// ---------- 4) unrelated text fallback ----------
{
  const profile = analyzeViralReference("一段完全无关的文字,没有链接也没有特征");
  assert(profile.hasInput, "non-link text must register hasInput");
  assert(!profile.isXhsLink, "non-link text must not be flagged as xhs link");
  assert(profile.isFallback, "non-link text without title must be fallback");
}

// ---------- 5) no verbatim copy of the original copyrighted body ----------
{
  const learned = generateNote(baseInput({ viralRef: SAMPLE_SHARE }));
  assert(
    !learned.title.includes("亚朵你还我萨和"),
    "generated title must not copy original bracket title verbatim",
  );
  assert(
    !learned.body.includes("亚朵你还我萨和"),
    "generated body must not copy original bracket title verbatim",
  );
  assert(
    !learned.body.includes("晨钟去哪玩"),
    "generated body must not copy original author handle",
  );
  assert(
    !learned.body.includes("hsjTXluHJhCKGf5"),
    "generated body must not include the share token",
  );
}

// ---------- 6) determinism: same input -> same title decoration ----------
{
  const profile = analyzeViralReference(SAMPLE_SHARE);
  const a = applyTitleStyle("测试酒店｜很舒服。", profile);
  const b = applyTitleStyle("测试酒店｜很舒服。", profile);
  assert(a === b, `applyTitleStyle must be deterministic: ${a} vs ${b}`);
  assert(
    isDramatic(a),
    `decorated title should be dramatic, got: ${a}`,
  );
}

// ---------- 7) create.tsx wires the UI surface ----------
const createPath = join(import.meta.dirname, "..", "client", "src", "pages", "create.tsx");
const createSrc = readFileSync(createPath, "utf-8");
assert(
  createSrc.includes('data-testid="input-viral-link"'),
  "create.tsx must keep the input-viral-link testid",
);
assert(
  createSrc.includes('data-testid="viral-learning-panel"'),
  "create.tsx must render the viral-learning-panel container",
);
assert(
  createSrc.includes('data-testid="viral-learning-status-text"'),
  "create.tsx must surface viral-learning-status-text",
);
assert(
  createSrc.includes("analyzeViralReference"),
  "create.tsx must wire the analyzeViralReference call",
);
// Must not introduce browser storage in the viral-learning block.
assert(
  !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(createSrc),
  "create.tsx must not introduce browser-storage usage",
);

// ---------- 8) bracket title alone (no URL) still teaches style ----------
{
  // User pasted the share-card title only.
  const profile = analyzeViralReference("【亚朵你还我萨和！！！😭😭😭 - 晨钟去哪玩 | 小红书】");
  assert(profile.hasInput, "title-only must register hasInput");
  assert(profile.extractedTitle?.startsWith("亚朵"), "title-only must extract bracket title");
  assert(
    profile.cues.includes("high_emotion_title"),
    "title-only must still learn high_emotion_title",
  );
}

console.log("OK: viral-style learning smoke assertions passed.");
