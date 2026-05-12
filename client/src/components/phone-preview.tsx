import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CoverDesign,
  GeneratedNote,
  StickerOverlay,
  StickerFont,
} from "@/lib/types";
import { STICKER_FONT_LIST, fontFamilyFor } from "@/lib/sticker-fonts";
import { CoverFlat } from "@/components/cover-flat";
import {
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  Plus,
  Trash2,
  Pencil,
  X,
} from "lucide-react";

interface Props {
  note: GeneratedNote;
  cover: CoverDesign;
  stickers: StickerOverlay[];
  onStickersChange: (next: StickerOverlay[]) => void;
}

export function PhonePreview({ note, cover, stickers, onStickersChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<
    | null
    | { id: string; startX: number; startY: number; origX: number; origY: number }
  >(null);

  useEffect(() => {
    if (!drag) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    function move(ev: PointerEvent) {
      if (!drag) return;
      const dx = ((ev.clientX - drag.startX) / rect.width) * 100;
      const dy = ((ev.clientY - drag.startY) / rect.height) * 100;
      onStickersChange(
        stickers.map((s) =>
          s.id === drag.id
            ? {
                ...s,
                x: clamp(drag.origX + dx, -5, 95),
                y: clamp(drag.origY + dy, -5, 95),
              }
            : s,
        ),
      );
    }
    function up() {
      setDrag(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, stickers, onStickersChange]);

  const addSticker = useCallback(() => {
    const id = `stk_${Date.now()}`;
    onStickersChange([
      ...stickers,
      {
        id,
        text: "添加文字",
        x: 30,
        y: 30,
        rotation: 0,
        font: "marker",
        color: "#ffffff",
        background: "rgba(232,89,107,0.85)",
        fontSize: 16,
      },
    ]);
    setEditingId(id);
  }, [stickers, onStickersChange]);

  const updateSticker = useCallback(
    (id: string, patch: Partial<StickerOverlay>) => {
      onStickersChange(stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [stickers, onStickersChange],
  );

  const removeSticker = useCallback(
    (id: string) => {
      onStickersChange(stickers.filter((s) => s.id !== id));
      setEditingId((s) => (s === id ? null : s));
    },
    [stickers, onStickersChange],
  );

  const editing = stickers.find((s) => s.id === editingId) || null;

  return (
    <div className="mx-auto w-[300px] md:w-[320px]" data-testid="phone-preview">
      <div className="relative rounded-[2.6rem] bg-foreground/90 dark:bg-black p-2 shadow-2xl ring-1 ring-black/10">
        <div
          className="rounded-[2.2rem] overflow-hidden bg-background relative"
          ref={stageRef}
        >
          {/* notch */}
          <div className="px-5 pt-2 pb-1 flex items-center justify-between text-[10px] text-foreground/80">
            <span>9:41</span>
            <span>● ● ●</span>
          </div>

          {/* scrollable content - like reading a xhs note */}
          <div
            className="overflow-y-auto scroll-area-hide"
            style={{ height: 620 }}
            data-testid="phone-scroll"
          >
            {/* Cover flat */}
            <div className="relative">
              <CoverFlat cover={cover} width={304} />
            </div>

            {/* Inner image cards (one per layout page after cover) */}
            {note.pageLayout.slice(1).map((p) => (
              <div
                key={p.index}
                className="relative aspect-[3/4] bg-card"
                data-testid={`phone-page-${p.index}`}
              >
                {p.imageId ? null : (
                  <div className="absolute inset-0" style={{ background: p.gradient }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                <div className="absolute bottom-3 left-3 right-3 text-white">
                  <div className="text-xs font-semibold drop-shadow">{p.headline}</div>
                  {p.caption && (
                    <div className="mt-1 text-[10px] opacity-90 line-clamp-2">{p.caption}</div>
                  )}
                </div>
              </div>
            ))}

            {/* full body */}
            <div className="px-4 py-4 text-foreground">
              <div className="text-[15px] font-bold leading-snug" data-testid="text-preview-title">
                {note.title}
              </div>
              <div className="mt-2 text-[12px] leading-relaxed whitespace-pre-line text-foreground/90" data-testid="text-preview-body">
                {note.body}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {note.tags.map((t) => (
                  <span key={t} className="text-[11px] text-primary">{t}</span>
                ))}
              </div>
              <div className="mt-4 text-[11px] text-muted-foreground">
                发布于 NoteStay · 仅根据你提供的内容生成
              </div>
            </div>
          </div>

          {/* engagement bar */}
          <div className="px-4 py-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Heart className="size-3.5" /> 12.3k</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5" /> 482</span>
            <span className="inline-flex items-center gap-1"><Bookmark className="size-3.5" /> 3.1k</span>
            <span className="inline-flex items-center gap-1"><Share2 className="size-3.5" /> 分享</span>
          </div>

          {/* sticker overlays (above scroll, fixed inside phone frame) */}
          <div className="pointer-events-none absolute inset-0">
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
                  pointerEvents: "auto",
                  cursor: "grab",
                  touchAction: "none",
                  boxShadow:
                    s.background && s.background !== "transparent"
                      ? "0 4px 14px rgba(0,0,0,0.18)"
                      : "0 2px 6px rgba(0,0,0,0.25)",
                  textShadow:
                    !s.background || s.background === "transparent"
                      ? "0 2px 6px rgba(0,0,0,0.45)"
                      : "none",
                  outline: editingId === s.id ? "2px dashed #fff" : "none",
                  outlineOffset: 2,
                  userSelect: "none",
                }}
                data-testid={`sticker-overlay-${s.id}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setEditingId(s.id);
                  setDrag({
                    id: s.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: s.x,
                    origY: s.y,
                  });
                }}
              >
                {s.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={addSticker}
          className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-xs px-3 py-1.5"
          data-testid="button-add-sticker"
        >
          <Plus className="size-3.5" /> 添加贴纸
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => removeSticker(editing.id)}
            className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 text-destructive text-xs px-3 py-1.5"
            data-testid="button-remove-sticker"
          >
            <Trash2 className="size-3.5" /> 删除当前
          </button>
        )}
      </div>

      {editing && (
        <div
          className="mt-3 rounded-2xl border border-card-border bg-card/70 p-3 text-xs space-y-2"
          data-testid="sticker-editor-panel"
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold inline-flex items-center gap-1">
              <Pencil className="size-3.5" /> 编辑贴纸
            </div>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-close-sticker-editor"
              aria-label="关闭"
            >
              <X className="size-4" />
            </button>
          </div>
          <input
            type="text"
            value={editing.text}
            onChange={(e) => updateSticker(editing.id, { text: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            data-testid="input-sticker-text"
            placeholder="贴纸文字"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-muted-foreground">字体</span>
              <select
                value={editing.font}
                onChange={(e) =>
                  updateSticker(editing.id, { font: e.target.value as StickerFont })
                }
                className="w-full rounded-md border border-input bg-background px-2 py-1"
                data-testid="select-sticker-font"
              >
                {STICKER_FONT_LIST.map((f) => (
                  <option key={f.key} value={f.key}>{f.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">字号 {editing.fontSize}px</span>
              <input
                type="range"
                min={10}
                max={36}
                value={editing.fontSize}
                onChange={(e) =>
                  updateSticker(editing.id, { fontSize: Number(e.target.value) })
                }
                className="w-full"
                data-testid="input-sticker-size"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">旋转 {editing.rotation}°</span>
              <input
                type="range"
                min={-30}
                max={30}
                value={editing.rotation}
                onChange={(e) =>
                  updateSticker(editing.id, { rotation: Number(e.target.value) })
                }
                className="w-full"
                data-testid="input-sticker-rotation"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">颜色</span>
              <input
                type="color"
                value={editing.color}
                onChange={(e) => updateSticker(editing.id, { color: e.target.value })}
                className="w-full h-7 rounded border border-input bg-background"
                data-testid="input-sticker-color"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "粉色", v: "rgba(232,89,107,0.85)" },
              { label: "黑色", v: "rgba(0,0,0,0.55)" },
              { label: "米白", v: "rgba(255,247,234,0.92)" },
              { label: "透明", v: null as string | null },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                onClick={() => updateSticker(editing.id, { background: b.v })}
                className="rounded-full border border-border bg-background px-2 py-0.5"
                data-testid={`sticker-bg-${b.label}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
