import type { StickerFont } from "./types";

export const STICKER_FONT_LIST: { key: StickerFont; name: string; css: string }[] = [
  { key: "sans", name: "无衬线 · 默认", css: "'PingFang SC','Hiragino Sans','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif" },
  { key: "serif", name: "宋体 · 优雅", css: "'Songti SC','SimSun','STSong',ui-serif,Georgia,serif" },
  { key: "rounded", name: "圆体 · 可爱", css: "'PingFang SC Rounded','Hiragino Maru Gothic ProN','Yuanti SC','M PLUS Rounded 1c',ui-rounded,sans-serif" },
  { key: "mono", name: "等宽 · 杂志", css: "'Menlo','SFMono-Regular','Cascadia Mono',ui-monospace,monospace" },
  { key: "brush", name: "毛笔 · 手写", css: "'KaiTi','STKaiti','Brush Script MT',cursive" },
  { key: "marker", name: "马克笔 · 涂鸦", css: "'Yuanti SC','Comic Sans MS','Marker Felt','PingFang SC',sans-serif" },
];

export function fontFamilyFor(key: StickerFont): string {
  const f = STICKER_FONT_LIST.find((x) => x.key === key);
  return f?.css ?? STICKER_FONT_LIST[0].css;
}
