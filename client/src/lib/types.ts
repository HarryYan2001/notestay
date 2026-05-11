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

export interface GeneratedNote {
  styleKey: StyleKey;
  title: string;
  altTitles: string[];
  body: string;        // markdown-ish, paragraphs separated by \n\n
  tags: string[];
  commentSeeds: string[];
  pageLayout: PageLayout[];
  coverHeadline: string;
  coverSubline: string;
  stickerCopy: string[];
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
