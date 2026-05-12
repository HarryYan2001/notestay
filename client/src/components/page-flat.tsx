import type { PageDesign, StickerOverlay } from "@/lib/types";
import { fontFamilyFor } from "@/lib/sticker-fonts";
import { CoverFlat } from "@/components/cover-flat";

interface Props {
  design: PageDesign;
  stickers: StickerOverlay[];
  width?: number;
  testId?: string;
}

// Flat (non-interactive) render of a page design with bound stickers.
// Used for the phone preview and for offscreen export rendering.
export function PageFlat({ design, stickers, width = 320, testId }: Props) {
  const height = Math.round((width * 4) / 3);
  return (
    <div
      className="relative overflow-hidden"
      style={{ width, height }}
      data-testid={testId}
    >
      <CoverFlat cover={design} width={width} />
      {stickers.map((s) => (
        <div
          key={s.id}
          style={{
            position: "absolute",
            left: `${s.x}%`,
            top: `${s.y}%`,
            transform: `rotate(${s.rotation}deg)`,
            color: s.color,
            background: s.background ?? "transparent",
            fontFamily: fontFamilyFor(s.font),
            fontSize: s.fontSize,
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: 14,
            boxShadow:
              s.background && s.background !== "transparent"
                ? "0 4px 14px rgba(0,0,0,0.18)"
                : "0 2px 6px rgba(0,0,0,0.25)",
            textShadow:
              !s.background || s.background === "transparent"
                ? "0 2px 6px rgba(0,0,0,0.45)"
                : "none",
            userSelect: "none",
            zIndex: 1000,
          }}
        >
          {s.text}
        </div>
      ))}
    </div>
  );
}
