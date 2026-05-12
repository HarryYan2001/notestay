import type { CoverDesign } from "@/lib/types";
import { fontFamilyFor } from "@/lib/sticker-fonts";

interface Props {
  cover: CoverDesign;
  width?: number;
}

export function CoverFlat({ cover, width = 320 }: Props) {
  const height = Math.round((width * 4) / 3);
  return (
    <div
      className="relative overflow-hidden select-none"
      style={{ width, height, background: cover.background }}
      data-testid="cover-flat"
    >
      {cover.bgImageUrl && (
        <img
          src={cover.bgImageUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          draggable={false}
        />
      )}
      {[...cover.layers]
        .sort((a, b) => a.z - b.z)
        .map((l) => {
          const common: React.CSSProperties = {
            position: "absolute",
            left: `${l.x}%`,
            top: `${l.y}%`,
            width: `${l.w}%`,
            height: `${l.h}%`,
            transform: `rotate(${l.rotation}deg)`,
            transformOrigin: "center",
            zIndex: l.z,
          };
          if (l.type === "image") {
            return (
              <div
                key={l.id}
                style={{
                  ...common,
                  borderRadius: l.radius,
                  overflow: "hidden",
                  boxShadow: l.shadow ? "0 8px 24px rgba(0,0,0,0.25)" : "none",
                }}
              >
                <img
                  src={l.imageUrl}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: `${l.offsetX}% ${l.offsetY}%`,
                    // Floor render zoom at 1 so the image fills the frame
                    // edge-to-edge — the module bounds always match the
                    // visible photo bounds, no exposed background.
                    transform: `scale(${Math.max(1, l.zoom)})`,
                    transformOrigin: `${l.offsetX}% ${l.offsetY}%`,
                  }}
                />
              </div>
            );
          }
          return (
            <div
              key={l.id}
              style={{
                ...common,
                display: "flex",
                alignItems: "center",
                justifyContent:
                  l.align === "left"
                    ? "flex-start"
                    : l.align === "right"
                    ? "flex-end"
                    : "center",
                background: l.background ?? "transparent",
                borderRadius: 14,
                padding: "6px 10px",
              }}
            >
              <div
                style={{
                  color: l.color,
                  fontSize: l.fontSize,
                  fontWeight: l.fontWeight,
                  fontFamily: fontFamilyFor(l.font),
                  lineHeight: 1.05,
                  textAlign: l.align,
                  width: "100%",
                  whiteSpace: "pre-wrap",
                  textShadow: l.shadow ? "0 2px 8px rgba(0,0,0,0.45)" : "none",
                }}
              >
                {l.text}
              </div>
            </div>
          );
        })}
    </div>
  );
}
