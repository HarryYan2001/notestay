export type StyleKey =
  | "vintage_film"
  | "korean_cream"
  | "japanese_clean"
  | "high_minimal"
  | "travel_mag"
  | "french_romance"
  | "moody_premium"
  | "ins_life"
  | "xhs_burst"
  | "lux_hotel"
  | "city_pop"
  | "warm_documentary";

export interface StyleDef {
  key: StyleKey;
  name: string;
  english: string;
  description: string;
  palette: [string, string, string];
  vibe: string;
  titlePrefixes: string[];
  titleSuffixes: string[];
  toneAdjectives: string[];
  emojiSet: string[];
  coverHeadline: string;
}

export interface FrameworkField {
  id: string;
  label: string;
  value: string;
}

export interface HotelInfo {
  name: string;
  brand: string;
  city: string;
  price: string;
  roomType: string;
  stayDate: string;
}

export interface UploadedImage {
  id: string;
  url: string;          // object URL
  name: string;
  category: string;     // 房间/早餐/夜景/外观/其他
}

export type InputMode = "framework" | "freeform";

export interface AppInputState {
  inputMode: InputMode;
  framework: FrameworkField[];
  freeText: string;
  hotel: HotelInfo;
  images: UploadedImage[];
  style: StyleKey;
  // Legacy viral-link text field. Kept for back-compat with existing smoke
  // fixtures (script/smoke-*). The UI no longer surfaces it — the 爆款笔记
  // 学习 block uploads a screenshot now (see `screenshotRef`).
  viralRef: string;
  viralRefNotes: string;
  // Optional reference-note screenshot the user uploaded so we can learn the
  // visual / textual style of a target Xiaohongshu note. When present we
  // bend title, body opening and page/cover designs toward the learned
  // palette + mood + cues. Null when the user hasn't uploaded a screenshot.
  screenshotRef: ScreenshotRef | null;
}

// Persisted screenshot reference. We only keep the *analysis result* in app
// state — the raw File is consumed when the user picks the file and the
// analyzer is the source of truth for downstream generation.
export interface ScreenshotRef {
  // Object URL for the uploaded screenshot, used for the preview thumbnail.
  // Revoked when the user clears or replaces the screenshot.
  previewUrl: string | null;
  filename: string;
  width: number;
  height: number;
  palette: [string, string, string];
  accent: string;
  brightness: number;
  saturation: number;
  contrast: number;
  warmth: number;
  textDensity: number;
  edgeDensity: number;
  mood: string;
  cues: string[];
  status: string;
  // Text style learned from OCR-extracted text inside the screenshot. Null
  // when OCR was skipped, failed, or produced too-little text to analyze.
  textStyle: ScreenshotTextStyleRef | null;
}

// Subset of screenshot-text-style.ts's ScreenshotTextStyleProfile that we
// persist into app state. Kept structural so the result page and generator
// can re-hydrate it without touching the raw OCR engine again.
export interface ScreenshotTextStyleRef {
  hasText: boolean;
  charCount: number;
  cjkCount: number;
  tone: string;
  cues: string[];
  detectedEmoji: string[];
  punctIntensity: number;
  avgSentenceLen: number;
  hashtagCount: number;
  status: string;
  // A short, sanitized preview of the recognized text (NOT used by the
  // generator — purely for the optional "show me what was OCR'd" panel).
  // Capped at ~240 chars so we never persist the whole reference note.
  previewText: string;
}

export type CoverLayerType = "image" | "text";

export type StickerFont =
  | "sans"
  | "serif"
  | "rounded"
  | "mono"
  | "brush"
  | "marker";

export interface CoverLayerBase {
  id: string;
  type: CoverLayerType;
  // position as percentage of cover (0-100), relative to layer center
  x: number;
  y: number;
  // width/height as percentage of cover
  w: number;
  h: number;
  rotation: number;
  z: number;
}

export interface CoverImageLayer extends CoverLayerBase {
  type: "image";
  // imageUrl can be: object URL from uploaded image, or external url
  imageUrl: string;
  // crop offset in percent (0-100) — where to position the image inside its frame
  offsetX: number;
  offsetY: number;
  // zoom factor (1 = fit)
  zoom: number;
  radius: number;        // border-radius px
  shadow: boolean;
}

export interface CoverTextLayer extends CoverLayerBase {
  type: "text";
  text: string;
  color: string;
  fontSize: number;       // px at cover width 320
  fontWeight: number;     // 400-900
  font: StickerFont;
  align: "left" | "center" | "right";
  background: string | null;  // backdrop color (transparent if null)
  shadow: boolean;
}

export type CoverLayer = CoverImageLayer | CoverTextLayer;

export interface CoverDesign {
  background: string;     // css gradient or color
  bgImageUrl: string | null;
  layers: CoverLayer[];
}

// A page design — same structure as cover; cover is page 0.
export type PageDesign = CoverDesign;

export interface StickerOverlay {
  id: string;
  // which page this sticker is bound to (0 = cover, 1+ = inner image pages)
  pageIndex: number;
  text: string;
  // % of page width/height
  x: number;
  y: number;
  rotation: number;
  font: StickerFont;
  color: string;
  background: string | null;
  fontSize: number;
}

export interface GeneratedNote {
  // Identity for this generation pass. Bumped on every regenerate so result
  // page components can fully remount and discard any stale DOM state.
  id: string;
  styleKey: StyleKey;
  title: string;
  // The title produced by the initial generation pass. Preserved verbatim so
  // the user can always revert from an inline-edited or alt-applied title back
  // to the originally generated one.
  originalTitle: string;
  altTitles: string[];
  body: string;        // markdown-ish, paragraphs separated by \n\n
  tags: string[];
  commentSeeds: string[];
  pageLayout: PageLayout[];
  cover: CoverDesign;                       // alias to pageDesigns[0] for back-compat
  pageDesigns: Record<number, PageDesign>;  // keyed by pageLayout.index
  stickers: StickerOverlay[];               // each has pageIndex binding
  warnings: string[];
  viralStyle?: ViralStyleSummary;
  screenshotStyle?: ScreenshotStyleSummary;
}

export interface ViralStyleSummary {
  hasInput: boolean;
  cues: string[];
  cueLabels: string[];
  status: string;
  isFallback: boolean;
  isXhsLink: boolean;
  extractedTitle: string | null;
}

export interface ScreenshotStyleSummary {
  hasInput: boolean;
  mood: string;
  moodLabel: string;
  cues: string[];
  cueLabels: string[];
  palette: [string, string, string];
  accent: string;
  status: string;
  // Textual style learned from the OCR'd screenshot text. Only populated when
  // OCR returned a usable Chinese payload. Always object-shaped for callers
  // (hasText=false when no text was learned).
  text: ScreenshotTextStyleSummary;
}

export interface ScreenshotTextStyleSummary {
  hasText: boolean;
  tone: string;
  toneLabel: string;
  cues: string[];
  cueLabels: string[];
  status: string;
}

export interface PageLayout {
  index: number;
  role: string;        // cover / scene / detail / verdict
  headline: string;
  caption: string;
  imageId?: string;    // reference UploadedImage.id (if any)
  gradient: string;    // fallback CSS gradient
}
