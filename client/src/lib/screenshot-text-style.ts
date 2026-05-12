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
// of the original phrasing. Pure / deterministic on (base, profile).
export function applyTextStyleToTitle(base: string, p: ScreenshotTextStyleProfile): string {
  if (!p.hasText) return base;
  let out = base.trim();
  if (!out) return out;

  // Drama: ensure at least !! and (optionally) one strong emoji from the
  // learned pool. Never add more than one emoji and never duplicate.
  if (p.tone === "dramatic") {
    if (p.punctIntensity >= 1 && !/[!！?？]{2,}/.test(out)) {
      const wantsQuestion =
        p.cues.includes("question_burst") && !p.cues.includes("exclamation_burst");
      const mark = wantsQuestion ? "？？" : "!!";
      if (/[!！?？]$/.test(out)) out = out.slice(0, -1) + mark;
      else out = `${out}${mark}`;
    }
    const tail = p.detectedEmoji.filter((e) => STRONG_EMOJI.has(e));
    if (tail.length > 0 && !tail.some((e) => out.includes(e))) {
      const idx = stringHash(out) % tail.length;
      out = `${out}${tail[idx]}`;
    }
  }

  // Healing: append a soft register token if not already present.
  if (p.tone === "healing" && !/(治愈|超治愈|温柔|轻轻|柔软|奶系)/.test(out)) {
    out = `${out}·好治愈`;
  }

  // Premium: append a 高级 / 沉静 token if not already present.
  if (p.tone === "premium" && !/(高级|沉静|质感|低调|不动声色|讲究)/.test(out)) {
    out = `${out}·有质感`;
  }

  // Playful: terminal particle swap. Only nudge a 。-ending title to 啦.
  if (p.tone === "playful" && /。$/.test(out)) {
    out = out.replace(/。$/, "啦");
  }
  return out;
}

// Decorate the body opening line based on the learned tone & cues. Same
// guarantees as the title decorator: deterministic, no verbatim copy of any
// reference phrasing, never alters the user's actual section content.
export function applyTextStyleToBodyOpening(opening: string, p: ScreenshotTextStyleProfile): string {
  if (!p.hasText) return opening;
  let out = opening;
  if (p.cues.includes("vocative_opener") && !/^(姐妹|宝子|家人们|兄弟们|uu们|集美)/.test(out)) {
    // Pick a stable vocative from a fixed pool (not from the OCR text — we
    // never echo the source). Hash on the opening to stay deterministic.
    const pool = ["姐妹们", "宝子们", "家人们"];
    out = `${pool[stringHash(out) % pool.length]}，${out}`;
  }
  if (p.tone === "dramatic" && !/[!！]{2,}/.test(out)) {
    out = out.replace(/[。!！]?$/, "!!");
  } else if (p.tone === "healing" && !/^(悄悄说|轻轻地|慢慢地)/.test(out)) {
    out = `悄悄说一句，${out}`;
  } else if (p.tone === "premium" && !/^(夜色|安静|不动声色|沉静地)/.test(out)) {
    out = `不动声色地讲一句，${out}`;
  } else if (p.tone === "playful" && /。$/.test(out)) {
    out = out.replace(/。$/, "啦~");
  }
  return out;
}

// Decorate the closing line if the reference has strong CTA cues. We never
// copy the exact reference CTA; we pick from a fixed bank of generic ones
// that match the cue family.
export function applyTextStyleToClosing(closing: string, p: ScreenshotTextStyleProfile): string {
  if (!p.hasText) return closing;
  let out = closing;
  if (p.cues.includes("cta_collect") && !/(收藏|抄作业|码住|存起来|存一下)/.test(out)) {
    out = `${out.replace(/[。！？]$/, "")}，记得先码住再说。`;
  } else if (p.cues.includes("cta_comment") && !/(蹲|评论区|想问|有没有)/.test(out)) {
    out = `${out.replace(/[。！？]$/, "")}，评论区蹲一个同款入住的姐妹。`;
  }
  return out;
}

export function textStyleWarningMessage(p: ScreenshotTextStyleProfile): string | null {
  if (!p.hasText) return null;
  const tone = TONE_LABELS[p.tone];
  return `已学习参考截图文字风格（${tone}）：本次生成的标题、正文与结尾会沿用此节奏与语感，但不会复制原文。`;
}
