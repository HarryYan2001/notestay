import { useEffect, useRef, useState } from "react";
import type {
  GeneratedNote,
  PageDesign,
  StickerOverlay,
} from "@/lib/types";
import { PageFlat } from "@/components/page-flat";
import {
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface Props {
  note: GeneratedNote;
  pageDesigns: Record<number, PageDesign>;
  stickers: StickerOverlay[];
  selectedPageIndex: number;
  onSelectPage: (index: number) => void;
  onStickersChange: (next: StickerOverlay[]) => void;
  onTitleChange?: (title: string) => void;
  onBodyChange?: (body: string) => void;
}

// Width of the inner phone preview area in px (used to scale layouts).
const PAGE_WIDTH = 304;

export function PhonePreview({
  note,
  pageDesigns,
  stickers,
  selectedPageIndex,
  onSelectPage,
  onStickersChange,
  onTitleChange,
  onBodyChange,
}: Props) {
  const pages = note.pageLayout;
  const pagerRef = useRef<HTMLDivElement>(null);
  const suppressScrollSyncUntilRef = useRef(0);
  const [drag, setDrag] = useState<
    | null
    | { id: string; startX: number; startY: number; origX: number; origY: number }
  >(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Sync scroll position when selectedPageIndex changes from outside
  useEffect(() => {
    const idx = pages.findIndex((p) => p.index === selectedPageIndex);
    if (idx < 0) return;
    const pager = pagerRef.current;
    if (!pager) return;
    suppressScrollSyncUntilRef.current = Date.now() + 500;
    pager.scrollTo({ left: idx * PAGE_WIDTH, behavior: "smooth" });
  }, [selectedPageIndex, pages]);

  // Determine current page from scroll position
  function onScrollPager() {
    const pager = pagerRef.current;
    if (!pager) return;
    if (Date.now() < suppressScrollSyncUntilRef.current) return;
    const idx = Math.round(pager.scrollLeft / PAGE_WIDTH);
    const target = pages[idx];
    if (target && target.index !== selectedPageIndex) {
      onSelectPage(target.index);
    }
  }

  // Sticker drag handlers — bound to whichever page the sticker is on.
  useEffect(() => {
    if (!drag) return;
    const pageEl = pageRefs.current[selectedPageIndex];
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
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
  }, [drag, stickers, onStickersChange, selectedPageIndex]);

  function goPrev() {
    const idx = pages.findIndex((p) => p.index === selectedPageIndex);
    if (idx > 0) onSelectPage(pages[idx - 1].index);
  }
  function goNext() {
    const idx = pages.findIndex((p) => p.index === selectedPageIndex);
    if (idx >= 0 && idx < pages.length - 1) onSelectPage(pages[idx + 1].index);
  }

  return (
    <div className="mx-auto w-[300px] md:w-[320px]" data-testid="phone-preview">
      <div className="relative rounded-[2.6rem] bg-foreground/90 dark:bg-black p-2 shadow-2xl ring-1 ring-black/10">
        <div className="rounded-[2.2rem] overflow-hidden bg-background relative">
          {/* notch */}
          <div className="px-5 pt-2 pb-1 flex items-center justify-between text-[10px] text-foreground/80">
            <span>9:41</span>
            <span>● ● ●</span>
          </div>

          {/* Horizontal pager for image pages */}
          <div className="relative">
            <div
              ref={pagerRef}
              onScroll={onScrollPager}
              className="relative z-0 flex overflow-x-auto snap-x snap-mandatory scroll-area-hide"
              style={{ scrollSnapType: "x mandatory" }}
              data-testid="phone-image-pager"
            >
              {pages.map((p) => {
                const design =
                  pageDesigns[p.index] || fallbackDesign(p.gradient);
                const pageStickers = stickers.filter(
                  (s) => s.pageIndex === p.index,
                );
                return (
                  <div
                    key={p.index}
                    ref={(el) => {
                      pageRefs.current[p.index] = el;
                    }}
                    className="relative shrink-0 snap-center"
                    style={{ width: PAGE_WIDTH, height: Math.round((PAGE_WIDTH * 4) / 3) }}
                    data-testid={`phone-page-${p.index}`}
                  >
                    {/* Composed flat layer (design + stickers in one render) */}
                    <PageFlat
                      design={design}
                      stickers={pageStickers}
                      width={PAGE_WIDTH}
                    />
                    {/* Sticker drag affordance overlay — invisible hit targets on top of composed flat */}
                    <div className="absolute inset-0">
                      {pageStickers.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            position: "absolute",
                            left: `${s.x}%`,
                            top: `${s.y}%`,
                            transform: `rotate(${s.rotation}deg)`,
                            fontFamily: "inherit",
                            fontSize: s.fontSize,
                            fontWeight: 700,
                            padding: "4px 10px",
                            borderRadius: 14,
                            cursor: "grab",
                            touchAction: "none",
                            color: "transparent",
                            userSelect: "none",
                            zIndex: 1100,
                          }}
                          data-testid={`sticker-overlay-${s.id}`}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectPage(p.index);
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
                );
              })}
            </div>

            {/* Pager arrows */}
            {pages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  className="absolute left-1 top-1/2 z-20 -translate-y-1/2 size-7 rounded-full bg-black/40 text-white inline-flex items-center justify-center backdrop-blur-sm"
                  data-testid="phone-page-prev"
                  aria-label="上一张"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="absolute right-1 top-1/2 z-20 -translate-y-1/2 size-7 rounded-full bg-black/40 text-white inline-flex items-center justify-center backdrop-blur-sm"
                  data-testid="phone-page-next"
                  aria-label="下一张"
                >
                  <ChevronRight className="size-4" />
                </button>
              </>
            )}
            {/* Page dots */}
            <div className="absolute bottom-2 left-0 right-0 z-20 flex justify-center gap-1.5 pointer-events-auto">
              {pages.map((p, i) => (
                <button
                  key={p.index}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectPage(p.index);
                  }}
                  className={`h-1.5 rounded-full transition-all ${
                    p.index === selectedPageIndex
                      ? "w-4 bg-white"
                      : "w-1.5 bg-white/60"
                  }`}
                  data-testid={`phone-page-dot-${p.index}`}
                  aria-label={`第 ${i + 1} 张`}
                />
              ))}
            </div>
          </div>

          {/* Body text — directly editable in preview. */}
          <div
            className="overflow-y-auto scroll-area-hide px-4 py-4 text-foreground"
            style={{ maxHeight: 320 }}
            data-testid="phone-body-scroll"
          >
            <InlineEditable
              className="text-[15px] font-bold leading-snug outline-none focus:bg-primary/5 rounded-md -mx-1 px-1 cursor-text"
              value={note.title}
              onChange={(v) => onTitleChange?.(v)}
              placeholder="编辑标题"
              singleLine
              testId="phone-edit-title"
              title="双击或单击进入编辑"
            />
            <InlineEditable
              className="mt-2 text-[12px] leading-relaxed whitespace-pre-line text-foreground/90 outline-none focus:bg-primary/5 rounded-md -mx-1 px-1 cursor-text"
              value={note.body}
              onChange={(v) => onBodyChange?.(v)}
              placeholder="编辑正文"
              testId="phone-edit-body"
              title="双击或单击进入编辑"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {note.tags.map((t) => (
                <span key={t} className="text-[11px] text-primary">{t}</span>
              ))}
            </div>
            <div className="mt-4 text-[11px] text-muted-foreground">
              发布于 NoteStay · 仅根据你提供的内容生成
            </div>
          </div>

          {/* engagement bar */}
          <div className="px-4 py-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Heart className="size-3.5" /> 12.3k</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5" /> 482</span>
            <span className="inline-flex items-center gap-1"><Bookmark className="size-3.5" /> 3.1k</span>
            <span className="inline-flex items-center gap-1"><Share2 className="size-3.5" /> 分享</span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        左右滑动切换图片页 · 当前第 {Math.max(0, pages.findIndex((p) => p.index === selectedPageIndex)) + 1} /
        {pages.length} 张 · 双击标题/正文进入编辑
      </p>
    </div>
  );
}

function fallbackDesign(gradient: string): PageDesign {
  return {
    background: gradient,
    bgImageUrl: null,
    layers: [],
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Contenteditable wrapper that commits on blur and supports multi-line text.
// Double-clicking focuses the field and selects all so the user sees they are
// in edit mode immediately. Single-clicking also focuses (standard
// contentEditable behavior) — both gestures work.
function InlineEditable({
  value,
  onChange,
  className,
  placeholder,
  singleLine,
  testId,
  title,
}: {
  tag?: "div" | "span";
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  singleLine?: boolean;
  testId?: string;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync DOM with value when value changes externally (e.g. regenerate).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerText !== value) {
      el.innerText = value;
    }
  }, [value]);

  function commit() {
    const el = ref.current;
    if (!el) return;
    const next = el.innerText;
    if (next !== value) onChange(next);
  }

  function selectAll() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className={className}
      onBlur={commit}
      onDoubleClick={selectAll}
      onKeyDown={(e) => {
        if (singleLine && e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).blur();
        }
      }}
      data-testid={testId}
      data-placeholder={placeholder}
      role="textbox"
      aria-label={placeholder}
      title={title}
    />
  );
}
