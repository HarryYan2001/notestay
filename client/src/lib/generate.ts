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
  // Clean up artifacts that can appear after deletions: leading punctuation, double commas.
  // Note: only collapse horizontal whitespace — newlines are structural.
  out = out
    .replace(/[,，、](?=[,，、。!?！？])/g, "")
    .replace(/^[,，、。!?！？ \t]+/, "")
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

  const frameworkBlocks = input.framework
    .filter((f) => nonEmpty(f.value))
    .map((f) => ({ label: f.label.trim() || "笔记", value: f.value.trim() }));
  const freeText = nonEmpty(input.freeText);

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

  const seedString = `${input.style}|${hotelName || ""}|${city || ""}|${userContent}|${input.viralRef}|${Date.now()}|${Math.random()}`;
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

  // Section heading bank — emoji + Chinese label. We only render the ones
  // the user actually mentioned, in this order.
  const SECTION_BANK: { keys: string[]; emoji: string; label: string }[] = [
    { keys: ["位置", "地段", "交通", "周边", "出行"], emoji: "📍", label: "位置" },
    { keys: ["第一印象", "印象", "门面", "外观", "大堂", "lobby"], emoji: "✨", label: "第一印象" },
    { keys: ["房间", "房型", "空间", "床", "床品", "卫浴", "浴室"], emoji: "🛏️", label: "房间" },
    { keys: ["服务", "前台", "礼宾", "管家", "态度"], emoji: "🛎️", label: "服务" },
    { keys: ["早餐", "餐食", "buffet", "自助餐"], emoji: "🍳", label: "早餐" },
    { keys: ["设施", "泳池", "健身", "spa", "酒吧", "lounge"], emoji: "🏊", label: "设施" },
    { keys: ["夜景", "view", "景观", "落地窗"], emoji: "🌃", label: "景观" },
  ];

  function pickSection(label: string, value: string) {
    const lower = (label + " " + value).toLowerCase();
    for (const s of SECTION_BANK) {
      if (s.keys.some((k) => lower.includes(k.toLowerCase()))) return s;
    }
    return null;
  }

  type Section = { emoji: string; label: string; text: string };
  const sections: Section[] = [];

  if (input.inputMode === "framework") {
    for (let i = 0; i < frameworkBlocks.length; i++) {
      const b = frameworkBlocks[i];
      const matched = pickSection(b.label, b.value);
      const emoji = matched?.emoji ?? "📝";
      const label = matched?.label ?? (b.label || "记一笔");
      sections.push({ emoji, label, text: naturalizeUserLine(b.value) });
    }
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

  // Price as its own standalone line wrapped in 【】, only if user supplied it.
  const priceLine = price ? `【价格: ${price}】` : null;

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
    if (priceLine) lines.push(priceLine);
    for (const s of usedSections) {
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
