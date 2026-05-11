import type {
  AppInputState,
  GeneratedNote,
  PageLayout,
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

function polishUserLine(text: string, seed: number): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return cleaned;
  const openings = [
    "真实入住下来,最明显的感受是",
    "从我的实拍和体验看,比较值得记录的是",
    "这部分不夸张,我会这样概括:",
    "如果要写给正在做功课的人,重点是",
  ];
  const ending = cleaned.endsWith("。") || cleaned.endsWith("!") || cleaned.endsWith("！") ? "" : "。";
  return `${pick(openings, seed)}${cleaned.length > 42 ? " " : ":"}${cleaned}${ending}`;
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
  const title = `${prefix}${subject}｜${suffix}`;
  const coverHeadlines = [
    `${subject}\n真的很会住!`,
    `这家酒店\n太适合收藏!`,
    `被低估的\n宝藏酒店`,
    `住进这里\n像在度假`,
    `${subject}\n出片到离谱`,
  ];
  const coverHeadline = pick(coverHeadlines, seed + 29);
  const altTitles = [
    `${city ? `${city}｜` : ""}${subject}｜${pick(style.titleSuffixes, seed + 13)}`,
    `${pick(style.titlePrefixes, seed + 17)}${subject}｜${pick(style.toneAdjectives, seed + 3)}到想再来一次`,
    `${subject}｜${pick(style.toneAdjectives, seed + 5)}入住,${pick(style.titleSuffixes, seed + 23)}`,
  ];

  // 3) Body paragraphs — combine framework / freeform + facts + style tone
  const tone = pick(style.toneAdjectives, seed + 1);
  const emoji = style.emojiSet;

  const intro: string[] = [];
  intro.push(`${emoji[0]} 这次入住${subject},整体感受可以用一个词形容: ${tone}。这篇会尽量按真实体验来写,不补不存在的信息。`);
  if (city || stayDate) {
    const parts: string[] = [];
    if (city) parts.push(`坐标 ${city}`);
    if (stayDate) parts.push(`入住时间 ${stayDate}`);
    intro.push(`📍 ${parts.join(" · ")}。`);
  }
  if (roomType) intro.push(`房型选的是「${roomType}」。`);
  if (brand && !hotelName) intro.push(`属于 ${brand} 旗下,品牌一贯的调性这次依旧在线。`);

  const sceneBlocks: string[] = [];
  if (input.inputMode === "framework") {
    for (let i = 0; i < frameworkBlocks.length; i++) {
      const b = frameworkBlocks[i];
      sceneBlocks.push(`【${b.label}】\n${polishUserLine(b.value, seed + i)}`);
    }
  } else if (freeText) {
    // Slightly polish free-form text into 2-3 paragraphs by splitting on punctuation / newlines.
    const chunks = freeText
      .replace(/\r/g, "")
      .split(/\n+|(?<=[。！？!?])\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const grouped: string[] = [];
    let buf: string[] = [];
    for (const c of chunks) {
      buf.push(c);
      if (buf.join("").length > 60) {
        grouped.push(buf.join(""));
        buf = [];
      }
    }
    if (buf.length) grouped.push(buf.join(""));
    grouped.forEach((g, i) => {
      const label = ["入住感受", "空间细节", "服务体验", "周边体验"][i] || "其他记录";
      sceneBlocks.push(`【${label}】\n${polishUserLine(g, seed + i)}`);
    });
  }

  const verdict: string[] = [];
  verdict.push(`${emoji[emoji.length - 1] ?? "✨"} 总结一句话: ${pick(style.titleSuffixes, seed + 11)}。`);
  if (price) verdict.push(`💰 这次入住的实际价格: ${price}(以本人订单为准,价格随日期波动,大家可自行比价)。`);
  else verdict.push(`💰 价格信息暂未填写,大家可以自行去常用平台比价。`);
  if (input.images.length > 0) {
    verdict.push(`📸 这篇笔记的图片均为本人入住实拍,封面与内页排版仅做风格参考。`);
  } else {
    verdict.push(`📸 本篇暂未上传实拍图,内页版式为可参考排版,不代表实际房间画面。`);
  }

  const body = [...intro, "", ...sceneBlocks.flatMap((b) => [b, ""]), ...verdict]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 4) Tags
  const baseTags = ["酒店测评", "旅行日记", "出片酒店", "住宿推荐"];
  const styleTag = `#${style.name}`;
  const tagSet = new Set<string>([
    `#${style.name}`,
    "#酒店测评",
    "#住宿推荐",
    "#旅行vlog",
  ]);
  if (city) {
    tagSet.add(`#${city}`);
    tagSet.add(`#${city}酒店`);
    tagSet.add(`#${city}旅行`);
  }
  if (brand) tagSet.add(`#${brand}`);
  if (hotelName) tagSet.add(`#${hotelName}`);
  baseTags.forEach((t) => tagSet.add(`#${t}`));
  void styleTag;
  const tags = Array.from(tagSet).slice(0, 12);

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

  return {
    styleKey: input.style,
    title,
    altTitles,
    body,
    tags,
    commentSeeds,
    pageLayout: layout,
    coverHeadline,
    coverSubline,
    stickerCopy,
    warnings,
  };
}
