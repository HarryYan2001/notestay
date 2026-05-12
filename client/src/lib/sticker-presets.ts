import type { StickerFont } from "./types";

// Preset sticker templates with a young, energetic, Xiaohongshu vibe.
// These provide both the visible text and the visual styling. Users can
// drop one onto a page and then edit the text/font like any other sticker.
export interface StickerPreset {
  key: string;
  // Short label shown in the picker chip (Chinese, terse).
  label: string;
  // Default text inserted on the page.
  text: string;
  font: StickerFont;
  color: string;
  background: string | null;
  fontSize: number;
  rotation: number;
}

export const STICKER_PRESETS: StickerPreset[] = [
  {
    key: "xhs_must_visit",
    label: "本周必去",
    text: "本周必去✨",
    font: "marker",
    color: "#ffffff",
    background: "rgba(254,44,85,0.92)",
    fontSize: 18,
    rotation: -6,
  },
  {
    key: "xhs_loved",
    label: "爱了爱了",
    text: "爱了爱了🫶",
    font: "rounded",
    color: "#ffffff",
    background: "rgba(255,123,164,0.92)",
    fontSize: 18,
    rotation: 4,
  },
  {
    key: "xhs_must_stay",
    label: "必住榜",
    text: "必住榜TOP1",
    font: "marker",
    color: "#3a1d0a",
    background: "rgba(255,224,102,0.95)",
    fontSize: 17,
    rotation: -3,
  },
  {
    key: "xhs_yyds",
    label: "YYDS",
    text: "YYDS永远的神",
    font: "marker",
    color: "#ffffff",
    background: "rgba(60,90,255,0.9)",
    fontSize: 16,
    rotation: 2,
  },
  {
    key: "xhs_tip",
    label: "避雷提醒",
    text: "⚠️ 避雷小Tip",
    font: "rounded",
    color: "#5a1a00",
    background: "rgba(255,196,128,0.95)",
    fontSize: 15,
    rotation: -2,
  },
  {
    key: "xhs_save",
    label: "速速收藏",
    text: "速速收藏📌",
    font: "marker",
    color: "#ffffff",
    background: "rgba(112,53,232,0.9)",
    fontSize: 16,
    rotation: 3,
  },
  {
    key: "xhs_treasure",
    label: "宝藏推荐",
    text: "🌟 宝藏推荐",
    font: "rounded",
    color: "#ffffff",
    background: "rgba(0,153,143,0.9)",
    fontSize: 16,
    rotation: -4,
  },
  {
    key: "xhs_chill",
    label: "巨松弛",
    text: "巨松弛 🌿",
    font: "brush",
    color: "#22332a",
    background: "rgba(213,236,200,0.95)",
    fontSize: 16,
    rotation: -2,
  },
  {
    key: "xhs_price_perf",
    label: "极致体验",
    text: "极致体验💎",
    font: "marker",
    color: "#ffffff",
    background: "rgba(15,17,40,0.85)",
    fontSize: 16,
    rotation: 1,
  },
  {
    key: "xhs_pic_real",
    label: "实拍直出",
    text: "📸 实拍直出",
    font: "sans",
    color: "#ffffff",
    background: "rgba(0,0,0,0.55)",
    fontSize: 14,
    rotation: 0,
  },
  {
    key: "xhs_chic",
    label: "氛围感拉满",
    text: "氛围感拉满🪩",
    font: "rounded",
    color: "#3b0d2a",
    background: "rgba(255,205,234,0.95)",
    fontSize: 16,
    rotation: -3,
  },
  {
    key: "xhs_again",
    label: "还想再住",
    text: "还想再来一次！",
    font: "brush",
    color: "#ffffff",
    background: "rgba(232,89,107,0.85)",
    fontSize: 16,
    rotation: 5,
  },
];
