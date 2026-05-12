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
  viralRef: string;
  viralRefNotes: string;
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
  styleKey: StyleKey;
  title: string;
  altTitles: string[];
  body: string;        // markdown-ish, paragraphs separated by \n\n
  tags: string[];
  commentSeeds: string[];
  pageLayout: PageLayout[];
  cover: CoverDesign;                       // alias to pageDesigns[0] for back-compat
  pageDesigns: Record<number, PageDesign>;  // keyed by pageLayout.index
  stickers: StickerOverlay[];               // each has pageIndex binding
  warnings: string[];
}

export interface PageLayout {
  index: number;
  role: string;        // cover / scene / detail / verdict
  headline: string;
  caption: string;
  imageId?: string;    // reference UploadedImage.id (if any)
  gradient: string;    // fallback CSS gradient
}
