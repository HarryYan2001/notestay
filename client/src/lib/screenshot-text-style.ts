// Deterministic style analyzer for the TEXTUAL content of a target Xiaohongshu
// note that the user uploaded as a screenshot. Companion to screenshot-style.ts
// which learns visual / image cues from the same screenshot.
//
// This module takes the raw OCR string (whatever an OCR engine recognized in
// the screenshot — including titles, body paragraphs and hashtags) and returns
// a `ScreenshotTextStyleProfile`. The profile captures METHOD only:
//   - emoji density / preferred emoji set
//   - punctuation rhythm (!! / ？？ / …)
//   - average sentence length & paragraph rhythm
//   - opener / vocative pattern (姐妹们 / 宝子 / 真的, …)
//   - tone register (dramatic / 治愈 / 高级 / 平实)
//   - call-to-action / comment hook patterns (蹲一个 / 求 / 收藏 / 评论)
//   - hashtag usage pattern (count + sample tag stems, for hint-only)
//
// Pure data only — we NEVER copy the original copy verbatim into generated
// output. The profile drives small, targeted decorators on the generated
// title and body opening, similar to applyScreenshotTitleStyle.

// ---------- public types ----------

export type TextTone =
  | "dramatic"      // 强情绪 / 大量感叹号 / 哭脸 emoji
  | "healing"       // 治愈 / 温柔 / 轻轻 / 悄悄
  | "premium"       // 高级 / 沉静 / 不动声色 / 质感
  | "playful"       // 口语 / 哈哈 / 啊啊 / 啦
  | "informative";  // 平实陈述，无明显情绪

export type TextCue =
  | "heavy_emoji"          // emoji density >= 6%
  | "exclamation_burst"    // !! / ！！ runs
  | "question_burst"       // ？？ / ?? runs
  | "ellipsis_pacing"      // …… 用于情绪停顿
  | "short_punchy"         // avg sentence length < 12 zh chars
  | "long_storytelling"    // avg sentence length > 28 zh chars
  | "vocative_opener"      // 姐妹们 / 宝子 / 家人们 …
  | "first_person_drama"   // 我 + strong emoji or repeated punct
  | "healing_register"     // 治愈 / 温柔 / 轻轻 / 慢慢 …
  | "premium_register"     // 高级 / 沉静 / 质感 / 低调 …
  | "playful_register"     // 哈哈 / 啊啊 / 啦 / 嘛 …
  | "cta_collect"          // 收藏 / 抄作业 / 存一下
  | "cta_comment"          // 蹲 / 求 / 评论 / 想问
  | "hashtag_pattern"      // multiple #标签 detected
  | "section_emoji_heads"; // emoji + label pattern (📍 位置 / 🍳 早餐 …)

export interface ScreenshotTextStyleProfile {
  // True when the OCR step gave us a non-trivial text payload to analyze.
  hasText: boolean;
  // Total recognized characters (after normalization). 0 when hasText is false.
  charCount: number;
  // Number of CJK characters — used to gate noise (latin-only OCR noise from
  // logos / watermarks should NOT count as "learned text style").
  cjkCount: number;
  // Dominant tone. Defaults to "informative" when no strong register fires.
  tone: TextTone;
  // Ordered, deduped cue list.
  cues: TextCue[];
  // Up to 6 emoji we saw, in the order we first encountered them. Used as a
  // hint pool when bending titles toward the reference. Never inserted as-is
  // into body content.
  detectedEmoji: string[];
  // Punctuation intensity 0..3.
  punctIntensity: number;
  // Average sentence length in CJK chars (rounded).
  avgSentenceLen: number;
  // Approximate hashtag count detected (capped at 12 for safety).
  hashtagCount: number;
  // Short human-readable status — surfaced under the OCR panel in the UI.
  status: string;
}

const CUE_LABELS: Record<TextCue, string> = {
  heavy_emoji: "高频 emoji",
  exclamation_burst: "重复感叹",
  question_burst: "重复问号",
  ellipsis_pacing: "省略号节奏",
  short_punchy: "短句爆点",
  long_storytelling: "长句叙事",
  vocative_opener: "呼语开头",
  first_person_drama: "第一人称戏剧化",
  healing_register: "治愈语感",
  premium_register: "高级 / 沉静",
  playful_register: "口语化",
  cta_collect: "收藏号召",
  cta_comment: "互动钩子",
  hashtag_pattern: "多标签收尾",
  section_emoji_heads: "emoji 小标题",
};

const TONE_LABELS: Record<TextTone, string> = {
  dramatic: "强情绪 / 爆款",
  healing: "治愈 / 温柔",
  premium: "高级 / 沉静",
  playful: "口语 / 活泼",
  informative: "平实陈述",
};

export const TEXT_CUE_LABELS = CUE_LABELS;
export const TEXT_TONE_LABELS = TONE_LABELS;

// ---------- imitation strength ----------

// Public label set + ordering for the segmented control in create.tsx. The
// generator and decorators receive a `TextStyleStrength` directly; these are
// only here so UI code has a single source of truth.
export type TextStyleStrength = "light" | "medium" | "high";

export const TEXT_STYLE_STRENGTH_LEVELS: TextStyleStrength[] = ["light", "medium", "high"];

export const TEXT_STYLE_STRENGTH_LABELS: Record<TextStyleStrength, string> = {
  light: "轻度",
  medium: "中度",
  high: "高度",
};

export const TEXT_STYLE_STRENGTH_DESCRIPTIONS: Record<TextStyleStrength, string> = {
  light: "只学习语气和标题节奏，保留 NoteStay 原生成框架更多",
  medium: "平衡参考风格与你的素材，默认推荐",
  high: "更强地模仿标题节奏、emoji 密度、口吻与 CTA，不复制原文",
};

export const DEFAULT_TEXT_STYLE_STRENGTH: TextStyleStrength = "medium";

export function normalizeTextStyleStrength(s: string | null | undefined): TextStyleStrength {
  if (s === "light" || s === "medium" || s === "high") return s;
  return DEFAULT_TEXT_STYLE_STRENGTH;
}

// ---------- keyword banks ----------

const STRONG_EMOJI = new Set([
  "😭", "😢", "🥲", "🥹", "😱", "😤", "😡", "🤬",
  "😆", "😂", "🤣", "😅", "😳",
  "💔", "🆘", "😩", "😫",
]);

const VOCATIVE_OPENERS = ["姐妹们", "姐妹", "宝子们", "宝子", "家人们", "兄弟们", "uu们", "uu", "集美们", "集美"];

const HEALING_KEYWORDS = ["治愈", "温柔", "轻轻", "慢慢", "悄悄", "柔软", "奶系", "心动", "心安", "暖暖", "好治愈"];
const PREMIUM_KEYWORDS = ["高级", "沉静", "质感", "低调", "不动声色", "克制", "讲究", "考究", "厚重", "稳"];
const PLAYFUL_PARTICLES = ["哈哈", "啊啊", "嘿嘿", "嘻嘻", "呜呜", "啦", "嘛", "诶", "呀", "鸭", "辣"];

const CTA_COLLECT = ["收藏", "抄作业", "存一下", "码住", "码一下", "存起来", "记一下"];
const CTA_COMMENT = ["蹲一个", "蹲", "求推荐", "求", "评论区", "想问", "问下", "在线等", "有没有"];

const FIRST_PERSON_ANCHORS = ["我", "本人", "本姐妹", "本宝"];

// Emoji + Chinese label pattern: 📍 位置 / 🍳 早餐 / 🛏️ 房间 …
// We count occurrences via two stages (codepoint scan + label lookahead) to
// avoid a `u`-flagged regex, which the current tsconfig target rejects.
function countSectionHeads(text: string): number {
  let count = 0;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const code = ch.codePointAt(0) ?? 0;
    const isEmoji =
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x1f900 && code <= 0x1f9ff);
    if (!isEmoji) continue;
    // Look ahead, skipping VS16 / ZWJ, for at least one CJK char within the
    // next 1..7 positions.
    for (let j = i + 1; j < Math.min(chars.length, i + 8); j++) {
      const next = chars[j];
      const ncode = next.codePointAt(0) ?? 0;
      if (ncode === 0xfe0f || ncode === 0x200d || next === " ") continue;
      if (/[一-鿿]/.test(next)) {
        count++;
        break;
      }
      break;
    }
  }
  return count;
}

// ---------- helpers ----------

function extractEmoji(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x1f900 && code <= 0x1f9ff)
    ) {
      if (!out.includes(ch)) out.push(ch);
      if (out.length >= 12) break;
    }
  }
  return out;
}

function countEmoji(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x1f900 && code <= 0x1f9ff)
    ) {
      n++;
    }
  }
  return n;
}

function countCjk(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (/[一-鿿]/.test(ch)) n++;
  }
  return n;
}

function countPunctIntensity(text: string): number {
  const exclaim = (text.match(/[!！]{2,}/g) ?? []).length;
  const question = (text.match(/[?？]{2,}/g) ?? []).length;
  const ellipsis = (text.match(/(?:\.{3,}|…+)/g) ?? []).length;
  const score = exclaim * 2 + question + ellipsis;
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  if (score >= 1) return 1;
  return 0;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?…\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countHashtags(text: string): number {
  const matches = text.match(/#[^\s#，,。！!？?]{1,30}/g) ?? [];
  return Math.min(12, matches.length);
}

// ---------- main analyzer ----------

export function analyzeScreenshotText(rawText: string | undefined | null): ScreenshotTextStyleProfile {
  const text = (rawText ?? "").trim();
  if (!text) return emptyTextProfile();

  const cjkCount = countCjk(text);
  // Reject tiny / latin-only payloads as noise. We need at least a small
  // CJK signal to safely derive a tone. Watermarks / logos / nav text without
  // any Chinese should not be treated as "learned style".
  if (cjkCount < 6) return emptyTextProfile();

  const emoji = extractEmoji(text);
  const emojiCount = countEmoji(text);
  const punctIntensity = countPunctIntensity(text);
  const sentences = splitSentences(text);
  const sentenceLens = sentences.map(countCjk).filter((n) => n > 0);
  const avgSentenceLen =
    sentenceLens.length > 0
      ? Math.round(sentenceLens.reduce((a, b) => a + b, 0) / sentenceLens.length)
      : 0;
  const hashtagCount = countHashtags(text);
  const sectionHeadMatches = countSectionHeads(text);

  // ---- cue detection ----
  const cuesSet = new Set<TextCue>();

  // Emoji density: emojiCount relative to CJK content.
  if (cjkCount > 0 && emojiCount / Math.max(1, cjkCount) >= 0.04) {
    cuesSet.add("heavy_emoji");
  }
  if (/[!！]{2,}/.test(text)) cuesSet.add("exclamation_burst");
  if (/[?？]{2,}/.test(text)) cuesSet.add("question_burst");
  if (/…{2,}|\.{3,}/.test(text)) cuesSet.add("ellipsis_pacing");
  if (avgSentenceLen > 0 && avgSentenceLen < 12) cuesSet.add("short_punchy");
  if (avgSentenceLen >= 28) cuesSet.add("long_storytelling");

  if (VOCATIVE_OPENERS.some((k) => text.includes(k))) cuesSet.add("vocative_opener");
  if (HEALING_KEYWORDS.some((k) => text.includes(k))) cuesSet.add("healing_register");
  if (PREMIUM_KEYWORDS.some((k) => text.includes(k))) cuesSet.add("premium_register");
  if (PLAYFUL_PARTICLES.some((k) => text.includes(k))) cuesSet.add("playful_register");
  if (CTA_COLLECT.some((k) => text.includes(k))) cuesSet.add("cta_collect");
  if (CTA_COMMENT.some((k) => text.includes(k))) cuesSet.add("cta_comment");
  if (hashtagCount >= 2) cuesSet.add("hashtag_pattern");
  if (sectionHeadMatches >= 2) cuesSet.add("section_emoji_heads");

  const hasStrongEmoji = emoji.some((e) => STRONG_EMOJI.has(e));
  if (
    FIRST_PERSON_ANCHORS.some((k) => text.includes(k)) &&
    (hasStrongEmoji || punctIntensity >= 2 || cuesSet.has("exclamation_burst"))
  ) {
    cuesSet.add("first_person_drama");
  }

  // ---- tone classification (single dominant tone) ----
  // We score each tone and pick the highest. Ties fall back in this order.
  const scores: Record<TextTone, number> = {
    dramatic: 0,
    healing: 0,
    premium: 0,
    playful: 0,
    informative: 0,
  };
  scores.dramatic +=
    (cuesSet.has("exclamation_burst") ? 2 : 0) +
    (cuesSet.has("question_burst") ? 1 : 0) +
    (hasStrongEmoji ? 2 : 0) +
    (cuesSet.has("first_person_drama") ? 1 : 0) +
    (cuesSet.has("heavy_emoji") ? 1 : 0);
  scores.healing +=
    (cuesSet.has("healing_register") ? 3 : 0) +
    (cuesSet.has("ellipsis_pacing") ? 1 : 0) +
    (cuesSet.has("long_storytelling") ? 1 : 0);
  scores.premium +=
    (cuesSet.has("premium_register") ? 3 : 0) +
    (cuesSet.has("long_storytelling") ? 1 : 0);
  scores.playful +=
    (cuesSet.has("playful_register") ? 2 : 0) +
    (cuesSet.has("vocative_opener") ? 1 : 0) +
    (cuesSet.has("short_punchy") ? 1 : 0);
  // Informative gets a small floor so it wins when nothing else fires.
  scores.informative = 0.5;

  let tone: TextTone = "informative";
  let best = -1;
  // Iterate in priority order so ties resolve deterministically.
  for (const t of ["dramatic", "healing", "premium", "playful", "informative"] as TextTone[]) {
    if (scores[t] > best) {
      best = scores[t];
      tone = t;
    }
  }

  // Stable ordering for display.
  const orderedCues: TextCue[] = (
    [
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
    ] as TextCue[]
  ).filter((c) => cuesSet.has(c));

  const status = buildStatus(tone, orderedCues);

  return {
    hasText: true,
    charCount: text.length,
    cjkCount,
    tone,
    cues: orderedCues,
    detectedEmoji: emoji.slice(0, 6),
    punctIntensity,
    avgSentenceLen,
    hashtagCount,
    status,
  };
}

export function emptyTextProfile(): ScreenshotTextStyleProfile {
  return {
    hasText: false,
    charCount: 0,
    cjkCount: 0,
    tone: "informative",
    cues: [],
    detectedEmoji: [],
    punctIntensity: 0,
    avgSentenceLen: 0,
    hashtagCount: 0,
    status: "未在截图中识别到可学习的文字，仅根据图片像素学习视觉风格。",
  };
}

function buildStatus(tone: TextTone, cues: TextCue[]): string {
  const toneLabel = TONE_LABELS[tone];
  if (cues.length === 0) {
    return `已识别为${toneLabel}文字风格，本次生成将参考此基调。`;
  }
  const labels = cues.map((c) => CUE_LABELS[c]).slice(0, 5);
  return `已学习${toneLabel}文字风格：${labels.join(" / ")}`;
}

// ---------- decorators consumed by generate.ts ----------

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h || 1;
}

// Bend the generated title toward the learned text-tone WITHOUT copying any
// of the original phrasing. Pure / deterministic on (base, profile, strength).
//
// Strength scaling:
//   - light:  no punctuation burst, no emoji append, no register suffix; only
//             the playful terminal-particle swap survives because it is a
//             single-character cosmetic change that doesn't alter framing.
//   - medium: PR #23 behavior — punctuation burst + at most one strong emoji
//             for dramatic; register suffix for healing/premium.
//   - high:   adds a second strong emoji for dramatic, doubles the register
//             suffix to a stronger phrase for healing/premium, and forces a
//             playful particle swap even on titles without a trailing 。.
export function applyTextStyleToTitle(
  base: string,
  p: ScreenshotTextStyleProfile,
  strength: TextStyleStrength = DEFAULT_TEXT_STYLE_STRENGTH,
): string {
  if (!p.hasText) return base;
  let out = base.trim();
  if (!out) return out;

  if (p.tone === "dramatic") {
    if (strength !== "light" && p.punctIntensity >= 1 && !/[!！?？]{2,}/.test(out)) {
      const wantsQuestion =
        p.cues.includes("question_burst") && !p.cues.includes("exclamation_burst");
      const baseMark = wantsQuestion ? "？？" : "!!";
      // High strength leans harder on the punctuation burst.
      const mark = strength === "high" ? (wantsQuestion ? "？？？" : "!!!") : baseMark;
      if (/[!！?？]$/.test(out)) out = out.slice(0, -1) + mark;
      else out = `${out}${mark}`;
    }
    const tail = p.detectedEmoji.filter((e) => STRONG_EMOJI.has(e));
    if (strength !== "light" && tail.length > 0 && !tail.some((e) => out.includes(e))) {
      const idx = stringHash(out) % tail.length;
      out = `${out}${tail[idx]}`;
      // High strength may stack a second distinct strong emoji.
      if (strength === "high" && tail.length > 1) {
        const second = tail[(idx + 1) % tail.length];
        if (second !== tail[idx]) out = `${out}${second}`;
      }
    }
  }

  if (p.tone === "healing" && !/(治愈|超治愈|温柔|轻轻|柔软|奶系)/.test(out)) {
    if (strength === "high") out = `${out}·超治愈奶系感`;
    else if (strength === "medium") out = `${out}·好治愈`;
    // light: leave the title alone — only opening will hint at healing.
  }

  if (p.tone === "premium" && !/(高级|沉静|质感|低调|不动声色|讲究)/.test(out)) {
    if (strength === "high") out = `${out}·不动声色的高级感`;
    else if (strength === "medium") out = `${out}·有质感`;
    // light: leave the title alone.
  }

  if (p.tone === "playful") {
    if (/。$/.test(out)) {
      // All strengths swap a terminal 。 → 啦 — it's a one-character cosmetic
      // touch, not aggressive framing.
      out = out.replace(/。$/, "啦");
    } else if (strength === "high" && !/[啦呀鸭哒嘛]$/.test(out) && !/[!！?？]$/.test(out)) {
      out = `${out}啦`;
    }
  }
  return out;
}

// Decorate the body opening line based on the learned tone & cues. Same
// guarantees as the title decorator: deterministic, no verbatim copy of any
// reference phrasing, never alters the user's actual section content.
//
// Strength scaling:
//   - light:  skip the vocative prepend entirely and skip strong tone
//             rewrites; only soft swaps (playful 。→啦~) survive. The hook
//             keeps NoteStay's native voice while letting the title still
//             carry a tone hint.
//   - medium: PR #23 behavior — vocative + tone-specific opener rewrite.
//   - high:   adds a stronger vocative phrase ("姐妹们听我说，") and pushes
//             the dramatic opener to a heavier !!! tail.
export function applyTextStyleToBodyOpening(
  opening: string,
  p: ScreenshotTextStyleProfile,
  strength: TextStyleStrength = DEFAULT_TEXT_STYLE_STRENGTH,
): string {
  if (!p.hasText) return opening;
  let out = opening;
  if (
    strength !== "light" &&
    p.cues.includes("vocative_opener") &&
    !/^(姐妹|宝子|家人们|兄弟们|uu们|集美)/.test(out)
  ) {
    // Pick a stable vocative from a fixed pool (not from the OCR text — we
    // never echo the source). Hash on the opening to stay deterministic.
    const pool = ["姐妹们", "宝子们", "家人们"];
    const head = pool[stringHash(out) % pool.length];
    out = strength === "high" ? `${head}听我说，${out}` : `${head}，${out}`;
  }
  if (strength === "light") {
    // Light only does the cheapest cosmetic playful swap.
    if (p.tone === "playful" && /。$/.test(out)) {
      out = out.replace(/。$/, "啦~");
    }
    return out;
  }
  if (p.tone === "dramatic" && !/[!！]{2,}/.test(out)) {
    const tail = strength === "high" ? "!!!" : "!!";
    out = out.replace(/[。!！]?$/, tail);
  } else if (p.tone === "healing" && !/^(悄悄说|轻轻地|慢慢地)/.test(out)) {
    out = strength === "high" ? `轻轻地讲，悄悄说一句，${out}` : `悄悄说一句，${out}`;
  } else if (p.tone === "premium" && !/^(夜色|安静|不动声色|沉静地)/.test(out)) {
    out = strength === "high"
      ? `不动声色地讲一句，沉静地说，${out}`
      : `不动声色地讲一句，${out}`;
  } else if (p.tone === "playful" && /。$/.test(out)) {
    out = out.replace(/。$/, "啦~");
  }
  return out;
}

// Decorate the closing line if the reference has strong CTA cues. We never
// copy the exact reference CTA; we pick from a fixed bank of generic ones
// that match the cue family.
//
// Strength scaling:
//   - light:  no CTA hook is appended — the user's natural closing stays.
//   - medium: PR #23 behavior — append one CTA hook tied to the cue family.
//   - high:   append a longer, more emphatic CTA phrase; when both collect
//             AND comment cues fired, stack both hooks.
export function applyTextStyleToClosing(
  closing: string,
  p: ScreenshotTextStyleProfile,
  strength: TextStyleStrength = DEFAULT_TEXT_STYLE_STRENGTH,
): string {
  if (!p.hasText || strength === "light") return closing;
  let out = closing;
  const hasCollect = p.cues.includes("cta_collect");
  const hasComment = p.cues.includes("cta_comment");
  const stripTail = (s: string) => s.replace(/[。！？]$/, "");
  if (hasCollect && !/(收藏|抄作业|码住|存起来|存一下)/.test(out)) {
    out = strength === "high"
      ? `${stripTail(out)}，看到这条记得先码住再说，下次想出片就直接抄作业。`
      : `${stripTail(out)}，记得先码住再说。`;
  }
  if (hasComment && !/(蹲|评论区|想问|有没有)/.test(out)) {
    if (strength === "high") {
      out = `${stripTail(out)}，评论区蹲一个同款入住的姐妹，有想问的也尽管来戳我。`;
    } else if (!hasCollect) {
      // medium: only one CTA hook total — don't stack with the collect hook.
      out = `${stripTail(out)}，评论区蹲一个同款入住的姐妹。`;
    }
  }
  return out;
}

export function textStyleWarningMessage(
  p: ScreenshotTextStyleProfile,
  strength: TextStyleStrength = DEFAULT_TEXT_STYLE_STRENGTH,
): string | null {
  if (!p.hasText) return null;
  const tone = TONE_LABELS[p.tone];
  const strengthLabel = TEXT_STYLE_STRENGTH_LABELS[strength];
  return `已学习参考截图文字风格（${tone}·${strengthLabel}模仿）：本次生成的标题、正文段落与结尾会沿用此节奏与语感，但不会复制原文。`;
}

// ---------- body-section transformer ----------
//
// Rewrites the body of an emoji-headed section so that the OCR-learned text
// style is visible in the 正文 paragraphs, not just in the title / opening /
// closing decorators. This is the function the user is complaining is
// missing — without it, sections still read in NoteStay's default voice no
// matter what the reference tone says.
//
// Inputs:
//   - sectionText: user-derived body of one section, AFTER stripBanned and
//     naturalizeUserLine have run. Always non-empty, may contain multiple
//     sentences joined with sentence-ending punctuation.
//   - p: learned text profile.
//   - strength: light / medium / high.
//   - seed: stable integer (e.g. the generator's seed + section index) so
//     emoji / vocative / particle picks are deterministic for the same
//     inputs and don't churn between regenerations.
//   - sectionIndex: 0-based index of this section in the body. Used to
//     decide where vocatives / CTA hooks land — they should not appear on
//     every section.
//
// Strict guarantees (covered by smoke tests):
//   - Never copies any phrase from `p` (we only use fixed in-code pools).
//   - Never invents hotel facts — the user's words remain intact; we only
//     rephrase rhythm, append particles/emoji, or rewire punctuation.
//   - Light strength returns the input unchanged for tones other than
//     `playful` (whose terminal 。→啦~ swap is purely cosmetic).
//   - High strength is strictly more decorated than light (more particles,
//     more emoji, stronger punctuation, vocative insertion).
//
// The transformer is intentionally additive: it rewrites/insets but never
// deletes the user's substantive nouns, brands, room types, etc.
export function applyTextStyleToBodySection(
  sectionText: string,
  p: ScreenshotTextStyleProfile,
  strength: TextStyleStrength,
  seed: number,
  sectionIndex: number,
): string {
  if (!p.hasText) return sectionText;
  const raw = sectionText.trim();
  if (!raw) return sectionText;
  if (strength === "light") {
    return lightBodyDecorate(raw, p, seed);
  }
  // Split into sentences, transform each, re-join.
  const sentences = splitSentencesWithPunct(raw);
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    out.push(
      transformSentence(
        s,
        p,
        strength,
        seed + i * 31 + sectionIndex * 17,
        i,
        sentences.length,
        sectionIndex,
      ),
    );
  }
  let joined = out.join("");
  // High-strength vocative injection: prepend a tone-appropriate vocative
  // ONLY to the first section's body (sectionIndex===0) and only when the
  // reference actually used vocatives. Avoids stacking with the opening's
  // own vocative — we check that the section doesn't already start with one.
  if (
    strength === "high" &&
    sectionIndex === 0 &&
    p.cues.includes("vocative_opener") &&
    !/^(姐妹们|宝子们|家人们|兄弟们|uu们|集美们)/.test(joined)
  ) {
    const pool = ["姐妹们", "宝子们", "家人们"];
    const head = pool[Math.abs(seed) % pool.length];
    joined = `${head}，${joined}`;
  }
  // High-strength CTA tail injection on the LAST section: if the reference
  // exhibits CTA cues, append a one-line nudge using a fixed bank (never
  // copies source phrasing). Closing-line decoration already exists for
  // the body's literal closing line; this one targets the last section
  // body so the in-section pacing also reads CTA-driven.
  if (
    strength === "high" &&
    sectionIndex === -1 // signal handled by caller — see generate.ts
  ) {
    // no-op — reserved for future use; the caller does CTA injection itself.
  }
  return joined;
}

// Convenience: apply the section transform across a list of sections. The
// caller still controls section ordering — we only rewrite text in place.
export function applyTextStyleToBodySections<
  S extends { text: string },
>(
  sections: S[],
  p: ScreenshotTextStyleProfile,
  strength: TextStyleStrength,
  seed: number,
): S[] {
  if (!p.hasText) return sections;
  return sections.map((s, i) => ({
    ...s,
    text: applyTextStyleToBodySection(s.text, p, strength, seed, i),
  }));
}

// ---------- internal helpers ----------

// Strong (high-emotion) emoji pool. We never echo `p.detectedEmoji` directly
// when transforming the body — we restrict to this safe set indexed by the
// reference's dominant tone, plus a fallback to detectedEmoji intersected
// with the safe set.
const SAFE_EMOJI: Record<TextTone, string[]> = {
  dramatic: ["😭", "🥹", "😱", "😆", "💖"],
  healing: ["🌿", "🍃", "🤍", "☁️"],
  premium: ["🕯️", "🥃", "🌙"],
  playful: ["🤭", "🫶", "💫"],
  informative: [],
};

// Pick an emoji deterministically. Prefer the reference's detected emoji
// that ALSO appears in our safe pool — this lets the reference's flavour
// come through without copying anything unusual. Falls back to the safe
// pool keyed by tone.
function pickToneEmoji(p: ScreenshotTextStyleProfile, seed: number): string | null {
  const pool = SAFE_EMOJI[p.tone];
  if (pool.length === 0) return null;
  const detectedSafe = p.detectedEmoji.filter((e) => pool.includes(e));
  const chosen = detectedSafe.length > 0 ? detectedSafe : pool;
  return chosen[Math.abs(seed) % chosen.length];
}

function splitSentencesWithPunct(text: string): string[] {
  // Walk char-by-char; emit a sentence each time we hit one of 。！？!?…
  // The terminator is included with the preceding sentence so re-joining
  // is a simple concat. Trailing fragments without a terminator are kept
  // as-is so we don't accidentally drop user content.
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (/[。！？!?…]/.test(ch)) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

// Light strength: only the cheapest cosmetic transforms. We never prepend
// vocatives, never rewire punctuation across the whole sentence, and never
// add emoji. We only swap a terminal 。 → 啦~ for the playful register —
// that's the same rule the opening decorator uses.
function lightBodyDecorate(
  text: string,
  p: ScreenshotTextStyleProfile,
  _seed: number,
): string {
  if (p.tone !== "playful") return text;
  return text.replace(/。(?=$|\n)/g, "啦~");
}

// Tone-specific sentence transform. Operates on ONE sentence at a time so
// we don't accidentally smash multi-sentence semantics together.
function transformSentence(
  sentence: string,
  p: ScreenshotTextStyleProfile,
  strength: TextStyleStrength,
  seed: number,
  sentenceIdx: number,
  totalSentences: number,
  sectionIndex: number,
): string {
  let out = sentence;
  const trailing = out.match(/[。！？!?…]$/)?.[0] ?? "";
  const stem = trailing ? out.slice(0, -trailing.length) : out;
  if (!stem.trim()) return out;

  // Punctuation rewrite based on tone.
  let newTail = trailing;
  if (p.tone === "dramatic") {
    if (trailing === "。") {
      newTail = strength === "high" ? "！！！" : "！！";
    } else if (trailing === "！" || trailing === "!") {
      newTail = strength === "high" ? "！！！" : "！！";
    }
  } else if (p.tone === "healing") {
    // Healing prefers softer pauses. Convert a trailing 。 to … for high
    // strength only — medium keeps natural sentence ends but adds an
    // emoji (see below).
    if (trailing === "。" && strength === "high") {
      newTail = "……";
    }
  } else if (p.tone === "playful") {
    if (trailing === "。") {
      newTail = strength === "high" ? "啦~" : "啦";
    }
  } else if (p.tone === "premium") {
    // Premium prefers measured 。 — we keep punctuation but lean on
    // long_storytelling rhythm instead.
    newTail = trailing;
  }

  // Tone-prefix injection: dramatic / healing / premium / playful get a
  // short stem prefix to seed the rhythm. Medium uses one phrase, high
  // uses a longer, more emphatic variant. We only inject on a fraction
  // of sentences so the whole paragraph doesn't feel mechanical.
  const wantsPrefix =
    (strength === "high" && sentenceIdx === 0) ||
    (strength === "medium" && sentenceIdx === 0 && sectionIndex === 0);
  let body = stem.trim();
  if (wantsPrefix) {
    const prefix = pickTonePrefix(p, strength, seed);
    if (prefix && !alreadyStartsWith(body, prefix)) {
      body = `${prefix}${body}`;
    }
  }

  // Inline vocative for high strength: middle of a long section (not the
  // first or last sentence) and only when the reference used a vocative.
  if (
    strength === "high" &&
    p.cues.includes("vocative_opener") &&
    totalSentences >= 3 &&
    sentenceIdx === Math.floor(totalSentences / 2) &&
    !/姐妹|宝子|家人们|兄弟们|uu们|集美/.test(body)
  ) {
    const pool = ["姐妹们", "宝子们"];
    const head = pool[Math.abs(seed) % pool.length];
    body = `${head}讲真，${body}`;
  }

  // Particle suffix for the playful register (high strength only —
  // medium already swapped 。→啦 above).
  if (p.tone === "playful" && strength === "high") {
    if (!/[啦呀鸭哒嘛~]$/.test(body)) {
      const particles = ["呀", "鸭", "哒"];
      const pick = particles[Math.abs(seed + 3) % particles.length];
      body = `${body}${pick}`;
    }
  }

  // Append a tone emoji on selected sentences. Frequency scales with
  // strength: medium adds one on the first sentence of a section,
  // high adds one on every sentence when the reference is heavy_emoji
  // or dramatic, every other sentence otherwise.
  const emojiBudget =
    strength === "high"
      ? (p.cues.includes("heavy_emoji") || p.tone === "dramatic" ? 1 : sentenceIdx % 2 === 0 ? 1 : 0)
      : (sentenceIdx === 0 && (p.cues.includes("heavy_emoji") || p.tone === "dramatic" || p.tone === "healing") ? 1 : 0);
  if (emojiBudget > 0) {
    const emoji = pickToneEmoji(p, seed);
    if (emoji && !body.includes(emoji)) {
      body = `${body}${emoji}`;
    }
  }

  return `${body}${newTail}`;
}

function alreadyStartsWith(body: string, prefix: string): boolean {
  // We compare on the first 6 characters of the prefix to allow small
  // variations (the prefix bank doesn't include rare exact duplicates).
  const probe = prefix.slice(0, 6);
  return body.slice(0, 8).includes(probe);
}

function pickTonePrefix(
  p: ScreenshotTextStyleProfile,
  strength: TextStyleStrength,
  seed: number,
): string | null {
  const idx = (n: number) => Math.abs(seed) % n;
  if (p.tone === "dramatic") {
    const medium = ["真的，", "讲真，", "实话说，"];
    const high = ["真的真的，", "姐妹听我说，", "我没夸张，"];
    const pool = strength === "high" ? high : medium;
    return pool[idx(pool.length)];
  }
  if (p.tone === "healing") {
    const medium = ["轻轻说，", "悄悄讲，", "慢慢看，"];
    const high = ["轻轻地告诉你，", "悄悄地凑过来讲，", "慢慢说一句，"];
    const pool = strength === "high" ? high : medium;
    return pool[idx(pool.length)];
  }
  if (p.tone === "premium") {
    const medium = ["静静讲，", "稳稳说，", "克制地讲，"];
    const high = ["不动声色地讲一句，", "沉静地铺开来说，", "讲究一点的话，"];
    const pool = strength === "high" ? high : medium;
    return pool[idx(pool.length)];
  }
  if (p.tone === "playful") {
    const medium = ["嘿嘿，", "哈哈，", "诶，"];
    const high = ["嘿嘿嘿，", "哎呀这就，", "哈哈说真的，"];
    const pool = strength === "high" ? high : medium;
    return pool[idx(pool.length)];
  }
  return null;
}
