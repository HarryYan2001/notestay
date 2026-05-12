// Deterministic style analyzer for a Xiaohongshu reference note.
//
// Static GitHub Pages deploys cannot do an outbound fetch of an arbitrary
// xiaohongshu.com URL — robots.txt / CORS / login-walls all block it. So this
// module never tries to fetch. It learns style cues from whatever the user
// pastes into the 爆款笔记学习 box: the share-card free text (which contains
// the original title between 【…】, the emoji-laden hook, and the deep-link),
// or just a bare URL.
//
// We only learn METHOD: emotional pitch, punctuation rhythm, emoji density,
// tone words, hook patterns. We never copy the original title or body verbatim
// into the generated note. Output is a `ViralStyleProfile` that the note
// generator can consume to push titles toward 强情绪/口语化/emoji and bodies
// toward a more conversational rhythm.

export type ViralCue =
  | "high_emotion_title"      // exclamation/crying-emoji loaded headline
  | "complaint_hook"          // 还我 / 怎么 / 为什么 / 救命 …
  | "first_person_drama"      // 我 / 姐妹 / 哭了 first-person framing
  | "repeated_punctuation"    // !! / ？？？ / …
  | "crying_or_strong_emoji"  // 😭 / 🥹 / 😱 / 😆 …
  | "playful_colloquial"      // 哈/哈哈/啊/呢/呀/嘛 colloquial particles
  | "suspense_curiosity"      // 居然 / 没想到 / 谁懂 / 谁能/到底 …
  | "travel_or_hotel_topic"   // 酒店/民宿/亚朵/全季/入住/旅行 …
  | "xhs_share_format";       // had 【…】 wrapper or share-token like hsj…

export interface ViralStyleProfile {
  // True when the user actually supplied something in the box.
  hasInput: boolean;
  // Raw input the user pasted (trimmed). Empty when hasInput is false.
  rawInput: string;
  // True when we detected an xiaohongshu.com URL or `xhslink.com` share link.
  isXhsLink: boolean;
  // The full URL we extracted, if any.
  extractedUrl: string | null;
  // The original title we recovered from a 【…】 block, if present. This is
  // only used to LEARN style cues — it is never copied into generated output.
  extractedTitle: string | null;
  // Dedup-able structural cues we learned, ordered by SECTION order below.
  cues: ViralCue[];
  // Emoji characters we noticed in the share text — capped & deduped, used
  // as a hint when picking title emoji decoration. Never inserted blindly.
  detectedEmoji: string[];
  // Punctuation amplification level (0..3). 0 = none, 3 = many !!/？？/…
  punctIntensity: number;
  // True when we could only see a URL with no title/share text — degrades to
  // structural learning only.
  isFallback: boolean;
  // Short human-readable status string for the UI status pill. e.g.
  // "已学习:强情绪标题 / 哭脸 emoji / 口语化吐槽 / 悬念钩子".
  status: string;
}

// Map a cue to a short Chinese label for UI display.
const CUE_LABELS: Record<ViralCue, string> = {
  high_emotion_title: "强情绪标题",
  complaint_hook: "吐槽 / 求助钩子",
  first_person_drama: "第一人称戏剧化",
  repeated_punctuation: "重复感叹 / 省略",
  crying_or_strong_emoji: "高情绪 emoji",
  playful_colloquial: "口语化 / 语气词",
  suspense_curiosity: "悬念 / 好奇钩子",
  travel_or_hotel_topic: "酒店 / 旅行节奏",
  xhs_share_format: "小红书分享格式",
};

// Emoji that we treat as "strong emotion". This list is intentionally narrow
// — generic flowers / hearts do NOT count, otherwise every share would look
// emotional.
const STRONG_EMOJI = new Set([
  "😭", "😢", "🥲", "🥹", "😱", "😤", "😡", "🤬",
  "😆", "😂", "🤣", "😅", "😳",
  "💔", "🆘", "😩", "😫",
]);

// Particles / tone words that signal a colloquial, 口语化 voice.
const COLLOQUIAL_PARTICLES = ["哈哈", "啊啊", "呜呜", "哇", "呀", "呢", "嘛", "啦", "诶", "嗷"];

// Hook phrases that read as 吐槽/求助/复杂情绪 rather than calm reporting.
const COMPLAINT_HOOKS = ["还我", "救命", "求", "怎么会", "为什么", "气死", "崩溃", "破防", "退退退"];

// Suspense / curiosity phrases.
const SUSPENSE_HOOKS = ["居然", "没想到", "谁懂", "谁能", "到底", "竟然", "原来", "真的会"];

// First-person dramatic anchors. We require at least one of these AND a
// strong emoji or repeated punctuation before flagging the cue, to avoid
// false positives on calm 我去过 / 我点了 mentions.
const FIRST_PERSON_ANCHORS = ["我", "姐妹", "宝子", "家人们", "兄弟们", "本人"];

const TRAVEL_OR_HOTEL_KEYWORDS = [
  "酒店", "民宿", "亚朵", "全季", "汉庭", "如家", "万豪", "希尔顿", "凯悦", "君悦", "瑰丽",
  "入住", "退房", "旅行", "出差", "周末", "出片", "住宿", "客房",
];

// Detect xiaohongshu URLs and xhslink.com short links.
function findUrl(text: string): string | null {
  const m = text.match(
    /https?:\/\/(?:www\.|m\.)?(?:xiaohongshu\.com|xhslink\.com)[^\s<>"']*/i,
  );
  return m ? m[0] : null;
}

// Recover the original title between 【 and 】. Xiaohongshu's share card uses
// this exact bracket pair, e.g. "【亚朵你还我萨和！！！😭😭😭 - 晨钟去哪玩 | 小红书】".
function extractBracketTitle(text: string): string | null {
  const m = text.match(/【([^】]+)】/);
  if (!m) return null;
  // The share card usually appends " - 作者 | 小红书 ..." inside the bracket.
  // Strip everything from the first " - " or "｜" / "|" onwards so we end up
  // with the headline only.
  return m[1].split(/\s+-\s+|｜|\|/)[0].trim();
}

// Extract emoji characters from text. We use a conservative range that
// covers the symbol/pictograph planes commonly used by Xiaohongshu titles.
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
    }
  }
  return out.slice(0, 6);
}

// Count exclamation / question / ellipsis amplification anywhere in the text.
// Returns a small integer intensity 0..3.
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

export function analyzeViralReference(raw: string | undefined | null): ViralStyleProfile {
  const input = (raw ?? "").trim();
  if (!input) {
    return {
      hasInput: false,
      rawInput: "",
      isXhsLink: false,
      extractedUrl: null,
      extractedTitle: null,
      cues: [],
      detectedEmoji: [],
      punctIntensity: 0,
      isFallback: false,
      status: "",
    };
  }

  const url = findUrl(input);
  const title = extractBracketTitle(input);
  const isXhsLink = !!url && /xiaohongshu\.com|xhslink\.com/i.test(url);
  // The "haystack" for cue detection is the title (when present) plus the
  // share text outside the URL. The URL itself contains no useful tone info,
  // so we don't feed it into keyword detection.
  const cueSource = [title, input.replace(url ?? "", "")].filter(Boolean).join("\n");

  const cuesSet = new Set<ViralCue>();
  const punctIntensity = countPunctIntensity(cueSource);
  const detectedEmoji = extractEmoji(cueSource);
  const hasStrongEmoji = detectedEmoji.some((e) => STRONG_EMOJI.has(e));

  if (title) {
    cuesSet.add("xhs_share_format");
  } else if (/\b(hsj|http)/i.test(input) && isXhsLink) {
    // Share token / link present but no extractable title (user may have
    // pasted just the URL). Still log the format cue so the UI can show
    // "已识别小红书链接".
    cuesSet.add("xhs_share_format");
  }

  if (title && (punctIntensity >= 2 || hasStrongEmoji)) {
    cuesSet.add("high_emotion_title");
  }
  if (punctIntensity >= 1) {
    cuesSet.add("repeated_punctuation");
  }
  if (hasStrongEmoji) {
    cuesSet.add("crying_or_strong_emoji");
  }
  if (COMPLAINT_HOOKS.some((k) => cueSource.includes(k))) {
    cuesSet.add("complaint_hook");
  }
  if (SUSPENSE_HOOKS.some((k) => cueSource.includes(k))) {
    cuesSet.add("suspense_curiosity");
  }
  if (COLLOQUIAL_PARTICLES.some((k) => cueSource.includes(k))) {
    cuesSet.add("playful_colloquial");
  }
  if (
    FIRST_PERSON_ANCHORS.some((k) => cueSource.includes(k)) &&
    (hasStrongEmoji || punctIntensity >= 2 || cuesSet.has("complaint_hook"))
  ) {
    cuesSet.add("first_person_drama");
  }
  if (TRAVEL_OR_HOTEL_KEYWORDS.some((k) => cueSource.includes(k))) {
    cuesSet.add("travel_or_hotel_topic");
  }

  // Stable ordering for display: the order in this list is how we want to
  // surface cues in the UI badge. Drop cues that weren't detected.
  const orderedCues: ViralCue[] = [
    "high_emotion_title",
    "complaint_hook",
    "first_person_drama",
    "repeated_punctuation",
    "crying_or_strong_emoji",
    "playful_colloquial",
    "suspense_curiosity",
    "travel_or_hotel_topic",
    "xhs_share_format",
  ].filter((c) => cuesSet.has(c as ViralCue)) as ViralCue[];

  // Fallback case: the user gave us *something* but we couldn't extract a
  // title and there is no xhs link. We still try to learn from whatever text
  // was pasted (cues above will reflect that), but mark fallback so the UI
  // can show the appropriate message.
  const isFallback = !title && !isXhsLink;

  let status: string;
  if (orderedCues.length === 0) {
    status = isFallback
      ? "未能识别参考内容,生成将按所选风格进行(未学习到额外风格特征)。"
      : "已识别链接但暂未提取到可学习的风格特征,本次按所选风格生成。";
  } else {
    const labels = orderedCues.map((c) => CUE_LABELS[c]);
    status = `已学习:${labels.join(" / ")}`;
  }

  return {
    hasInput: true,
    rawInput: input,
    isXhsLink,
    extractedUrl: url,
    extractedTitle: title,
    cues: orderedCues,
    detectedEmoji,
    punctIntensity,
    isFallback,
    status,
  };
}

// Apply learned style to a base title. Pure function — given the same profile
// and base it always returns the same decorated title. Rules:
//   - if high_emotion_title cue: ensure at least one repeated "!!" or "！！"
//     punctuation marker is present
//   - if crying_or_strong_emoji cue: append a strong-emoji tail (preferring
//     a detected one); never insert into the middle of the user-provided
//     hotel name
//   - if complaint_hook / suspense_curiosity cues: prepend a kinetic 钩子
//     prefix so the title reads less calm
//   - if playful_colloquial cue: replace a final 。 / 句号 with 啦 / 嘛
//     (no-op if no terminal punctuation)
// The function never duplicates effects: it checks for existing markers first.
export function applyTitleStyle(base: string, profile: ViralStyleProfile): string {
  if (!profile.hasInput || profile.cues.length === 0) return base;
  let out = base.trim();
  if (!out) return out;

  // Prepend a kinetic hook if the cue list calls for one and the base title
  // does not already start with a punchy connector. We pick a short prefix
  // that is intentionally not copied from the user's reference title.
  if (
    (profile.cues.includes("complaint_hook") ||
      profile.cues.includes("suspense_curiosity")) &&
    !/^(救命|谁懂|没想到|真的会|气死|笑死)/.test(out)
  ) {
    const prefixOptions =
      profile.cues.includes("complaint_hook") &&
      profile.cues.includes("crying_or_strong_emoji")
        ? ["救命", "谁懂啊", "破防了"]
        : profile.cues.includes("complaint_hook")
          ? ["真的会", "谁懂", "气死"]
          : ["没想到", "原来"];
    // Stable choice: hash the base title so the same input always picks the
    // same prefix. Avoids randomness across renders.
    const idx = stringHash(out) % prefixOptions.length;
    out = `${prefixOptions[idx]}!${out}`;
  }

  // Amplify punctuation if cue says so, but never beyond "!!!" / "？？？".
  if (profile.cues.includes("high_emotion_title") || profile.cues.includes("repeated_punctuation")) {
    if (!/[!！?？]{2,}/.test(out)) {
      // Add "!!" after the last segment. Prefer the same flavor of mark as
      // the source: if we saw ？？ rather than !! in the reference, lean to ？？.
      const wantsQuestion = /[?？]{2,}/.test(profile.rawInput);
      const mark = wantsQuestion ? "？？" : "!!";
      // If the title already ends in a single mark, replace it; otherwise append.
      if (/[!！?？]$/.test(out)) out = out.slice(0, -1) + mark;
      else out = `${out}${mark}`;
    }
  }

  // Strong-emoji tail. Pick a stable emoji deterministically.
  if (profile.cues.includes("crying_or_strong_emoji")) {
    const tailPool = profile.detectedEmoji.filter((e) => STRONG_EMOJI.has(e));
    if (tailPool.length > 0 && !tailPool.some((e) => out.includes(e))) {
      const idx = stringHash(out) % tailPool.length;
      out = `${out}${tailPool[idx]}`;
    } else if (tailPool.length === 0) {
      // The reference didn't have strong emoji but we still detected the
      // emotion cue from punctuation/hooks — leave the title alone, don't
      // invent unrelated emoji.
    }
  }

  // Colloquial particle swap on the final sentence-ending period.
  if (profile.cues.includes("playful_colloquial")) {
    out = out.replace(/。$/, "啦");
  }

  return out;
}

// Bend the closing line and opening hook of the body toward the learned tone.
// We only adjust at the edges — the user's actual content stays untouched.
export function decorateBodyOpening(opening: string, profile: ViralStyleProfile): string {
  if (!profile.hasInput || profile.cues.length === 0) return opening;
  let out = opening;
  // Add "我先说一句!" / "姐妹们" style first-person amplifier when the
  // reference is heavily first-person+dramatic and the existing opening
  // doesn't already start with a vocative.
  if (profile.cues.includes("first_person_drama") && !/^(姐妹|宝子|家人们|兄弟们)/.test(out)) {
    out = `姐妹们,${out}`;
  }
  if (
    (profile.cues.includes("high_emotion_title") ||
      profile.cues.includes("repeated_punctuation")) &&
    !/[!！]{2,}/.test(out)
  ) {
    out = out.replace(/[。!！]?$/, "!!");
  }
  return out;
}

export function viralWarningMessage(profile: ViralStyleProfile): string | null {
  if (!profile.hasInput) return null;
  if (profile.cues.length === 0) {
    return profile.isFallback
      ? "已收到参考内容,但未能识别出可借鉴的风格特征,本次仅按所选风格生成。"
      : "已识别参考链接,但暂未提取到额外风格特征,本次仅按所选风格生成。";
  }
  const labels = profile.cues.map((c) => CUE_LABELS[c]);
  return `已学习参考笔记风格(${labels.join(" / ")}):本次生成的标题与正文会向该风格靠拢,不会复制原文与原图。`;
}

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h || 1;
}

export const VIRAL_CUE_LABELS = CUE_LABELS;
