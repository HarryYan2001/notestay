import type {
  AppInputState,
  CoverDesign,
  CoverLayer,
  GeneratedNote,
  PageDesign,
  PageLayout,
  StickerOverlay,
  StyleKey,
  UploadedImage,
} from "./types";
import { STYLES } from "./styles";

const IMAGE_CATEGORIES = ["外观", "大堂", "房间", "床品", "浴室", "早餐", "夜景", "周边", "其他"];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h || 1;
}

function gradientFor(styleKey: StyleKey, i: number): string {
  const palette = STYLES[styleKey].palette;
  const a = palette[i % palette.length];
  const b = palette[(i + 1) % palette.length];
  const c = palette[(i + 2) % palette.length];
  const angles = [135, 160, 110, 200, 45];
  const ang = angles[i % angles.length];
  return `linear-gradient(${ang}deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
}

function nonEmpty(s: string | undefined | null): string | null {
  const v = (s || "").trim();
  return v.length ? v : null;
}

function categorizeImages(images: UploadedImage[]): Record<string, UploadedImage[]> {
  const map: Record<string, UploadedImage[]> = {};
  for (const c of IMAGE_CATEGORIES) map[c] = [];
  for (const img of images) {
    const k = IMAGE_CATEGORIES.includes(img.category) ? img.category : "其他";
    map[k].push(img);
  }
  return map;
}

function selectCoverImage(images: UploadedImage[]): UploadedImage | undefined {
  const priority = ["房间", "外观", "大堂", "夜景", "早餐", "床品", "浴室", "周边", "其他"];
  return priority.map((category) => images.find((img) => img.category === category)).find(Boolean) || images[0];
}

// Phrases we never want to surface in any generated copy.
const BANNED_PHRASES = [
  "不得不说",
  "总体而言",
  "综合来说",
  "性价比之选",
  "性价比天花板",
  "宝藏酒店",
];

function stripBanned(text: string): string {
  let out = text;
  for (const p of BANNED_PHRASES) {
    out = out.split(p).join("");
  }
  // Clean up artifacts that can appear after deletions:
  //   - orphan / duplicated sentence-ending punctuation (incl. ones separated by whitespace)
  //   - leading punctuation on a line
  //   - excess horizontal whitespace
  // Newlines are structural and must be preserved.
  out = out
    // Drop comma-then-punctuation runs: "，。" → "。"
    .replace(/[,，、](?=[ \t]*[,，、。!?！？])/g, "")
    // Collapse runs of the same/different sentence-end punctuation, possibly spaced.
    // e.g. "。。" → "。", "。 。" → "。", "！。" → "！".
    .replace(/([。!?！？])(?:[ \t]*[。!?！？])+/g, "$1")
    // Strip leading punctuation / whitespace at the start of each line.
    .replace(/(^|\n)[,，、。!?！？ \t]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  return out;
}

function countCjk(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (/[一-鿿]/.test(ch)) n++;
  }
  return n;
}

// Group user-provided framework text into a friendly, oral paragraph without
// AI-style connective phrases. Returns the body text only (no heading).
function naturalizeUserLine(text: string): string {
  const cleaned = stripBanned(text.trim().replace(/\s+/g, " "));
  if (!cleaned) return cleaned;
  const endsWithPunct = /[。！？!?…]$/.test(cleaned);
  return endsWithPunct ? cleaned : `${cleaned}。`;
}

export function generateNote(input: AppInputState): GeneratedNote {
  const style = STYLES[input.style];
  const warnings: string[] = [];

  // 1) Aggregate user content
  const hotelName = nonEmpty(input.hotel.name);
  const brand = nonEmpty(input.hotel.brand);
  const city = nonEmpty(input.hotel.city);
  const price = nonEmpty(input.hotel.price);
  const roomType = nonEmpty(input.hotel.roomType);
  const stayDate = nonEmpty(input.hotel.stayDate);

  // Strict mode exclusion: framework slots are read ONLY in framework mode,
  // freeText is read ONLY in freeform mode. The inactive mode's content
  // never leaks into generation, even if it lingers in app state.
  const frameworkBlocks =
    input.inputMode === "framework"
      ? input.framework
          .filter((f) => nonEmpty(f.value))
          .map((f) => ({ label: f.label.trim() || "笔记", value: f.value.trim() }))
      : [];
  const freeText = input.inputMode === "freeform" ? nonEmpty(input.freeText) : null;

  const userContent =
    input.inputMode === "framework"
      ? frameworkBlocks.map((b) => `${b.label}: ${b.value}`).join("\n")
      : freeText || "";

  if (!userContent && !hotelName) {
    warnings.push("尚未填写任何文字内容,以下结果仅作为版式示例。请补充测评心得或酒店信息以获得真实可发布的笔记。");
  }
  if (!hotelName) warnings.push("未提供酒店名称,正文中将以中性表述代替具体酒店名。");
  if (!price) warnings.push("未提供价格,文中不会出现具体价格信息。");
  if (!city) warnings.push("未提供城市,将不在文中标注具体城市与定位。");
  if (input.images.length === 0)
    warnings.push("未上传图片,封面与内页将使用渐变占位版式作为参考,而非伪造的照片内容。");
  if (nonEmpty(input.viralRef))
    warnings.push("已分析所附爆款笔记链接的结构、节奏与标题逻辑作为参考,不会复制其原文或图片内容。");

  const seedString = `${input.inputMode}|${input.style}|${hotelName || ""}|${city || ""}|${userContent}|${input.viralRef}|${Date.now()}|${Math.random()}`;
  const seed = seedFromString(seedString);

  // 2) Title
  const subject =
    hotelName ||
    (brand ? `${brand}的这家` : null) ||
    (city ? `${city}这家酒店` : null) ||
    "这家酒店";
  const prefix = pick(style.titlePrefixes, seed);
  const suffix = pick(style.titleSuffixes, seed + 7);
  const title = stripBanned(`${prefix}${subject}｜${suffix}`);
  const coverHeadlines = [
    `${subject}\n真的很会住!`,
    `这家酒店\n太适合收藏!`,
    `住进这里\n像在度假`,
    `${subject}\n出片到离谱`,
    `安利给\n爱住酒店的你`,
  ];
  const coverHeadline = stripBanned(pick(coverHeadlines, seed + 29));
  const altTitles = [
    stripBanned(`${city ? `${city}｜` : ""}${subject}｜${pick(style.titleSuffixes, seed + 13)}`),
    stripBanned(`${pick(style.titlePrefixes, seed + 17)}${subject}｜${pick(style.toneAdjectives, seed + 3)}到想再来一次`),
    stripBanned(`${subject}｜${pick(style.toneAdjectives, seed + 5)}入住,${pick(style.titleSuffixes, seed + 23)}`),
  ];

  // 3) Body — Xiaohongshu travel blogger voice.
  //    Structure: opening hook (not "这次来到..."), emoji-headed sections only
  //    for content the user actually mentioned, optional price line in 【】,
  //    one collectible closing line. Target ~500 CJK chars, hard cap 600.
  const tone = pick(style.toneAdjectives, seed + 1);

  // Section heading bank — emoji + Chinese label. We render only the ones the
  // user actually mentioned, in this order. Each entry has:
  //   - `keys`: positive triggers. A single match is enough on its own when
  //     no stronger dimension competes.
  //   - `strongKeys` (optional): unambiguous triggers that should outweigh
  //     bare keyword hits in other dimensions. E.g. 早餐 itself is a strong
  //     trigger but a bare 咖啡 is not.
  //   - `avoidKeys` (optional): when any of these appear in the same fragment
  //     as a `keys` hit but no `strongKeys` hit, this dimension is skipped.
  //     Used to prevent e.g. 咖啡 routing room-amenity text into 早餐, or
  //     卫生间 hijacking the 卫生 (cleanliness) dimension.
  // Order matters as a tiebreaker — more specific dimensions come first so
  // e.g. 卫生间 (bathroom) wins over 卫生 (cleanliness).
  type BankEntry = {
    keys: string[];
    strongKeys?: string[];
    avoidKeys?: string[];
    emoji: string;
    label: string;
  };
  const SECTION_BANK: BankEntry[] = [
    { keys: ["位置", "地段", "交通", "周边", "出行", "地铁", "机场"], emoji: "📍", label: "位置" },
    { keys: ["停车", "车位", "代客泊车"], emoji: "🚗", label: "停车" },
    { keys: ["第一印象", "门面", "外观", "大堂", "lobby"], emoji: "✨", label: "第一印象" },
    // 早餐 / dining. Bare 咖啡/茶 are too weak — they appear in room amenity
    // text ("免费矿泉水和茶包咖啡"). Require a meal/dining anchor.
    {
      keys: ["早餐", "早饭", "餐厅", "自助", "buffet", "下午茶", "包子", "粥", "油条", "面包", "牛奶", "能吃饱"],
      strongKeys: ["早餐", "早饭", "餐厅", "自助", "buffet", "下午茶"],
      avoidKeys: ["茶包", "咖啡机", "胶囊", "迎宾", "矿泉水", "冰箱", "电视", "办公"],
      emoji: "🍳",
      label: "早餐",
    },
    { keys: ["浴缸", "泡澡", "汤池"], emoji: "🛁", label: "浴缸" },
    // 卫生间 / 浴室 — bathroom facilities. Must come BEFORE 卫生 so 卫生间
    // does not collapse into the cleanliness dimension.
    {
      keys: ["卫生间", "洗手间", "浴室", "干湿分离", "花洒", "热水", "洗澡", "马桶", "洗漱台", "淋浴", "下水", "水压"],
      strongKeys: ["卫生间", "洗手间", "干湿分离", "花洒", "淋浴", "马桶"],
      emoji: "🚿",
      label: "卫生间",
    },
    // 卫生 — cleanliness only. Reject if 卫生间 is what's actually meant.
    {
      keys: ["卫生", "干净", "清洁", "打扫", "灰尘", "污渍", "异味", "缝隙", "床单", "毛发", "一尘不染"],
      strongKeys: ["干净", "清洁", "打扫", "灰尘", "污渍", "异味"],
      avoidKeys: ["卫生间", "洗手间", "浴室", "干湿分离", "花洒", "热水", "洗澡", "马桶", "淋浴"],
      emoji: "🧼",
      label: "卫生",
    },
    // 隔音 — soundproofing / noise only. Reject when the fragment is really
    // about bed comfort (床品 / 床软硬 / 枕头 / 床垫 etc.).
    {
      keys: ["隔音", "安静", "噪音", "吵", "听不到", "车声", "走廊声", "楼上楼下"],
      strongKeys: ["隔音", "噪音", "听不到", "车声", "走廊声"],
      avoidKeys: ["床垫", "床品", "床单", "床软", "枕头", "被子", "羽绒"],
      emoji: "🤫",
      label: "隔音",
    },
    { keys: ["露台", "阳台", "户外平台"], emoji: "🌿", label: "露台" },
    { keys: ["亲子", "儿童", "小孩", "宝宝", "婴儿床"], emoji: "🧸", label: "亲子" },
    { keys: ["设计", "装修", "美学", "风格", "氛围"], emoji: "🎨", label: "设计" },
    // 房间 / 设施 — generic room and amenities. 茶包/咖啡机/冰箱/电视/办公
    // belong here, NOT in 早餐.
    {
      keys: [
        "房间", "房型", "空间", "床", "床品", "床垫", "枕头", "被子",
        "落地窗", "推开门",
        "电视", "冰箱", "茶包", "咖啡机", "胶囊", "矿泉水", "迎宾水", "办公", "桌椅", "衣柜", "灯光", "插座",
      ],
      emoji: "🛏️",
      label: "房间",
    },
    { keys: ["服务", "前台", "礼宾", "管家", "态度"], emoji: "🛎️", label: "服务" },
    { keys: ["设施", "泳池", "健身", "spa", "酒吧", "lounge", "健身房"], emoji: "🏊", label: "设施" },
    { keys: ["夜景", "view", "景观", "海景", "江景", "山景"], emoji: "🌃", label: "景观" },
    { keys: ["入住体验", "整体体验", "总体感受"], emoji: "💭", label: "入住体验" },
  ];

  // Score a fragment against a bank entry. Returns 0 if no positive hit, or
  // if an avoidKey defeats a weak (non-strong) hit. Strong hits ignore
  // avoidKeys (the dimension's own anchor word overrides). Score is a small
  // integer: strong hit > regular hit > 0.
  function scoreEntry(entry: BankEntry, text: string): number {
    const lower = text.toLowerCase();
    const hasStrong = (entry.strongKeys ?? []).some((k) => lower.includes(k.toLowerCase()));
    const hasRegular = entry.keys.some((k) => lower.includes(k.toLowerCase()));
    if (!hasStrong && !hasRegular) return 0;
    if (hasStrong) return 2;
    // Weak hit only — check avoidKeys.
    const avoided = (entry.avoidKeys ?? []).some((k) => lower.includes(k.toLowerCase()));
    if (avoided) return 0;
    return 1;
  }

  // Match on the value first (it carries the actual content). Only fall back
  // to the framework label when the value gives no signal — otherwise a slot
  // labeled "服务" with breakfast content would be misrouted. We pick the
  // highest-scoring entry; ties are broken by SECTION_BANK order (more
  // specific dimensions come first).
  function pickSection(label: string, value: string): BankEntry | null {
    const pickBest = (text: string): BankEntry | null => {
      let best: BankEntry | null = null;
      let bestScore = 0;
      for (const s of SECTION_BANK) {
        const sc = scoreEntry(s, text);
        if (sc > bestScore) {
          best = s;
          bestScore = sc;
        }
      }
      return best;
    };
    if (value) {
      const v = pickBest(value);
      if (v) return v;
    }
    if (label) {
      const l = pickBest(label);
      if (l) return l;
    }
    return null;
  }

  // Generic label noise that should NOT be promoted into its own section
  // heading when the framework slot has no recognizable dimension.
  const GENERIC_LABELS = new Set([
    "笔记",
    "记一笔",
    "备注",
    "其他",
    "杂记",
    "随手记",
    "补充",
  ]);

  // Set of standard SECTION_BANK labels for quick lookup.
  const STANDARD_LABELS = new Set(SECTION_BANK.map((s) => s.label));

  type Section = { emoji: string; label: string; text: string };

  // Second-pass review / reclassification (复核机制).
  // After sections are assembled, split each section's body into fragments and
  // reclassify each fragment by dimension keyword. If a fragment clearly belongs
  // to a different dimension than the section it landed in, move it. We only
  // move when there is a better, more-specific match — fragments that don't
  // match any dimension stay where they were. User-provided custom sections
  // are preserved unless a fragment clearly fits a standard dimension better.
  function reviewAndReassign(secs: Section[]) {
    if (secs.length === 0) return;

    // Split a section text into fragments on sentence-ending punctuation,
    // preserving the punctuation with the fragment that precedes it. If a
    // single sentence contains clauses that map to different dimensions
    // (e.g. "推开门是落地窗，床品柔软，洗手间干湿分离很舒服。" — the first
    // two clauses are 房间, the third is 卫生间), split further on
    // ，、；,; so each clause can be reclassified independently. We only
    // emit clause-level fragments when the clauses actually cross
    // dimensions; otherwise the original sentence stays whole so noun
    // lists ("床、灯光、插座") within a single dimension are not chopped up.
    function splitClauses(sentence: string): string[] {
      const parts: string[] = [];
      let buf = "";
      for (const ch of sentence) {
        if (/[，、；,;]/.test(ch)) {
          const t = buf.trim();
          if (t) parts.push(t);
          buf = "";
        } else {
          buf += ch;
        }
      }
      const tail = buf.trim();
      if (tail) parts.push(tail);
      return parts;
    }

    function splitFragments(text: string): string[] {
      const sentences: string[] = [];
      let buf = "";
      for (const ch of text) {
        buf += ch;
        if (/[。！？!?…]/.test(ch)) {
          const t = buf.trim();
          if (t) sentences.push(t);
          buf = "";
        }
      }
      const tail = buf.trim();
      if (tail) sentences.push(tail);

      const out: string[] = [];
      for (const sent of sentences) {
        const clauses = splitClauses(sent);
        if (clauses.length <= 1) {
          out.push(sent);
          continue;
        }
        // Classify each clause; if the clauses cross dimensions
        // (more than one distinct standard label appears), emit them
        // separately so each can be re-routed. Otherwise keep the
        // sentence whole.
        const labels = clauses.map((c) => pickSection("", c)?.label ?? null);
        const distinct = new Set(labels.filter((l): l is string => l !== null));
        if (distinct.size <= 1) {
          out.push(sent);
          continue;
        }
        // Multi-dimension sentence: emit each clause. Clauses that
        // didn't match any dimension on their own attach to the
        // previous matched clause so we don't strand bare connective
        // phrases like "很舒服". Each emitted fragment ends with 。
        // so downstream joining keeps natural sentence boundaries.
        const emitted: string[] = [];
        const emittedLabels: (string | null)[] = [];
        for (let i = 0; i < clauses.length; i++) {
          const lab = labels[i];
          if (lab !== null) {
            emitted.push(clauses[i]);
            emittedLabels.push(lab);
          } else if (emitted.length > 0) {
            emitted[emitted.length - 1] = `${emitted[emitted.length - 1]}，${clauses[i]}`;
          } else {
            emitted.push(clauses[i]);
            emittedLabels.push(null);
          }
        }
        // Merge consecutive clauses that share the same label so noun
        // lists within one dimension stay together as one fragment.
        let mergedBuf = "";
        let mergedLabel: string | null | undefined;
        for (let i = 0; i < emitted.length; i++) {
          if (mergedLabel === undefined) {
            mergedBuf = emitted[i];
            mergedLabel = emittedLabels[i];
            continue;
          }
          if (emittedLabels[i] === mergedLabel) {
            mergedBuf = `${mergedBuf}，${emitted[i]}`;
          } else {
            out.push(/[。！？!?…]$/.test(mergedBuf) ? mergedBuf : `${mergedBuf}。`);
            mergedBuf = emitted[i];
            mergedLabel = emittedLabels[i];
          }
        }
        if (mergedBuf) {
          out.push(/[。！？!?…]$/.test(mergedBuf) ? mergedBuf : `${mergedBuf}。`);
        }
      }
      return out;
    }

    // Bucket of fragments by destination key. Keys are either standard
    // SECTION_BANK labels, or "__keep__:<sectionIndex>" for fragments staying
    // in their original (custom or leftover) section.
    const movedTo = new Map<string, string[]>();
    const keptBySection = new Map<number, string[]>();

    const isStandardSection = (label: string) => STANDARD_LABELS.has(label);

    secs.forEach((sec, idx) => {
      const fragments = splitFragments(sec.text);
      for (const frag of fragments) {
        const matched = pickSection("", frag);
        const current = sec.label;
        // Decide whether to move.
        let moveTo: { label: string; emoji: string } | null = null;
        if (matched && matched.label !== current) {
          if (isStandardSection(current)) {
            // Standard section -> different standard section: move.
            moveTo = { label: matched.label, emoji: matched.emoji };
          } else if (current === "记一笔") {
            // Leftover bucket: any standard match wins.
            moveTo = { label: matched.label, emoji: matched.emoji };
          } else {
            // Custom user-provided dimension: only move if the fragment
            // matches a different standard dimension AND the custom label
            // itself is NOT a recognizable dimension keyword for the fragment.
            // Example: a custom "服务" with a breakfast sentence -> move.
            // But a custom "露台" with a sentence containing 露台 stays put
            // (it'll match 露台 in SECTION_BANK and equal `current`).
            moveTo = { label: matched.label, emoji: matched.emoji };
          }
        }
        if (moveTo) {
          const arr = movedTo.get(moveTo.label) ?? [];
          arr.push(frag);
          movedTo.set(moveTo.label, arr);
        } else {
          const arr = keptBySection.get(idx) ?? [];
          arr.push(frag);
          keptBySection.set(idx, arr);
        }
      }
    });

    // Rebuild sections. Order:
    //   1) Original sections (in original order) with their kept fragments,
    //      merged with any moved-in fragments destined for that label.
    //      Drop sections that end up empty.
    //   2) Newly created standard sections for moved fragments whose target
    //      label didn't exist in `secs` — in SECTION_BANK order.
    const handledLabels = new Set<string>();
    const rebuilt: Section[] = [];
    secs.forEach((sec, idx) => {
      const kept = keptBySection.get(idx) ?? [];
      const moved = movedTo.get(sec.label) ?? [];
      handledLabels.add(sec.label);
      const combined = [...kept, ...moved];
      if (combined.length === 0) return;
      rebuilt.push({
        emoji: sec.emoji,
        label: sec.label,
        text: naturalizeUserLine(combined.join("")),
      });
    });
    for (const bankEntry of SECTION_BANK) {
      if (handledLabels.has(bankEntry.label)) continue;
      const moved = movedTo.get(bankEntry.label);
      if (!moved || moved.length === 0) continue;
      rebuilt.push({
        emoji: bankEntry.emoji,
        label: bankEntry.label,
        text: naturalizeUserLine(moved.join("")),
      });
    }
    secs.length = 0;
    secs.push(...rebuilt);
  }

  const sections: Section[] = [];

  if (input.inputMode === "framework") {
    // Cluster framework slots by matched dimension so two slots that both
    // describe e.g. 早餐 don't show up as two separate emoji headings.
    const fwBucket = new Map<string, { emoji: string; label: string; parts: string[] }>();
    const fwOrder: string[] = [];
    const addToBucket = (key: string, emoji: string, label: string, value: string) => {
      const entry = fwBucket.get(key);
      if (entry) {
        entry.parts.push(value);
      } else {
        fwBucket.set(key, { emoji, label, parts: [value] });
        fwOrder.push(key);
      }
    };
    for (const b of frameworkBlocks) {
      const matched = pickSection(b.label, b.value);
      if (matched) {
        addToBucket(matched.label, matched.emoji, matched.label, b.value);
      } else {
        // No standard dimension matched. If the user gave a non-generic label
        // (e.g. a custom dimension like "露台" or "私人管家"), promote it to
        // its own emoji-headed section. Otherwise fall back to 📝 记一笔.
        const rawLabel = (b.label || "").trim();
        if (rawLabel && !GENERIC_LABELS.has(rawLabel)) {
          addToBucket(`__custom__:${rawLabel}`, "📝", rawLabel, b.value);
        } else {
          addToBucket("__leftover__", "📝", "记一笔", b.value);
        }
      }
    }
    for (const key of fwOrder) {
      const entry = fwBucket.get(key)!;
      sections.push({
        emoji: entry.emoji,
        label: entry.label,
        text: naturalizeUserLine(entry.parts.join("。")),
      });
    }
    reviewAndReassign(sections);
  } else if (freeText) {
    // Split free text into chunks and route each chunk to the best-matching section.
    const chunks = stripBanned(freeText)
      .replace(/\r/g, "")
      .split(/\n+|(?<=[。！？!?])\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bucket = new Map<string, { emoji: string; label: string; parts: string[] }>();
    const leftovers: string[] = [];
    for (const c of chunks) {
      const matched = pickSection("", c);
      if (matched) {
        const key = matched.label;
        const entry = bucket.get(key) ?? { emoji: matched.emoji, label: matched.label, parts: [] };
        entry.parts.push(c);
        bucket.set(key, entry);
      } else {
        leftovers.push(c);
      }
    }
    for (const s of SECTION_BANK) {
      const entry = bucket.get(s.label);
      if (entry) sections.push({ emoji: entry.emoji, label: entry.label, text: naturalizeUserLine(entry.parts.join("")) });
    }
    if (leftovers.length) {
      sections.push({ emoji: "📝", label: "记一笔", text: naturalizeUserLine(leftovers.join("")) });
    }
    reviewAndReassign(sections);
  }

  // Opening hook — name the core feeling, do NOT start with "这次来到...".
  const hookBank = [
    `真的，住完只想说一句：${tone}得想再来一次。`,
    `先说结论，这一晚${tone}到不舍得退房。`,
    `老实讲，住完的第一反应就是：好${tone}。`,
    `给嘴硬的我跪了，这家${tone}得有点上头。`,
    `没夸张，住进去那一刻心情就被${tone}拿捏了。`,
  ];
  const opening = stripBanned(pick(hookBank, seed + 31));

  // Optional context line (city / stay date / room type) — only if provided.
  const ctxParts: string[] = [];
  if (city) ctxParts.push(`坐标${city}`);
  if (stayDate) ctxParts.push(`入住${stayDate}`);
  if (roomType) ctxParts.push(`房型「${roomType}」`);
  const contextLine = ctxParts.length ? `📍 ${ctxParts.join(" · ")}` : null;

  // Price renders as its own emoji-headed section inside the body, only when
  // the user actually supplied a price. We never invent a price.
  const priceSection: Section | null = price
    ? { emoji: "💰", label: "价格", text: `本次入住价格${price}，供大家参考。` }
    : null;

  // Closing collectible one-sentence summary — must avoid prohibited phrases.
  const closingBank = [
    `小本本记一下：想住得舒服又出片，这家可以放进收藏夹。`,
    `愿意为它专程再来一次，这一句就够了。`,
    `给同样爱住酒店的你：值得抄作业的一晚。`,
    `存这条，下次想给自己一个慢一点的周末就来。`,
    `如果你和我一样在意细节，把它加进愿望清单不亏。`,
  ];
  const closing = stripBanned(pick(closingBank, seed + 41));

  // Compose body. Drop sections one by one if we exceed 600 CJK chars.
  function compose(usedSections: Section[]): string {
    const lines: string[] = [];
    lines.push(opening);
    if (contextLine) lines.push(contextLine);
    const all = priceSection ? [priceSection, ...usedSections] : usedSections;
    for (const s of all) {
      lines.push("");
      lines.push(`${s.emoji} ${s.label}`);
      lines.push(s.text);
    }
    lines.push("");
    lines.push(closing);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  let body = compose(sections);
  // Soft target 500, hard cap 600 CJK chars.
  while (countCjk(body) > 600 && sections.length > 1) {
    sections.pop();
    body = compose(sections);
  }
  if (countCjk(body) > 600) {
    // Last resort: hard trim closing/section text.
    const trimmedSections = sections.map((s) => ({
      ...s,
      text: s.text.length > 80 ? s.text.slice(0, 80) + "…" : s.text,
    }));
    body = compose(trimmedSections);
  }
  body = stripBanned(body);

  // 4) Tags — keep 3-5 most relevant hashtags.
  const orderedTags: string[] = [];
  const pushTag = (t: string) => {
    const v = `#${t.replace(/^#/, "").trim()}`;
    if (v !== "#" && !orderedTags.includes(v)) orderedTags.push(v);
  };
  if (city) pushTag(`${city}酒店`);
  if (hotelName) pushTag(hotelName);
  pushTag("酒店测评");
  pushTag("住宿推荐");
  pushTag(style.name);
  const tags = orderedTags.slice(0, 5);

  // 5) Comment seeds
  const commentSeeds = [
    `蹲一个${city || "同城"}的姐妹,这家值得冲吗?`,
    `${roomType ? `想问 ${roomType} 朝向如何?` : "想问下房型怎么选最划算?"}`,
    `${price ? "这个价位还有什么平替推荐吗?" : "求大家分享真实下单价格,我去做做功课"}`,
    `下次想约一起住,${city ? `${city}` : "同城"}有姐妹一起吗?`,
    `${style.name}风格真的太对我胃口了,求博主多更!`,
  ];

  // 6) Page layout (cover + image-only inner pages)
  const byCat = categorizeImages(input.images);
  const orderedCategories = IMAGE_CATEGORIES.filter((c) => byCat[c].length > 0);
  const coverImage = selectCoverImage(input.images);
  const layout: PageLayout[] = [];

  layout.push({
    index: 0,
    role: "cover",
    headline: coverHeadline,
    caption: title,
    imageId: coverImage?.id,
    gradient: gradientFor(input.style, 0),
  });

  let pageIdx = 1;
  for (const cat of orderedCategories) {
    const imgs = byCat[cat];
    imgs.slice(0, 2).forEach((img) => {
      layout.push({
        index: pageIdx,
        role: "scene",
        headline: `${cat}｜${pick(style.toneAdjectives, seed + pageIdx)}的一帧`,
        caption: `「${cat}」这组画面是我本人实拍,文字以你提供的内容为准,不做无中生有的描述。`,
        imageId: img.id,
        gradient: gradientFor(input.style, pageIdx),
      });
      pageIdx++;
    });
  }

  // If no images at all, add image-only example layout cards as scaffolds
  if (input.images.length === 0) {
    ["房间", "空间细节"].forEach((label, i) => {
      layout.push({
        index: pageIdx + i,
        role: "scene",
        headline: `${label}｜版式参考`,
        caption: "",
        gradient: gradientFor(input.style, pageIdx + i),
      });
    });
    pageIdx += 2;
  }

  // 7) Sticker copy + cover sub
  const stickerCopy = [
    `${style.emojiSet[0] ?? "✨"} ${pick(style.toneAdjectives, seed + 2)}入住`,
    city ? `📍${city}` : "📍坐标随手记",
    price ? `💰 ${price}` : "💰 价格待补充",
    roomType ? `🛏️ ${roomType}` : "🛏️ 房型见正文",
  ];
  const coverSubline = hotelName
    ? `${hotelName}${city ? ` · ${city}` : ""}`
    : city
    ? `${city} · 这家值得记住`
    : "酒店美好,一键记住";

  // Build editable cover with layer model
  const cover = buildCoverDesign({
    styleKey: input.style,
    coverHeadline,
    coverSubline,
    images: input.images,
    coverImage,
    seed,
  });

  // Build default stickers — bind first sticker to cover (page 0)
  // and second sticker to first scene page (page 1) if present
  const stickers: StickerOverlay[] = stickerCopy.slice(0, 2).map((text, i) => ({
    id: `stk_${seed}_${i}`,
    pageIndex: i === 0 ? 0 : (layout[1]?.index ?? 0),
    text,
    x: i === 0 ? 12 : 14,
    y: i === 0 ? 8 : 76,
    rotation: i === 0 ? -4 : 5,
    font: i === 0 ? "marker" : "rounded",
    color: "#ffffff",
    background: i === 0 ? "rgba(0,0,0,0.45)" : "rgba(232,89,107,0.85)",
    fontSize: 14,
  }));

  // Build per-page designs: page 0 = cover (already built); inner pages = scene designs
  const pageDesigns: Record<number, PageDesign> = { 0: cover };
  for (const page of layout) {
    if (page.index === 0) continue;
    const img = page.imageId
      ? input.images.find((i) => i.id === page.imageId)
      : undefined;
    pageDesigns[page.index] = buildScenePageDesign({
      styleKey: input.style,
      page,
      image: img,
      seed: seed + page.index,
    });
  }

  return {
    id: `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    styleKey: input.style,
    title,
    originalTitle: title,
    altTitles,
    body,
    tags,
    commentSeeds,
    pageLayout: layout,
    cover,
    pageDesigns,
    stickers,
    warnings,
  };
}

function buildScenePageDesign(opts: {
  styleKey: StyleKey;
  page: PageLayout;
  image: UploadedImage | undefined;
  seed: number;
}): PageDesign {
  const { styleKey, page, image, seed } = opts;
  const palette = STYLES[styleKey].palette;
  const background = page.gradient ||
    `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 55%, ${palette[2]} 100%)`;
  const layers: CoverLayer[] = [];
  if (image) {
    layers.push({
      id: `lyr_pi_${seed}`,
      type: "image",
      imageUrl: image.url,
      x: 4,
      y: 6,
      w: 92,
      h: 78,
      rotation: 0,
      z: 1,
      offsetX: 50,
      offsetY: 50,
      zoom: 1,
      radius: 18,
      shadow: true,
    });
  }
  if (page.headline) {
    layers.push({
      id: `lyr_ph_${seed}`,
      type: "text",
      text: page.headline,
      x: 6,
      y: 86,
      w: 88,
      h: 8,
      rotation: 0,
      z: 5,
      color: "#ffffff",
      fontSize: 16,
      fontWeight: 800,
      font: "sans",
      align: "left",
      background: "rgba(0,0,0,0.35)",
      shadow: true,
    });
  }
  return { background, bgImageUrl: null, layers };
}

function buildCoverDesign(opts: {
  styleKey: StyleKey;
  coverHeadline: string;
  coverSubline: string;
  images: UploadedImage[];
  coverImage: UploadedImage | undefined;
  seed: number;
}): CoverDesign {
  const { styleKey, coverHeadline, coverSubline, images, coverImage, seed } = opts;
  const palette = STYLES[styleKey].palette;
  const background = `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 55%, ${palette[2]} 100%)`;

  const layers: CoverLayer[] = [];
  // Main image layer (fills most of frame)
  if (coverImage) {
    layers.push({
      id: `lyr_main_${seed}`,
      type: "image",
      imageUrl: coverImage.url,
      x: 6,
      y: 8,
      w: 88,
      h: 60,
      rotation: 0,
      z: 1,
      offsetX: 50,
      offsetY: 45,
      zoom: 1.1,
      radius: 18,
      shadow: true,
    });
  }
  // Secondary photo
  const secondary = images.find((i) => i.id !== coverImage?.id);
  if (secondary) {
    layers.push({
      id: `lyr_sec_${seed}`,
      type: "image",
      imageUrl: secondary.url,
      x: 8,
      y: 70,
      w: 38,
      h: 24,
      rotation: -3,
      z: 2,
      offsetX: 50,
      offsetY: 50,
      zoom: 1.05,
      radius: 12,
      shadow: true,
    });
  }
  const tertiary = images.find(
    (i) => i.id !== coverImage?.id && i.id !== secondary?.id,
  );
  if (tertiary) {
    layers.push({
      id: `lyr_ter_${seed}`,
      type: "image",
      imageUrl: tertiary.url,
      x: 54,
      y: 70,
      w: 38,
      h: 24,
      rotation: 4,
      z: 2,
      offsetX: 50,
      offsetY: 50,
      zoom: 1.05,
      radius: 12,
      shadow: true,
    });
  }

  // Headline text
  layers.push({
    id: `lyr_title_${seed}`,
    type: "text",
    text: coverHeadline,
    x: 6,
    y: 12,
    w: 88,
    h: 22,
    rotation: 0,
    z: 5,
    color: "#ffffff",
    fontSize: 32,
    fontWeight: 900,
    font: "sans",
    align: "center",
    background: null,
    shadow: true,
  });
  // Subline text
  layers.push({
    id: `lyr_sub_${seed}`,
    type: "text",
    text: coverSubline,
    x: 12,
    y: 92,
    w: 76,
    h: 6,
    rotation: 0,
    z: 6,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 600,
    font: "sans",
    align: "center",
    background: "rgba(0,0,0,0.35)",
    shadow: false,
  });
  return {
    background,
    bgImageUrl: null,
    layers,
  };
}
