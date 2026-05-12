// Smoke test for the 文字风格模仿强度 control.
//
// The control lets the user dial how aggressively NoteStay imitates the
// OCR-learned text style of the uploaded target-note screenshot:
//   - light:  only learn 语气 / 标题节奏, keep NoteStay's native voice
//   - medium: default, balanced
//   - high:   strong mimicry of 标题节奏 / emoji 密度 / 口吻 / CTA hooks
//
// Visual / image-style learning has been REMOVED — uploading a screenshot
// only learns the body text style; it does not influence cover or page
// designs. This test asserts the no-visual-influence behavior alongside
// the strength-driven body changes.
//
// Assertions:
//   1) Pure decorator functions (applyTextStyleToTitle / ToBodyOpening /
//      ToClosing) respect the strength parameter and are deterministic.
//   2) generateNote produces distinguishable output across the three levels,
//      INCLUDING the body sections themselves (not just title/opening/
//      closing).
//   3) high body is strictly more stylistically assertive than light along
//      multiple axes (tone prefix, emoji, punctuation, vocative).
//   4) No level copies reference phrases verbatim from the OCR text.
//   5) Uploading a screenshot does NOT change the cover background or page
//      designs regardless of strength — that behavior was removed.
//   6) The warning string surfaces the chosen strength label.
//   7) The screenshotStyle.text summary carries `strength` + `strengthLabel`.
//   8) create.tsx wires the segmented control with stable testids and the
//      no-browser-storage guarantee still holds.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeScreenshotText,
  applyTextStyleToBodyOpening,
  applyTextStyleToClosing,
  applyTextStyleToTitle,
  DEFAULT_TEXT_STYLE_STRENGTH,
  normalizeTextStyleStrength,
  TEXT_STYLE_STRENGTH_LABELS,
  TEXT_STYLE_STRENGTH_LEVELS,
} from "../client/src/lib/screenshot-text-style";
import { generateNote } from "../client/src/lib/generate";
import type {
  AppInputState,
  ScreenshotRef,
  ScreenshotTextStyleRef,
  TextStyleStrength,
} from "../client/src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// Same OCR fixtures as smoke-screenshot-text-style.ts so the two tests are
// directly comparable.
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

// ---------- 1) decorators respect strength + are deterministic ----------

{
  const profile = analyzeScreenshotText(DRAMATIC_TEXT);
  const base = "测试酒店｜舒服到想再来一次。";
  const light1 = applyTextStyleToTitle(base, profile, "light");
  const light2 = applyTextStyleToTitle(base, profile, "light");
  const medium = applyTextStyleToTitle(base, profile, "medium");
  const high = applyTextStyleToTitle(base, profile, "high");
  console.log("dramatic title light :", light1);
  console.log("dramatic title medium:", medium);
  console.log("dramatic title high  :", high);
  assert(light1 === light2, "title decorator must be deterministic for the same strength");
  // light must NOT add punctuation burst or emoji.
  assert(
    !/[!！]{2,}/.test(light1) && !/😭|🥹|😱|😆/.test(light1),
    `light dramatic title must skip punctuation burst + emoji, got ${light1}`,
  );
  // medium adds at least !! or one emoji.
  assert(
    /[!！]{2,}|😭|🥹|😱|😆/.test(medium),
    `medium dramatic title should add !! or one strong emoji, got ${medium}`,
  );
  // high should be at least as assertive as medium AND strictly different
  // from light (more emoji or stronger burst).
  assert(high !== light1, `high should differ from light for dramatic: high=${high}`);
  // length(high) >= length(medium) — heavier decoration never shortens.
  assert(
    high.length >= medium.length,
    `high should be at least as long as medium: high=${high} medium=${medium}`,
  );
}

{
  // Healing: light must leave the title alone, medium appends 好治愈, high
  // appends a longer 超治愈奶系感 phrase.
  const profile = analyzeScreenshotText(HEALING_TEXT);
  const base = "测试酒店｜很舒服。";
  const light = applyTextStyleToTitle(base, profile, "light");
  const medium = applyTextStyleToTitle(base, profile, "medium");
  const high = applyTextStyleToTitle(base, profile, "high");
  console.log("healing titles:", { light, medium, high });
  assert(light === base, `healing light title should equal base, got ${light}`);
  assert(/治愈/.test(medium), `healing medium title should append 治愈, got ${medium}`);
  assert(/治愈/.test(high) && high.length > medium.length,
    `healing high title should be a longer 治愈 phrase, got high=${high} medium=${medium}`);
}

{
  // Premium: same shape — light leaves alone, medium / high add 质感 markers
  // of increasing length.
  const profile = analyzeScreenshotText(PREMIUM_TEXT);
  const base = "测试酒店｜很舒服。";
  const light = applyTextStyleToTitle(base, profile, "light");
  const medium = applyTextStyleToTitle(base, profile, "medium");
  const high = applyTextStyleToTitle(base, profile, "high");
  console.log("premium titles:", { light, medium, high });
  assert(light === base, `premium light title should equal base, got ${light}`);
  assert(/质感|沉静|高级|不动声色|讲究|低调/.test(medium),
    `premium medium title should add a 质感/高级 token, got ${medium}`);
  assert(high.length > medium.length, `premium high should be longer than medium`);
}

{
  // Body opening: dramatic. Light skips vocative + skips burst. Medium adds
  // vocative + !!. High goes to !!! and a longer vocative phrase.
  const profile = analyzeScreenshotText(DRAMATIC_TEXT);
  const opening = "真的，住完只想说一句：舒服得想再来一次。";
  const light = applyTextStyleToBodyOpening(opening, profile, "light");
  const medium = applyTextStyleToBodyOpening(opening, profile, "medium");
  const high = applyTextStyleToBodyOpening(opening, profile, "high");
  console.log("dramatic openings:", { light, medium, high });
  assert(
    !/^(姐妹们|宝子们|家人们)/.test(light),
    `light opening must not prepend a vocative, got ${light}`,
  );
  assert(!/[!！]{2,}/.test(light), `light opening must not add !!, got ${light}`);
  assert(/^(姐妹们|宝子们|家人们)/.test(medium),
    `medium opening should prepend a vocative, got ${medium}`);
  assert(/[!！]{2,}/.test(medium), `medium opening should add !!, got ${medium}`);
  assert(/[!！]{3,}/.test(high), `high opening should add !!!, got ${high}`);
  assert(high.length > medium.length, `high opening should be longer than medium`);
}

{
  // Closing: dramatic OCR has cta_comment. Light leaves closing alone, medium
  // adds a CTA hook, high adds a longer one.
  const profile = analyzeScreenshotText(DRAMATIC_TEXT);
  const closing = "小本本记一下：想住得舒服又出片，这家可以放进收藏夹。";
  const light = applyTextStyleToClosing(closing, profile, "light");
  const medium = applyTextStyleToClosing(closing, profile, "medium");
  const high = applyTextStyleToClosing(closing, profile, "high");
  console.log("dramatic closings:", { light, medium, high });
  assert(light === closing, `light closing should equal source, got ${light}`);
  assert(/蹲|评论区|想问/.test(medium), `medium closing should add CTA hook, got ${medium}`);
  assert(/蹲|评论区|想问/.test(high) && high.length > medium.length,
    `high closing should be a longer CTA, got high=${high} medium=${medium}`);
}

// ---------- 2) generation pipeline produces distinguishable output ----------

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
  return {
    previewUrl: null,
    filename: "ref.png",
    textStyle,
  };
}

function runAt(strength: TextStyleStrength, ocr: string) {
  return generateNote(
    baseInput({ screenshotRef: makeRef(ocr), textStyleStrength: strength }),
  );
}

{
  const light = runAt("light", DRAMATIC_TEXT);
  const medium = runAt("medium", DRAMATIC_TEXT);
  const high = runAt("high", DRAMATIC_TEXT);
  console.log("gen dramatic light title :", light.title);
  console.log("gen dramatic medium title:", medium.title);
  console.log("gen dramatic high  title :", high.title);

  // Titles differ across strengths.
  assert(
    light.title !== medium.title || light.title !== high.title,
    `at least one of {light,medium,high} title should differ, got all=${light.title}`,
  );
  assert(high.title !== light.title, `high title should differ from light`);

  // High is more assertive than light along at least one axis.
  const lightHits = (
    (/[!！]{2,}/.test(light.title) ? 1 : 0) +
    (/😭|🥹|😱|😆/.test(light.title) ? 1 : 0)
  );
  const highHits = (
    (/[!！]{2,}/.test(high.title) ? 1 : 0) +
    (/😭|🥹|😱|😆/.test(high.title) ? 1 : 0)
  );
  assert(highHits > lightHits, `high should outscore light on burst/emoji: light=${lightHits} high=${highHits}`);

  // Body openings differ between light and high.
  const lo = light.body.split("\n")[0];
  const ho = high.body.split("\n")[0];
  assert(lo !== ho, `body opening should differ between light and high\nlight=${lo}\nhigh=${ho}`);

  // Closings: the last non-empty line. With the dramatic ref having
  // cta_comment, light keeps closing as-is, medium/high add CTA hook.
  function lastLine(body: string): string {
    const lines = body.split("\n").map((s) => s.trim()).filter(Boolean);
    return lines[lines.length - 1] ?? "";
  }
  const lc = lastLine(light.body);
  const mc = lastLine(medium.body);
  const hc = lastLine(high.body);
  assert(!/蹲|评论区|想问/.test(lc), `light closing should not have CTA hook, got ${lc}`);
  assert(/蹲|评论区|想问/.test(mc), `medium closing should have CTA hook, got ${mc}`);
  assert(/蹲|评论区|想问/.test(hc), `high closing should have CTA hook, got ${hc}`);
}

// ---------- 3) no verbatim copy at any strength ----------

{
  for (const strength of TEXT_STYLE_STRENGTH_LEVELS) {
    const note = runAt(strength, DRAMATIC_TEXT);
    for (const phrase of [
      "蹲一个同价位的姐妹一起冲",
      "床品柔软到想抱回家",
      "真的没想到能这么舒服",
      "#上海酒店",
      "#必住推荐",
      "#小红书探店",
    ]) {
      assert(
        !note.body.includes(phrase) && !note.title.includes(phrase),
        `(${strength}) output must not copy "${phrase}"`,
      );
    }
    assert(!note.body.includes(DRAMATIC_TEXT), `(${strength}) body must not echo OCR string`);
  }
}

// ---------- 3b) body sections themselves shift with strength ----------
//
// The original bug: the user complained the body 正文 didn't visibly change
// even at high strength. Title / opening / closing changed but section
// paragraphs read the same. These assertions cover that gap.

{
  // Extract the rendered body section bodies. Sections are emoji+label
  // headed; their content is the line(s) BETWEEN section headers.
  function extractSectionBodies(body: string): string[] {
    const lines = body.split("\n");
    const out: string[] = [];
    let buf: string[] = [];
    let inSection = false;
    const SECTION_HEAD_RE = /^[\p{Extended_Pictographic}☀-➿✨][^\n]{0,3}\s+\S/u;
    for (const line of lines) {
      // Heuristic: a "section head" line starts with an emoji followed by a
      // short Chinese label. We treat everything between heads as section
      // body text. We skip the opening hook, context line, and closing —
      // they're the lines BEFORE the first head and AFTER the last body.
      if (SECTION_HEAD_RE.test(line)) {
        if (inSection && buf.length) out.push(buf.join("\n").trim());
        buf = [];
        inSection = true;
        continue;
      }
      if (inSection) buf.push(line);
    }
    if (inSection && buf.length) out.push(buf.join("\n").trim());
    return out.filter(Boolean);
  }

  const light = runAt("light", DRAMATIC_TEXT);
  const medium = runAt("medium", DRAMATIC_TEXT);
  const high = runAt("high", DRAMATIC_TEXT);

  const lightBodies = extractSectionBodies(light.body);
  const mediumBodies = extractSectionBodies(medium.body);
  const highBodies = extractSectionBodies(high.body);

  console.log("light section bodies:", lightBodies);
  console.log("high  section bodies:", highBodies);

  assert(lightBodies.length > 0, "test setup must yield at least one section");
  assert(
    lightBodies.length === highBodies.length,
    `section count should match across strengths: light=${lightBodies.length} high=${highBodies.length}`,
  );

  // Light bodies should be (nearly) untouched for a dramatic reference,
  // because light-strength body transform is a no-op for non-playful tones.
  // High bodies must differ from light bodies on at least one section.
  let anyDiff = false;
  for (let i = 0; i < lightBodies.length; i++) {
    if (lightBodies[i] !== highBodies[i]) anyDiff = true;
  }
  assert(
    anyDiff,
    `high body sections must differ from light:\nlight=${JSON.stringify(lightBodies)}\nhigh=${JSON.stringify(highBodies)}`,
  );
  // Medium should also differ from light on at least one section (it adds
  // tone prefix to the first section of section 0).
  let anyMediumDiff = false;
  for (let i = 0; i < lightBodies.length; i++) {
    if (lightBodies[i] !== mediumBodies[i]) anyMediumDiff = true;
  }
  assert(
    anyMediumDiff,
    `medium body sections must differ from light on at least one section`,
  );

  // Stylistic-signal counters across the entire body section block.
  const lightJoined = lightBodies.join("\n");
  const highJoined = highBodies.join("\n");
  const punctCount = (s: string) =>
    (s.match(/[!！]{2,}|[?？]{2,}/g) ?? []).length;
  const emojiCount = (s: string) => {
    let n = 0;
    for (const ch of s) {
      const code = ch.codePointAt(0) ?? 0;
      if (
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x2600 && code <= 0x27bf) ||
        (code >= 0x1f900 && code <= 0x1f9ff)
      ) n++;
    }
    return n;
  };
  const vocativeCount = (s: string) =>
    (s.match(/姐妹们|宝子们|家人们/g) ?? []).length;

  const lightPunct = punctCount(lightJoined);
  const highPunct = punctCount(highJoined);
  const lightEmoji = emojiCount(lightJoined);
  const highEmoji = emojiCount(highJoined);
  const lightVoc = vocativeCount(lightJoined);
  const highVoc = vocativeCount(highJoined);

  console.log(
    `body signals — punct l=${lightPunct} h=${highPunct} | emoji l=${lightEmoji} h=${highEmoji} | vocative l=${lightVoc} h=${highVoc}`,
  );

  // High must outscore light on at least TWO of the three axes for a
  // dramatic reference (multi-axis signal — heavier overall body styling).
  let axes = 0;
  if (highPunct > lightPunct) axes++;
  if (highEmoji > lightEmoji) axes++;
  if (highVoc > lightVoc) axes++;
  assert(
    axes >= 2,
    `high body should outscore light on at least 2 of {punct,emoji,vocative}, got axes=${axes}`,
  );
}

// ---------- 3c) healing tone bends body sections too ----------

{
  const light = runAt("light", HEALING_TEXT);
  const high = runAt("high", HEALING_TEXT);
  assert(
    light.body !== high.body,
    `healing high body must differ from healing light body`,
  );
  // High healing should sprinkle 轻轻/悄悄/慢慢 register markers in the
  // body section block (not just the opening). Light should not.
  assert(
    /轻轻地|悄悄地|慢慢说/.test(high.body),
    `healing high body should carry the 治愈 register, got body=${high.body}`,
  );
}

const HEALING_TEXT_LOCAL = `轻轻推开门，整间房像被阳光泡过一样温柔。
悄悄说一句：床品柔软到让人心安。
慢慢走到窗边，茶香和木质的味道把整个下午都治愈了。
若你也想要一个治愈的周末，码住这家就好。`;
// Re-declared here for the assertion above so the const is available at
// module scope (the earlier HEALING_TEXT lives at the top of this file).
void HEALING_TEXT_LOCAL;

// ---------- 4) cover + page visuals are NOT influenced by the screenshot ----------

{
  // Uploading a screenshot must NOT change the cover background or page
  // designs at any strength — visual learning was removed. We compare to a
  // baseline run that has no screenshot at all.
  const baselineNoRef = generateNote(baseInput());
  const ref = makeRef(DRAMATIC_TEXT);
  const a = generateNote(baseInput({ screenshotRef: ref, textStyleStrength: "light" }));
  const b = generateNote(baseInput({ screenshotRef: ref, textStyleStrength: "medium" }));
  const c = generateNote(baseInput({ screenshotRef: ref, textStyleStrength: "high" }));
  for (const x of [a, b, c]) {
    assert(x.screenshotStyle?.hasInput === true, "summary should mark hasInput when a ref was uploaded");
    assert(
      x.cover.background === baselineNoRef.cover.background,
      `screenshot must NOT change cover background, got with-ref=${x.cover.background} baseline=${baselineNoRef.cover.background}`,
    );
    // No accent sticker should be added by screenshot upload.
    assert(
      !x.cover.layers.some((l) => l.id.startsWith("lyr_acc_")),
      "screenshot must NOT inject an accent sticker layer",
    );
  }
  assert(
    a.cover.background === c.cover.background,
    `cover background must match across strengths`,
  );
}

// ---------- 5) warning + summary reflect strength ----------

{
  for (const strength of TEXT_STYLE_STRENGTH_LEVELS) {
    const note = runAt(strength, DRAMATIC_TEXT);
    const label = TEXT_STYLE_STRENGTH_LABELS[strength];
    assert(
      note.warnings.some((w) => w.includes("已学习参考截图文字风格") && w.includes(label)),
      `(${strength}) warning should announce ${label} strength, got ${JSON.stringify(note.warnings)}`,
    );
    assert(
      note.screenshotStyle?.text?.strength === strength,
      `(${strength}) summary.strength should match, got ${note.screenshotStyle?.text?.strength}`,
    );
    assert(
      note.screenshotStyle?.text?.strengthLabel === label,
      `(${strength}) summary.strengthLabel should be ${label}, got ${note.screenshotStyle?.text?.strengthLabel}`,
    );
  }
}

// ---------- 6) defaults + normalization ----------

{
  // Omitting textStyleStrength should default to "medium" — i.e. unchanged
  // PR #23 behavior. We can verify by comparing against an explicit medium.
  const noStrength = generateNote(baseInput({ screenshotRef: makeRef(DRAMATIC_TEXT) }));
  const explicitMedium = runAt("medium", DRAMATIC_TEXT);
  // Outputs aren't deterministic across calls (Date.now / Math.random in
  // seed), but the resolved strength + summary must match.
  assert(noStrength.screenshotStyle?.text?.strength === "medium",
    `omitting strength should default to medium, got ${noStrength.screenshotStyle?.text?.strength}`);
  assert(explicitMedium.screenshotStyle?.text?.strength === "medium",
    `explicit medium should resolve to medium`);
  assert(DEFAULT_TEXT_STYLE_STRENGTH === "medium",
    `DEFAULT_TEXT_STYLE_STRENGTH should be 'medium'`);
  assert(normalizeTextStyleStrength(undefined) === "medium", "undefined -> medium");
  assert(normalizeTextStyleStrength(null) === "medium", "null -> medium");
  assert(normalizeTextStyleStrength("bogus") === "medium", "bogus -> medium");
  assert(normalizeTextStyleStrength("light") === "light", "light passthrough");
  assert(normalizeTextStyleStrength("high") === "high", "high passthrough");
}

// ---------- 7) create.tsx wires the segmented control ----------

{
  const createPath = join(import.meta.dirname, "..", "client", "src", "pages", "create.tsx");
  const createSrc = readFileSync(createPath, "utf-8");
  assert(
    createSrc.includes('data-testid="screenshot-text-strength-control"'),
    "create.tsx must render the strength control container",
  );
  // The testid is built from a template literal at render time, so we match
  // on the static prefix that uniquely identifies the segmented control.
  assert(
    createSrc.includes("button-text-strength-${level}") ||
      TEXT_STYLE_STRENGTH_LEVELS.every((level) =>
        createSrc.includes(`button-text-strength-${level}`),
      ),
    "create.tsx must render a button for each strength level",
  );
  // The levels are sourced from TEXT_STYLE_STRENGTH_LEVELS, which must be
  // imported and rendered. Sanity check both.
  assert(
    createSrc.includes("TEXT_STYLE_STRENGTH_LEVELS"),
    "create.tsx must iterate TEXT_STYLE_STRENGTH_LEVELS to render the segmented control",
  );
  assert(
    createSrc.includes("文字风格模仿强度"),
    "create.tsx must show the Chinese control label",
  );
  assert(
    createSrc.includes("setTextStyleStrength"),
    "create.tsx must wire setTextStyleStrength",
  );
  // No browser storage may sneak in via this feature.
  assert(
    !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(createSrc),
    "create.tsx must not introduce browser-storage usage",
  );
}

console.log("OK: text-style strength smoke assertions passed.");
