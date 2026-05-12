// Deterministic style analyzer for a Xiaohongshu reference note SCREENSHOT.
//
// Static GitHub Pages deploys cannot fetch xiaohongshu.com URLs (robots.txt /
// CORS / login walls), so this app no longer asks for a link. Instead, the
// user uploads a screenshot of the target note they want to emulate, and this
// module learns visual style cues from the pixels:
//
//   - Dominant palette (top-K average colors from a quantized grid)
//   - Brightness / saturation / contrast / warmth (warm vs cool / pink / cream
//     / dark) — surfaced as a `mood` label
//   - Text-overlay density: a rough estimate of how much of the cover area is
//     covered by high-contrast text blobs. A high score implies the user's
//     target is a "big-character" cover that wants a bold/centered headline;
//     a low score implies a minimal photo cover.
//   - Layout density: edge density across the frame. Busy ↔ minimal.
//   - Accent color: the most saturated non-background color (used as title /
//     sticker accent in the generated cover).
//
// The profile then drives:
//   - title decoration (intensity + accent emoji)
//   - body opening tone (warm/soft vs dramatic/punchy)
//   - cover/page design: background tint, headline color, headline weight,
//     subline background, secondary photo radius, accent-pill sticker, etc.
//
// Pure data only — we never copy original copy or original imagery. The
// uploaded screenshot stays as a transient object URL bound to the user's
// session.

import type { CoverDesign, CoverLayer, PageDesign, StyleKey } from "./types";

// ---------- public types ----------

export type ScreenshotMood =
  | "warm_cream"   // beige/cream/soft warm, low saturation
  | "pink_red"     // pink/red/rose dominant, mid-high saturation
  | "warm_amber"   // amber/orange/gold dominant, warm
  | "neutral"      // grey / off-white, low saturation
  | "cool_blue"    // blue/teal dominant
  | "dark_moody";  // very low brightness, premium dark cover

export type ScreenshotCue =
  | "big_title_cover"      // headline-style large text blob in top half
  | "high_contrast_text"   // strong black-on-light or white-on-dark text
  | "bright_overexposed"   // high brightness, low contrast — cream/film
  | "dark_premium"         // low brightness, moody
  | "high_saturation"      // vivid colors, viral / 爆款 style
  | "minimalist"           // low edge density, lots of empty space
  | "busy_dense"           // high edge density, many overlays / stickers
  | "warm_tone"            // average hue in warm half
  | "cool_tone"            // average hue in cool half
  | "pink_accent"          // strong pink / red accent color present
  | "cream_palette";       // pastel cream palette

export interface ScreenshotStyleProfile {
  // True when the user supplied a screenshot we could analyze.
  hasInput: boolean;
  // Object URL of the uploaded screenshot — used for preview thumbnail only.
  // Never sent to a server; never written into generated copy.
  previewUrl: string | null;
  // Original filename (best-effort, may be empty for synthetic inputs).
  filename: string;
  width: number;
  height: number;
  // Top-3 dominant colors as hex strings, ordered by frequency.
  palette: [string, string, string];
  // Most saturated non-grey color — used as the cover accent.
  accent: string;
  // 0..1 average lightness across the frame.
  brightness: number;
  // 0..1 average saturation.
  saturation: number;
  // 0..1 contrast (stddev of luminance).
  contrast: number;
  // -1 (cool) .. +1 (warm). Derived from R/G vs B channel balance.
  warmth: number;
  // 0..1 share of pixels classified as "text-like" (extreme luminance vs
  // local average). Rough proxy for headline overlays.
  textDensity: number;
  // 0..1 share of pixels at edges (busy ↔ minimal).
  edgeDensity: number;
  mood: ScreenshotMood;
  cues: ScreenshotCue[];
  // Short human-readable status line for the UI panel.
  status: string;
}

const CUE_LABELS: Record<ScreenshotCue, string> = {
  big_title_cover: "大标题封面",
  high_contrast_text: "高对比文字",
  bright_overexposed: "高亮 / 奶油感",
  dark_premium: "暗调 / 高级感",
  high_saturation: "高饱和爆款",
  minimalist: "极简留白",
  busy_dense: "信息量密集",
  warm_tone: "暖色调",
  cool_tone: "冷色调",
  pink_accent: "粉红强调色",
  cream_palette: "奶油米色",
};

const MOOD_LABELS: Record<ScreenshotMood, string> = {
  warm_cream: "奶油暖色",
  pink_red: "粉红 / 玫红",
  warm_amber: "琥珀 / 暖光",
  neutral: "中性灰白",
  cool_blue: "冷色 / 蓝调",
  dark_moody: "暗调电影感",
};

export const SCREENSHOT_CUE_LABELS = CUE_LABELS;
export const SCREENSHOT_MOOD_LABELS = MOOD_LABELS;

// ---------- core analyzer (works on raw pixel data) ----------

// Minimal shape that matches both browser ImageData and our smoke fixtures.
export interface RawPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | number[];
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// HSL conversion — we only need lightness/saturation/hue scalars.
function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function luminance({ r, g, b }: RGB): number {
  // Rec. 709 luma — good enough for relative perceptual brightness.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Quantize a color to a 6-step-per-channel cube (216 buckets). Good for
// finding dominant tones without being sensitive to JPEG noise.
function quantize({ r, g, b }: RGB): string {
  const step = 64;
  const qr = Math.min(255, Math.floor(r / step) * step + step / 2);
  const qg = Math.min(255, Math.floor(g / step) * step + step / 2);
  const qb = Math.min(255, Math.floor(b / step) * step + step / 2);
  return `${qr},${qg},${qb}`;
}

function parseQuantized(key: string): RGB {
  const [r, g, b] = key.split(",").map(Number);
  return { r, g, b };
}

// Sample the image on a fixed grid so the cost is bounded for huge uploads.
// A 64×64 grid is plenty for color / brightness statistics.
const GRID = 64;

export function analyzeScreenshotPixels(pixels: RawPixels): Omit<ScreenshotStyleProfile, "hasInput" | "previewUrl" | "filename"> {
  const { width, height, data } = pixels;
  if (width === 0 || height === 0) {
    return emptyStats();
  }
  const stepX = Math.max(1, Math.floor(width / GRID));
  const stepY = Math.max(1, Math.floor(height / GRID));

  const counts = new Map<string, number>();
  let lumSum = 0;
  let lumSqSum = 0;
  let satSum = 0;
  let warmthSum = 0;
  let sampleCount = 0;
  // Track per-grid-cell luminance into a buffer so we can compute a cheap
  // edge-density (text-density proxy) by neighbour-diff in a second pass.
  const cellLum: number[] = [];
  const cellWidth = Math.ceil(width / stepX);

  const luminances: number[] = [];

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const idx = (y * width + x) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const a = data[idx + 3] ?? 255;
      if (a < 16) continue; // skip transparent
      const rgb = { r, g, b };
      const l = luminance(rgb);
      const hsl = rgbToHsl(rgb);
      luminances.push(l);
      lumSum += l;
      lumSqSum += l * l;
      satSum += hsl.s;
      // Warmth: positive when R+G dominates, negative when B dominates.
      warmthSum += ((r + g) / 2 - b) / 255;
      sampleCount += 1;
      const key = quantize(rgb);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      cellLum.push(l);
    }
  }

  if (sampleCount === 0) {
    return emptyStats();
  }

  const brightness = lumSum / sampleCount;
  const variance = Math.max(0, lumSqSum / sampleCount - brightness * brightness);
  const contrast = Math.sqrt(variance);
  const saturation = satSum / sampleCount;
  const warmth = warmthSum / sampleCount;

  // ---- dominant palette ----
  const entries: [string, number][] = [];
  counts.forEach((v, k) => entries.push([k, v]));
  const sortedByCount = entries.sort((a, b) => b[1] - a[1]);
  const paletteRgb: RGB[] = sortedByCount.slice(0, 3).map(([k]) => parseQuantized(k));
  while (paletteRgb.length < 3) {
    paletteRgb.push(paletteRgb[paletteRgb.length - 1] ?? { r: 200, g: 200, b: 200 });
  }
  const palette = paletteRgb.map(rgbToHex) as [string, string, string];

  // ---- accent: most saturated bucket among the top-12 frequent ones ----
  let accentRgb: RGB = paletteRgb[0];
  let bestSat = -1;
  for (const [k, _count] of sortedByCount.slice(0, 12)) {
    const rgb = parseQuantized(k);
    const hsl = rgbToHsl(rgb);
    // Penalize near-white / near-black so we get a recognizable accent.
    const usable = hsl.l > 0.18 && hsl.l < 0.88 ? hsl.s : hsl.s * 0.4;
    if (usable > bestSat) {
      bestSat = usable;
      accentRgb = rgb;
    }
  }
  const accent = rgbToHex(accentRgb);
  const accentHsl = rgbToHsl(accentRgb);

  // ---- edge density (proxy for busyness) ----
  let edges = 0;
  let edgePairs = 0;
  // Walk cellLum in row-major order using cellWidth as stride.
  for (let i = 0; i < cellLum.length; i++) {
    const cur = cellLum[i];
    // Right neighbour
    if ((i + 1) % cellWidth !== 0 && i + 1 < cellLum.length) {
      edgePairs++;
      if (Math.abs(cur - cellLum[i + 1]) > 0.18) edges++;
    }
    // Bottom neighbour
    if (i + cellWidth < cellLum.length) {
      edgePairs++;
      if (Math.abs(cur - cellLum[i + cellWidth]) > 0.18) edges++;
    }
  }
  const edgeDensity = edgePairs > 0 ? edges / edgePairs : 0;

  // ---- text density: pixels whose luminance is much higher or lower than
  // their local neighbour AND saturation is low (text is usually grayscale).
  // This is an extremely rough proxy — without OCR we just measure how
  // "headline-like" the contrast pattern looks. ----
  let textPixels = 0;
  for (let i = 0; i < luminances.length; i++) {
    const l = luminances[i];
    const isExtreme = l < 0.18 || l > 0.85;
    if (isExtreme) textPixels++;
  }
  const textDensity = textPixels / luminances.length;

  // ---- mood label ----
  let mood: ScreenshotMood;
  if (brightness < 0.28) {
    mood = "dark_moody";
  } else if (saturation > 0.45 && accentHsl.h !== undefined && isPinkRed(accentHsl.h)) {
    mood = "pink_red";
  } else if (brightness > 0.68 && warmth > 0.04 && !isPinkRed(accentHsl.h)) {
    // Bright + warm + non-pink dominant → cream / Korean-soft mood. We
    // intentionally don't gate on HSL-saturation here because pastel cream
    // tones read as quite saturated by the HSL formula.
    mood = "warm_cream";
  } else if (warmth > 0.1 && (isAmber(accentHsl.h))) {
    mood = "warm_amber";
  } else if (warmth < -0.05 && (accentHsl.h > 180 && accentHsl.h < 260)) {
    mood = "cool_blue";
  } else {
    mood = "neutral";
  }

  // ---- cues ----
  const cues: ScreenshotCue[] = [];
  if (textDensity > 0.22 && contrast > 0.18) cues.push("big_title_cover");
  if (contrast > 0.22) cues.push("high_contrast_text");
  if (brightness > 0.72 && contrast < 0.2) cues.push("bright_overexposed");
  if (brightness < 0.3) cues.push("dark_premium");
  // High saturation should fire only on genuinely vivid covers, not on
  // pastel/cream covers where HSL-saturation reads ~0.6 just because the
  // colors are very light. Require the average lightness to be below the
  // pastel band as well.
  if (saturation > 0.45 && brightness < 0.78) cues.push("high_saturation");
  if (edgeDensity < 0.18) cues.push("minimalist");
  if (edgeDensity > 0.38) cues.push("busy_dense");
  if (warmth > 0.08) cues.push("warm_tone");
  else if (warmth < -0.05) cues.push("cool_tone");
  if (accentHsl.s > 0.35 && isPinkRed(accentHsl.h)) cues.push("pink_accent");
  if (brightness > 0.7 && warmth > 0.04 && !isPinkRed(accentHsl.h)) cues.push("cream_palette");

  const status = buildStatus({ mood, cues });

  return {
    width,
    height,
    palette,
    accent,
    brightness,
    saturation,
    contrast,
    warmth,
    textDensity,
    edgeDensity,
    mood,
    cues,
    status,
  };
}

function isPinkRed(h: number): boolean {
  // Hue 330..360 + 0..15 is the pink/red wedge.
  return h >= 330 || h <= 15;
}
function isAmber(h: number): boolean {
  return h > 15 && h < 55;
}

function emptyStats(): Omit<ScreenshotStyleProfile, "hasInput" | "previewUrl" | "filename"> {
  return {
    width: 0,
    height: 0,
    palette: ["#cccccc", "#cccccc", "#cccccc"],
    accent: "#cccccc",
    brightness: 0,
    saturation: 0,
    contrast: 0,
    warmth: 0,
    textDensity: 0,
    edgeDensity: 0,
    mood: "neutral",
    cues: [],
    status: "未能从截图中提取到风格特征,本次将按所选风格生成。",
  };
}

function buildStatus(p: Pick<ScreenshotStyleProfile, "mood" | "cues">): string {
  const moodLabel = MOOD_LABELS[p.mood];
  const cueLabels = p.cues.map((c) => CUE_LABELS[c]);
  if (cueLabels.length === 0) {
    return `已识别为${moodLabel},本次生成将沿用该色彩基调。`;
  }
  return `已学习${moodLabel}风格:${cueLabels.join(" / ")}`;
}

// ---------- browser entrypoint ----------

// Load a File / Blob as an HTMLImageElement, drawn onto an offscreen canvas,
// and analyze it. Returns a profile with `hasInput: true` and an object-URL
// preview. The caller is responsible for revoking the preview URL when the
// screenshot is cleared (handled by app-state.tsx).
export async function analyzeScreenshotFile(file: File): Promise<ScreenshotStyleProfile> {
  const previewUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(previewUrl);
    // Cap analysis canvas at 256px on the long edge — saves memory and we
    // don't gain accuracy past that.
    const maxEdge = 256;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const stats = analyzeScreenshotPixels(imageData);
    return {
      hasInput: true,
      previewUrl,
      filename: file.name || "",
      ...stats,
    };
  } catch (err) {
    // Analysis failed — keep the preview so the user sees their upload, but
    // fall back to "no learned cues" so generation degrades gracefully.
    console.warn("screenshot analysis failed", err);
    return {
      hasInput: true,
      previewUrl,
      filename: file.name || "",
      ...emptyStats(),
    };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

// ---------- helpers consumed by generate.ts ----------

export function emptyScreenshotProfile(): ScreenshotStyleProfile {
  return {
    hasInput: false,
    previewUrl: null,
    filename: "",
    ...emptyStats(),
  };
}

// Title decoration — bend the title toward the screenshot's mood / cues.
// Deterministic: same profile + same base → same output.
export function applyScreenshotTitleStyle(base: string, p: ScreenshotStyleProfile): string {
  if (!p.hasInput) return base;
  let out = base.trim();
  if (!out) return out;
  const hasStrongCue =
    p.cues.includes("big_title_cover") ||
    p.cues.includes("high_saturation") ||
    p.cues.includes("pink_accent") ||
    p.cues.includes("dark_premium") ||
    p.cues.includes("bright_overexposed");
  if (!hasStrongCue) return out;

  // Soft / cream / bright mood → softer, more 治愈 wording. Dark mood → 高级 /
  // 沉静. Pink/red high-saturation → 爆款 punctuation.
  if (p.mood === "pink_red" || p.cues.includes("high_saturation") || p.cues.includes("big_title_cover")) {
    if (!/[!！?？]{2,}/.test(out)) {
      out = /[!！?？]$/.test(out) ? out.slice(0, -1) + "!!" : `${out}!!`;
    }
    if (p.cues.includes("pink_accent") && !/[🤍💕💖❤️🌸]/.test(out)) {
      out = `${out}💕`;
    }
  } else if (p.mood === "warm_cream" || p.cues.includes("cream_palette") || p.cues.includes("bright_overexposed")) {
    // Cream / soft mood: append a gentle 治愈 token if not already present.
    if (!/(治愈|超治愈|超温柔|奶系|柔软)/.test(out)) {
      out = `${out}·超治愈`;
    }
  } else if (p.mood === "dark_moody" || p.cues.includes("dark_premium")) {
    if (!/(高级|沉静|质感|低调|不动声色)/.test(out)) {
      out = `${out}·高级感`;
    }
  } else if (p.mood === "warm_amber") {
    if (!/(暖光|琥珀|金色|暖调)/.test(out)) {
      out = `${out}·暖光时刻`;
    }
  }
  return out;
}

// Body opening tone shift.
export function applyScreenshotBodyOpening(opening: string, p: ScreenshotStyleProfile): string {
  if (!p.hasInput || p.cues.length === 0) return opening;
  let out = opening;
  if (p.cues.includes("high_saturation") || p.mood === "pink_red") {
    if (!/[!！]{2,}/.test(out)) {
      out = out.replace(/[。!！]?$/, "!!");
    }
    if (!/^(姐妹|宝子|家人们|兄弟们)/.test(out)) {
      out = `姐妹们,${out}`;
    }
  } else if (p.mood === "warm_cream" || p.cues.includes("bright_overexposed")) {
    if (!/^(说真的|认真讲|悄悄说|轻轻地)/.test(out)) {
      out = `悄悄说一句,${out}`;
    }
  } else if (p.mood === "dark_moody" || p.cues.includes("dark_premium")) {
    if (!/^(夜色|安静|不动声色|沉静)/.test(out)) {
      out = `夜色里慢慢讲,${out}`;
    }
  }
  return out;
}

// Apply the learned screenshot style to a freshly built cover design. Returns
// a new CoverDesign without mutating the input.
export function applyScreenshotToCover(cover: CoverDesign, p: ScreenshotStyleProfile, styleKey: StyleKey): CoverDesign {
  if (!p.hasInput) return cover;
  return {
    ...cover,
    background: tintBackground(cover.background, p, styleKey),
    layers: cover.layers.map((l) => restyleLayer(l, p)),
  };
}

export function applyScreenshotToPage(page: PageDesign, p: ScreenshotStyleProfile, styleKey: StyleKey): PageDesign {
  if (!p.hasInput) return page;
  return {
    ...page,
    background: tintBackground(page.background, p, styleKey),
    layers: page.layers.map((l) => restyleLayer(l, p)),
  };
}

function tintBackground(_base: string, p: ScreenshotStyleProfile, _styleKey: StyleKey): string {
  // Build a fresh gradient from the learned palette so the cover visibly
  // adopts the screenshot's color mood. We always return a linear-gradient so
  // downstream consumers (page-flat / phone-preview / export) keep working.
  const [c1, c2, c3] = p.palette;
  const ang = p.mood === "dark_moody" ? 160 : p.mood === "pink_red" ? 130 : 135;
  return `linear-gradient(${ang}deg, ${c1} 0%, ${c2} 55%, ${c3} 100%)`;
}

function restyleLayer(layer: CoverLayer, p: ScreenshotStyleProfile): CoverLayer {
  if (layer.type !== "text") return layer;
  // Title-ish layer (large fontSize) gets the accent treatment.
  const isTitleLayer = layer.fontSize >= 24;
  if (isTitleLayer) {
    let color = layer.color;
    let fontWeight = layer.fontWeight;
    let background = layer.background;
    // Soft cream / bright cover → dark title text on light frame, less drop shadow.
    if (p.mood === "warm_cream" || p.cues.includes("bright_overexposed")) {
      color = "#2b1f15";
      fontWeight = Math.min(900, Math.max(700, layer.fontWeight));
      background = null;
    } else if (p.mood === "dark_moody" || p.cues.includes("dark_premium")) {
      // Dark cover → ivory title, heavy weight.
      color = "#f3ead8";
      fontWeight = Math.min(900, Math.max(800, layer.fontWeight));
      background = null;
    } else if (p.cues.includes("big_title_cover") || p.cues.includes("high_saturation") || p.mood === "pink_red") {
      // Big-title / viral cover → accent-colored pill behind the title.
      color = "#ffffff";
      fontWeight = 900;
      background = p.accent;
    } else {
      color = "#ffffff";
      background = null;
    }
    return {
      ...layer,
      color,
      fontWeight,
      background,
      shadow: !(p.mood === "warm_cream" || p.cues.includes("bright_overexposed")),
    };
  }
  // Subline / small text layer: pick a contrasting backdrop that respects mood.
  let background = layer.background;
  let color = layer.color;
  if (p.mood === "warm_cream" || p.cues.includes("bright_overexposed")) {
    background = "rgba(255,255,255,0.65)";
    color = "#3a2a1a";
  } else if (p.mood === "dark_moody" || p.cues.includes("dark_premium")) {
    background = "rgba(0,0,0,0.55)";
    color = "#f3ead8";
  } else if (p.mood === "pink_red" || p.cues.includes("pink_accent")) {
    background = p.accent;
    color = "#ffffff";
  }
  return { ...layer, background, color };
}

// Build a deterministic accent-pill sticker layer to splash on the cover when
// the learned style strongly suggests it (big-title / high-saturation /
// pink-red). The caller (generate.ts) appends this to the cover's layer
// stack so the cue is visible in editor + phone preview + export.
export function buildAccentStickerLayer(p: ScreenshotStyleProfile, seed: number): CoverLayer | null {
  if (!p.hasInput) return null;
  const wantPill =
    p.cues.includes("big_title_cover") ||
    p.cues.includes("high_saturation") ||
    p.cues.includes("pink_accent") ||
    p.mood === "pink_red";
  if (!wantPill) return null;
  const moodText: Record<ScreenshotMood, string> = {
    warm_cream: "超治愈",
    pink_red: "必冲爆款",
    warm_amber: "暖光时刻",
    neutral: "本季收藏",
    cool_blue: "清冷夜住",
    dark_moody: "夜色入住",
  };
  return {
    id: `lyr_acc_${seed}`,
    type: "text",
    text: moodText[p.mood],
    x: 60,
    y: 60,
    w: 32,
    h: 8,
    rotation: -6,
    z: 9,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: 900,
    font: "rounded",
    align: "center",
    background: p.accent,
    shadow: true,
  };
}

// Warning message for the result-page warnings list. Returns null when no
// screenshot was supplied.
export function screenshotWarningMessage(p: ScreenshotStyleProfile): string | null {
  if (!p.hasInput) return null;
  return `已学习参考截图风格(${MOOD_LABELS[p.mood]}):本次生成的标题、正文与封面会向该风格靠拢,不会复制原文与原图。`;
}
