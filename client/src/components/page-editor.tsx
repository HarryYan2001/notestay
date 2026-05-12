import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CoverImageLayer,
  CoverLayer,
  CoverTextLayer,
  PageDesign,
  PageLayout,
  StickerFont,
  StickerOverlay,
} from "@/lib/types";
import { STICKER_FONT_LIST, fontFamilyFor } from "@/lib/sticker-fonts";
import {
  Trash2,
  Image as ImageIcon,
  Type,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Upload,
  Pencil,
  X,
  Sticker,
  Move,
  Settings,
  ArrowUpToLine,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Repeat,
} from "lucide-react";

interface Props {
  page: PageLayout;
  pageCount: number;
  pageOrdinal: number;
  design: PageDesign;
  stickers: StickerOverlay[]; // already filtered to this page
  onChangeDesign: (next: PageDesign) => void;
  onChangeStickers: (next: StickerOverlay[]) => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  width?: number;
  testIdPrefix?: string;
}

type DragState =
  | { kind: "move"; layerId: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize"; layerId: string; startX: number; startY: number; origW: number; origH: number; origRot: number; centerX: number; centerY: number; startAngle: number }
  | { kind: "rotate"; layerId: string; centerX: number; centerY: number; startAngle: number; origRot: number }
  | { kind: "imgpan"; layerId: string; startX: number; startY: number; origOX: number; origOY: number };

type StickerDrag =
  | { kind: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: "rotate"; id: string; centerX: number; centerY: number; startAngle: number; origRot: number };

export function PageEditor({
  page,
  pageCount,
  pageOrdinal,
  design,
  stickers,
  onChangeDesign,
  onChangeStickers,
  onPrevPage,
  onNextPage,
  width = 320,
  testIdPrefix = "page",
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [stickerDrag, setStickerDrag] = useState<StickerDrag | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const stageH = Math.round((width * 4) / 3);

  const selected = design.layers.find((l) => l.id === selectedId) || null;
  const selectedSticker = stickers.find((s) => s.id === selectedStickerId) || null;

  // Hide settings when nothing is selected.
  useEffect(() => {
    if (!selected && !selectedSticker) setSettingsOpen(false);
  }, [selected, selectedSticker]);

  const updateLayer = useCallback(
    (id: string, patch: Partial<CoverLayer>) => {
      onChangeDesign({
        ...design,
        layers: design.layers.map((l) =>
          l.id === id ? ({ ...l, ...patch } as CoverLayer) : l,
        ),
      });
    },
    [design, onChangeDesign],
  );

  const removeLayer = useCallback(
    (id: string) => {
      onChangeDesign({
        ...design,
        layers: design.layers.filter((l) => l.id !== id),
      });
      setSelectedId((s) => (s === id ? null : s));
      setEditingImageId((s) => (s === id ? null : s));
    },
    [design, onChangeDesign],
  );

  const bringToFront = useCallback(
    (id: string) => {
      const max = Math.max(0, ...design.layers.map((l) => l.z));
      updateLayer(id, { z: max + 1 });
    },
    [design.layers, updateLayer],
  );
  const sendToBack = useCallback(
    (id: string) => {
      const min = Math.min(0, ...design.layers.map((l) => l.z));
      updateLayer(id, { z: min - 1 });
    },
    [design.layers, updateLayer],
  );

  // Drag/move/resize/rotate/imgpan handlers
  useEffect(() => {
    if (!drag) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    function move(ev: PointerEvent) {
      if (!drag) return;
      if (drag.kind === "move") {
        const dxPct = ((ev.clientX - drag.startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - drag.startY) / rect.height) * 100;
        updateLayer(drag.layerId, {
          x: clamp(drag.origX + dxPct, -10, 105),
          y: clamp(drag.origY + dyPct, -10, 105),
        });
      } else if (drag.kind === "resize") {
        const dxPct = ((ev.clientX - drag.startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - drag.startY) / rect.height) * 100;
        updateLayer(drag.layerId, {
          w: clamp(drag.origW + dxPct, 8, 110),
          h: clamp(drag.origH + dyPct, 4, 110),
        });
      } else if (drag.kind === "rotate") {
        const ang = Math.atan2(ev.clientY - drag.centerY, ev.clientX - drag.centerX);
        const deg = (ang - drag.startAngle) * (180 / Math.PI);
        updateLayer(drag.layerId, { rotation: Math.round(drag.origRot + deg) });
      } else if (drag.kind === "imgpan") {
        const dxPct = ((ev.clientX - drag.startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - drag.startY) / rect.height) * 100;
        const layer = design.layers.find((l) => l.id === drag.layerId);
        if (layer?.type !== "image") return;
        updateLayer(drag.layerId, {
          offsetX: clamp(drag.origOX - dxPct * 0.6, 0, 100),
          offsetY: clamp(drag.origOY - dyPct * 0.6, 0, 100),
        });
      }
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
  }, [drag, design.layers, updateLayer]);

  // Sticker drag handlers
  useEffect(() => {
    if (!stickerDrag) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    function move(ev: PointerEvent) {
      if (!stickerDrag) return;
      if (stickerDrag.kind === "move") {
        const dxPct = ((ev.clientX - stickerDrag.startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - stickerDrag.startY) / rect.height) * 100;
        onChangeStickers(
          stickers.map((s) =>
            s.id === stickerDrag.id
              ? {
                  ...s,
                  x: clamp(stickerDrag.origX + dxPct, -5, 95),
                  y: clamp(stickerDrag.origY + dyPct, -5, 95),
                }
              : s,
          ),
        );
      } else {
        const ang = Math.atan2(
          ev.clientY - stickerDrag.centerY,
          ev.clientX - stickerDrag.centerX,
        );
        const deg = (ang - stickerDrag.startAngle) * (180 / Math.PI);
        onChangeStickers(
          stickers.map((s) =>
            s.id === stickerDrag.id
              ? { ...s, rotation: Math.round(stickerDrag.origRot + deg) }
              : s,
          ),
        );
      }
    }
    function up() {
      setStickerDrag(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [stickerDrag, stickers, onChangeStickers]);

  function startMove(e: React.PointerEvent, l: CoverLayer) {
    e.stopPropagation();
    setSelectedId(l.id);
    setSelectedStickerId(null);
    setDrag({
      kind: "move",
      layerId: l.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: l.x,
      origY: l.y,
    });
  }
  function startResize(e: React.PointerEvent, l: CoverLayer, _target: HTMLElement) {
    e.stopPropagation();
    setDrag({
      kind: "resize",
      layerId: l.id,
      startX: e.clientX,
      startY: e.clientY,
      origW: l.w,
      origH: l.h,
      origRot: l.rotation,
      centerX: 0,
      centerY: 0,
      startAngle: 0,
    });
  }
  function startRotate(e: React.PointerEvent, l: CoverLayer, target: HTMLElement) {
    e.stopPropagation();
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setDrag({
      kind: "rotate",
      layerId: l.id,
      centerX: cx,
      centerY: cy,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
      origRot: l.rotation,
    });
  }
  function startImgPan(e: React.PointerEvent, l: CoverImageLayer) {
    e.stopPropagation();
    setDrag({
      kind: "imgpan",
      layerId: l.id,
      startX: e.clientX,
      startY: e.clientY,
      origOX: l.offsetX,
      origOY: l.offsetY,
    });
  }

  function startStickerMove(e: React.PointerEvent, s: StickerOverlay) {
    e.stopPropagation();
    setSelectedStickerId(s.id);
    setSelectedId(null);
    setStickerDrag({
      kind: "move",
      id: s.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: s.x,
      origY: s.y,
    });
  }
  function startStickerRotate(e: React.PointerEvent, s: StickerOverlay, target: HTMLElement) {
    e.stopPropagation();
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setStickerDrag({
      kind: "rotate",
      id: s.id,
      centerX: cx,
      centerY: cy,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
      origRot: s.rotation,
    });
  }

  function addTextLayer() {
    const id = `lyr_t_${Date.now()}`;
    const max = Math.max(0, ...design.layers.map((l) => l.z));
    const newLayer: CoverTextLayer = {
      id,
      type: "text",
      text: "新增文字",
      x: 20,
      y: 45,
      w: 60,
      h: 12,
      rotation: 0,
      z: max + 1,
      color: "#ffffff",
      fontSize: 22,
      fontWeight: 800,
      font: "sans",
      align: "center",
      background: "rgba(0,0,0,0.35)",
      shadow: true,
    };
    onChangeDesign({ ...design, layers: [...design.layers, newLayer] });
    setSelectedId(id);
    setSelectedStickerId(null);
  }

  function onPickImage(files: FileList | null, mode: "add" | "replace") {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    if (mode === "replace" && selected?.type === "image") {
      updateLayer(selected.id, { imageUrl: url });
    } else {
      const id = `lyr_i_${Date.now()}`;
      const max = Math.max(0, ...design.layers.map((l) => l.z));
      const newLayer: CoverImageLayer = {
        id,
        type: "image",
        imageUrl: url,
        x: 20,
        y: 30,
        w: 60,
        h: 40,
        rotation: 0,
        z: max + 1,
        offsetX: 50,
        offsetY: 50,
        zoom: 1,
        radius: 14,
        shadow: true,
      };
      onChangeDesign({ ...design, layers: [...design.layers, newLayer] });
      setSelectedId(id);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (replaceInputRef.current) replaceInputRef.current.value = "";
  }

  function replaceBackgroundImage(files: FileList | null) {
    if (!files || !files[0]) return;
    const url = URL.createObjectURL(files[0]);
    onChangeDesign({ ...design, bgImageUrl: url });
  }

  // Wheel zoom while in image edit mode
  function onLayerWheel(e: React.WheelEvent, l: CoverImageLayer) {
    if (editingImageId !== l.id) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const next = clampNum(l.zoom + delta, 0.5, 3);
    updateLayer(l.id, { zoom: Number(next.toFixed(2)) });
  }

  // Stickers
  function addSticker() {
    const id = `stk_${Date.now()}`;
    onChangeStickers([
      ...stickers,
      {
        id,
        pageIndex: page.index,
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
    setSelectedStickerId(id);
    setSelectedId(null);
  }
  function updateSticker(id: string, patch: Partial<StickerOverlay>) {
    onChangeStickers(stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeSticker(id: string) {
    onChangeStickers(stickers.filter((s) => s.id !== id));
    setSelectedStickerId((s) => (s === id ? null : s));
  }

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-editor`}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={!onPrevPage || pageOrdinal <= 1}
            className="inline-flex items-center justify-center size-7 rounded-full border border-border bg-card hover-elevate disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`${testIdPrefix}-prev-page`}
            aria-label="上一张"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div>
            正在编辑 ·
            <span className="ml-1 font-semibold text-foreground" data-testid={`${testIdPrefix}-current-index`}>
              第 {pageOrdinal} / {pageCount} 张
            </span>
            <span className="ml-1">{page.index === 0 ? "(封面)" : `(${page.role})`}</span>
          </div>
          <button
            type="button"
            onClick={onNextPage}
            disabled={!onNextPage || pageOrdinal >= pageCount}
            className="inline-flex items-center justify-center size-7 rounded-full border border-border bg-card hover-elevate disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`${testIdPrefix}-next-page`}
            aria-label="下一张"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="text-[11px] hidden md:block">点击图层选中,双击图片进入裁切模式(滚轮缩放)</div>
      </div>

      <div
        ref={stageRef}
        className="relative mx-auto overflow-hidden rounded-2xl shadow-lg select-none"
        style={{
          width,
          height: stageH,
          background: design.background,
        }}
        onPointerDown={() => {
          setSelectedId(null);
          setSelectedStickerId(null);
          setEditingImageId(null);
        }}
        data-testid={`${testIdPrefix}-stage`}
      >
        {design.bgImageUrl && (
          <img
            src={design.bgImageUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
        )}
        {/* layers */}
        {[...design.layers]
          .sort((a, b) => a.z - b.z)
          .map((l) => {
            const isSelected = l.id === selectedId;
            const common: React.CSSProperties = {
              position: "absolute",
              left: `${l.x}%`,
              top: `${l.y}%`,
              width: `${l.w}%`,
              height: `${l.h}%`,
              transform: `rotate(${l.rotation}deg)`,
              transformOrigin: "center",
              zIndex: l.z,
              cursor: "grab",
              touchAction: "none",
            };
            if (l.type === "image") {
              const isImageEditing = editingImageId === l.id;
              return (
                <div
                  key={l.id}
                  style={{
                    ...common,
                    borderRadius: l.radius,
                    boxShadow: l.shadow ? "0 8px 24px rgba(0,0,0,0.25)" : "none",
                    outline: isSelected ? "2px solid #fff" : "none",
                    outlineOffset: isSelected ? 2 : 0,
                  }}
                  data-testid={`${testIdPrefix}-layer-${l.id}`}
                  onPointerDown={(e) => {
                    if (isSelected && isImageEditing) {
                      startImgPan(e, l);
                    } else {
                      startMove(e, l);
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(l.id);
                    setEditingImageId(l.id);
                  }}
                  onWheel={(e) => onLayerWheel(e, l)}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: l.radius,
                      overflow: "hidden",
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
                        transform: `scale(${l.zoom})`,
                        transformOrigin: `${l.offsetX}% ${l.offsetY}%`,
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                  {isSelected && (
                    <>
                      <CornerButton
                        position="tl"
                        label="换图"
                        onClick={() => replaceInputRef.current?.click()}
                        testId={`${testIdPrefix}-corner-replace-${l.id}`}
                        icon={<Repeat className="size-3" />}
                      />
                      <CornerButton
                        position="tr"
                        label=""
                        onClick={() => removeLayer(l.id)}
                        testId={`${testIdPrefix}-corner-delete-${l.id}`}
                        icon={<Trash2 className="size-3" />}
                        variant="danger"
                        title="删除图层"
                      />
                      <CornerButton
                        position="bl"
                        label=""
                        onClick={() => setSettingsOpen((v) => !v)}
                        testId={`${testIdPrefix}-corner-settings-${l.id}`}
                        icon={<Settings className="size-3" />}
                        title="详细设置"
                      />
                      <ResizeRotateGroup
                        onResize={(e) => {
                          const target = (e.currentTarget as HTMLElement).parentElement?.parentElement as HTMLElement;
                          startResize(e, l, target);
                        }}
                        onRotate={(e) => {
                          const target = (e.currentTarget as HTMLElement).parentElement?.parentElement as HTMLElement;
                          startRotate(e, l, target);
                        }}
                        testIdResize={`${testIdPrefix}-corner-resize-${l.id}`}
                        testIdRotate={`${testIdPrefix}-corner-rotate-${l.id}`}
                      />
                      {isImageEditing && (
                        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white whitespace-nowrap">
                          <Move className="size-3" /> 拖动 / 滚轮缩放
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            }
            // text
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
                  outline: isSelected ? "2px dashed #fff" : "none",
                  outlineOffset: 2,
                }}
                data-testid={`${testIdPrefix}-layer-${l.id}`}
                onPointerDown={(e) => startMove(e, l)}
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
                    pointerEvents: "none",
                  }}
                >
                  {l.text}
                </div>
                {isSelected && (
                  <>
                    <CornerButton
                      position="tr"
                      label=""
                      onClick={() => removeLayer(l.id)}
                      testId={`${testIdPrefix}-corner-delete-${l.id}`}
                      icon={<Trash2 className="size-3" />}
                      variant="danger"
                      title="删除图层"
                    />
                    <CornerButton
                      position="bl"
                      label=""
                      onClick={() => setSettingsOpen((v) => !v)}
                      testId={`${testIdPrefix}-corner-settings-${l.id}`}
                      icon={<Settings className="size-3" />}
                      title="详细设置"
                    />
                    <ResizeRotateGroup
                      onResize={(e) => {
                        const target = (e.currentTarget as HTMLElement).parentElement?.parentElement as HTMLElement;
                        startResize(e, l, target);
                      }}
                      onRotate={(e) => {
                        const target = (e.currentTarget as HTMLElement).parentElement?.parentElement as HTMLElement;
                        startRotate(e, l, target);
                      }}
                      testIdResize={`${testIdPrefix}-corner-resize-${l.id}`}
                      testIdRotate={`${testIdPrefix}-corner-rotate-${l.id}`}
                    />
                  </>
                )}
              </div>
            );
          })}

        {/* Stickers — rendered on top */}
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
              outline: s.id === selectedStickerId ? "2px dashed #fff" : "none",
              outlineOffset: 2,
              userSelect: "none",
              zIndex: 1000,
            }}
            data-testid={`${testIdPrefix}-sticker-${s.id}`}
            onPointerDown={(e) => startStickerMove(e, s)}
          >
            {s.text}
            {s.id === selectedStickerId && (
              <RotateHandle
                onPointerDown={(e) => {
                  const target = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                  startStickerRotate(e, s, target);
                }}
                testId={`${testIdPrefix}-sticker-rotate-${s.id}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPickImage(e.target.files, "add")}
        data-testid={`${testIdPrefix}-file-input`}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPickImage(e.target.files, "replace")}
        data-testid={`${testIdPrefix}-replace-input`}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 hover-elevate"
          onClick={() => fileInputRef.current?.click()}
          data-testid={`${testIdPrefix}-add-image`}
        >
          <ImageIcon className="size-3.5" /> 新增图片
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 hover-elevate"
          onClick={addTextLayer}
          data-testid={`${testIdPrefix}-add-text`}
        >
          <Type className="size-3.5" /> 新增文字
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 hover-elevate"
          onClick={addSticker}
          data-testid={`${testIdPrefix}-add-sticker`}
        >
          <Sticker className="size-3.5" /> 添加贴纸
        </button>
        <label
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 hover-elevate cursor-pointer"
          data-testid={`${testIdPrefix}-bg-image`}
        >
          <Upload className="size-3.5" /> 换背景图
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => replaceBackgroundImage(e.target.files)}
          />
        </label>
        {design.bgImageUrl && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 hover-elevate"
            onClick={() => onChangeDesign({ ...design, bgImageUrl: null })}
            data-testid={`${testIdPrefix}-bg-clear`}
          >
            <Trash2 className="size-3.5" /> 移除背景图
          </button>
        )}
        {selected && (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 hover-elevate"
              onClick={() => bringToFront(selected.id)}
              data-testid={`${testIdPrefix}-bring-front`}
            >
              <ArrowUpToLine className="size-3.5" /> 置顶
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 hover-elevate"
              onClick={() => sendToBack(selected.id)}
              data-testid={`${testIdPrefix}-send-back`}
            >
              <ArrowDownToLine className="size-3.5" /> 置底
            </button>
          </>
        )}
      </div>

      {/* Settings panel: hidden until user clicks the bottom-left settings on a layer */}
      {settingsOpen && selected ? (
        <div
          className="rounded-2xl border border-card-border bg-card/70 p-3 text-xs space-y-3"
          data-testid={`${testIdPrefix}-selected-panel`}
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              {selected.type === "image" ? "图片图层详细设置" : "文字图层详细设置"}
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-full border border-border px-2 py-0.5 hover-elevate inline-flex items-center gap-1"
              data-testid={`${testIdPrefix}-close-settings`}
            >
              <X className="size-3" /> 收起
            </button>
          </div>

          {selected.type === "image" ? (
            <ImageLayerPanel
              layer={selected}
              onChange={(p) => updateLayer(selected.id, p)}
              onTogglePan={() =>
                setEditingImageId((s) => (s === selected.id ? null : selected.id))
              }
              panEditing={editingImageId === selected.id}
              testIdPrefix={testIdPrefix}
            />
          ) : (
            <TextLayerPanel
              layer={selected}
              onChange={(p) => updateLayer(selected.id, p)}
              testIdPrefix={testIdPrefix}
            />
          )}
        </div>
      ) : selectedSticker ? (
        <div
          className="rounded-2xl border border-card-border bg-card/70 p-3 text-xs space-y-2"
          data-testid={`${testIdPrefix}-sticker-panel`}
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold inline-flex items-center gap-1">
              <Pencil className="size-3.5" /> 编辑贴纸
            </div>
            <button
              type="button"
              onClick={() => removeSticker(selectedSticker.id)}
              className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5"
              data-testid={`${testIdPrefix}-sticker-delete`}
            >
              <Trash2 className="size-3" /> 删除
            </button>
          </div>
          <input
            type="text"
            value={selectedSticker.text}
            onChange={(e) => updateSticker(selectedSticker.id, { text: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            data-testid={`${testIdPrefix}-sticker-text`}
            placeholder="贴纸文字"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-muted-foreground">字体</span>
              <select
                value={selectedSticker.font}
                onChange={(e) =>
                  updateSticker(selectedSticker.id, { font: e.target.value as StickerFont })
                }
                className="w-full rounded-md border border-input bg-background px-2 py-1"
                data-testid={`${testIdPrefix}-sticker-font`}
              >
                {STICKER_FONT_LIST.map((f) => (
                  <option key={f.key} value={f.key}>{f.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">字号 {selectedSticker.fontSize}px</span>
              <input
                type="range"
                min={10}
                max={36}
                value={selectedSticker.fontSize}
                onChange={(e) =>
                  updateSticker(selectedSticker.id, { fontSize: Number(e.target.value) })
                }
                className="w-full"
                data-testid={`${testIdPrefix}-sticker-size`}
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">旋转 {selectedSticker.rotation}°</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={selectedSticker.rotation}
                onChange={(e) =>
                  updateSticker(selectedSticker.id, { rotation: Number(e.target.value) })
                }
                className="w-full"
                data-testid={`${testIdPrefix}-sticker-rotation`}
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">颜色</span>
              <input
                type="color"
                value={selectedSticker.color}
                onChange={(e) => updateSticker(selectedSticker.id, { color: e.target.value })}
                className="w-full h-7 rounded border border-input bg-background"
                data-testid={`${testIdPrefix}-sticker-color`}
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
                onClick={() => updateSticker(selectedSticker.id, { background: b.v })}
                className="rounded-full border border-border bg-background px-2 py-0.5"
                data-testid={`${testIdPrefix}-sticker-bg-${b.label}`}
              >
                {b.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedStickerId(null)}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover-elevate"
              data-testid={`${testIdPrefix}-sticker-close`}
            >
              <X className="size-3" /> 关闭
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 p-3 text-xs text-muted-foreground">
          点击图层选中后:右下角拖动可缩放/旋转;左上角"换图";右上角删除;左下角设置查看详细参数;双击图片进入裁切模式(滚轮缩放)。
        </div>
      )}
    </div>
  );
}

function CornerButton({
  position,
  label,
  onClick,
  testId,
  icon,
  variant,
  title,
}: {
  position: "tl" | "tr" | "bl";
  label: string;
  onClick: () => void;
  testId: string;
  icon: React.ReactNode;
  variant?: "danger";
  title?: string;
}) {
  const pos: React.CSSProperties = {
    position: "absolute",
    zIndex: 5,
  };
  const offset = -10;
  if (position === "tl") {
    pos.top = offset;
    pos.left = offset;
  } else if (position === "tr") {
    pos.top = offset;
    pos.right = offset;
  } else if (position === "bl") {
    pos.bottom = offset;
    pos.left = offset;
  }
  const bgClass =
    variant === "danger"
      ? "bg-rose-500 text-white"
      : "bg-white/95 text-foreground";
  return (
    <button
      type="button"
      style={pos}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-1 shadow border border-black/10 ${bgClass} hover:scale-105 transition`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      data-testid={testId}
      title={title || label}
    >
      {icon}
      {label && <span className="text-[10px] font-medium">{label}</span>}
    </button>
  );
}

function ResizeRotateGroup({
  onResize,
  onRotate,
  testIdResize,
  testIdRotate,
}: {
  onResize: (e: React.PointerEvent) => void;
  onRotate: (e: React.PointerEvent) => void;
  testIdResize: string;
  testIdRotate: string;
}) {
  return (
    <div
      className="absolute -right-2 -bottom-2 inline-flex items-center gap-1 rounded-full bg-white/95 shadow border border-black/10 px-1 py-0.5"
      style={{ zIndex: 5 }}
    >
      <button
        type="button"
        className="inline-flex items-center justify-center size-4 rounded-full hover:bg-primary/10 cursor-grab"
        onPointerDown={onRotate}
        onClick={(e) => e.stopPropagation()}
        data-testid={testIdRotate}
        title="旋转"
        aria-label="旋转"
      >
        <RotateCcw className="size-3 text-primary" />
      </button>
      <span className="block w-px h-3 bg-border" />
      <button
        type="button"
        className="inline-flex items-center justify-center size-4 rounded-full hover:bg-primary/10 cursor-se-resize"
        onPointerDown={onResize}
        onClick={(e) => e.stopPropagation()}
        data-testid={testIdResize}
        title="拖动调整大小"
        aria-label="调整大小"
      >
        <span className="block size-2 rounded-full border-2 border-primary" />
      </button>
    </div>
  );
}

function RotateHandle({
  onPointerDown,
  testId,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  testId: string;
}) {
  return (
    <div
      className="absolute -top-3 left-1/2 -translate-x-1/2 size-4 rounded-full bg-white shadow inline-flex items-center justify-center cursor-grab"
      onPointerDown={onPointerDown}
      data-testid={testId}
      title="旋转"
    >
      <span className="block size-2 rounded-full border-2 border-primary" />
    </div>
  );
}

function ImageLayerPanel({
  layer,
  onChange,
  onTogglePan,
  panEditing,
  testIdPrefix,
}: {
  layer: CoverImageLayer;
  onChange: (p: Partial<CoverImageLayer>) => void;
  onTogglePan: () => void;
  panEditing: boolean;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
            panEditing
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border bg-background hover-elevate"
          }`}
          onClick={onTogglePan}
          data-testid={`${testIdPrefix}-pan-image`}
        >
          <Move className="size-3" /> {panEditing ? "退出调整图片" : "调整图片位置"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 hover-elevate"
          onClick={() => onChange({ zoom: Math.max(0.5, Number((layer.zoom - 0.08).toFixed(2))) })}
          data-testid={`${testIdPrefix}-zoom-out`}
        >
          <ZoomOut className="size-3" /> 缩小
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 hover-elevate"
          onClick={() => onChange({ zoom: Math.min(3, Number((layer.zoom + 0.08).toFixed(2))) })}
          data-testid={`${testIdPrefix}-zoom-in`}
        >
          <ZoomIn className="size-3" /> 放大
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 hover-elevate"
          onClick={() =>
            onChange({ offsetX: 50, offsetY: 50, zoom: 1, rotation: 0 })
          }
          data-testid={`${testIdPrefix}-reset-image`}
        >
          <RotateCcw className="size-3" /> 重置
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-muted-foreground">圆角 {layer.radius}px</span>
          <input
            type="range"
            min={0}
            max={60}
            value={layer.radius}
            onChange={(e) => onChange({ radius: Number(e.target.value) })}
            className="w-full"
            data-testid={`${testIdPrefix}-radius`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">旋转 {layer.rotation}°</span>
          <input
            type="range"
            min={-180}
            max={180}
            value={layer.rotation}
            onChange={(e) => onChange({ rotation: Number(e.target.value) })}
            className="w-full"
            data-testid={`${testIdPrefix}-rotation`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">水平裁切 {layer.offsetX}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={layer.offsetX}
            onChange={(e) => onChange({ offsetX: Number(e.target.value) })}
            className="w-full"
            data-testid={`${testIdPrefix}-offset-x`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">垂直裁切 {layer.offsetY}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={layer.offsetY}
            onChange={(e) => onChange({ offsetY: Number(e.target.value) })}
            className="w-full"
            data-testid={`${testIdPrefix}-offset-y`}
          />
        </label>
      </div>
      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={layer.shadow}
          onChange={(e) => onChange({ shadow: e.target.checked })}
          data-testid={`${testIdPrefix}-shadow`}
        />
        <span className="text-muted-foreground">阴影</span>
      </label>
    </div>
  );
}

function TextLayerPanel({
  layer,
  onChange,
  testIdPrefix,
}: {
  layer: CoverTextLayer;
  onChange: (p: Partial<CoverTextLayer>) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={layer.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={2}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
        data-testid={`${testIdPrefix}-text-content`}
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-muted-foreground">字体</span>
          <select
            value={layer.font}
            onChange={(e) => onChange({ font: e.target.value as StickerFont })}
            className="w-full rounded-md border border-input bg-background px-2 py-1"
            data-testid={`${testIdPrefix}-text-font`}
          >
            {STICKER_FONT_LIST.map((f) => (
              <option key={f.key} value={f.key}>{f.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">字号 {layer.fontSize}px</span>
          <input
            type="range"
            min={10}
            max={56}
            value={layer.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="w-full"
            data-testid={`${testIdPrefix}-text-size`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">字重 {layer.fontWeight}</span>
          <input
            type="range"
            min={300}
            max={900}
            step={100}
            value={layer.fontWeight}
            onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
            className="w-full"
            data-testid={`${testIdPrefix}-text-weight`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">旋转 {layer.rotation}°</span>
          <input
            type="range"
            min={-180}
            max={180}
            value={layer.rotation}
            onChange={(e) => onChange({ rotation: Number(e.target.value) })}
            className="w-full"
            data-testid={`${testIdPrefix}-text-rotation`}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-muted-foreground">颜色</span>
          <input
            type="color"
            value={layer.color}
            onChange={(e) => onChange({ color: e.target.value })}
            className="w-full h-7 rounded border border-input bg-background"
            data-testid={`${testIdPrefix}-text-color`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">底色</span>
          <div className="flex items-center gap-1">
            <input
              type="color"
              value={parseColor(layer.background)}
              onChange={(e) =>
                onChange({ background: hexToRgba(e.target.value, 0.55) })
              }
              className="flex-1 h-7 rounded border border-input bg-background"
              data-testid={`${testIdPrefix}-text-bg`}
            />
            <button
              type="button"
              onClick={() => onChange({ background: null })}
              className="text-xs px-2 py-0.5 rounded border border-border hover-elevate"
              data-testid={`${testIdPrefix}-text-bg-clear`}
            >
              透明
            </button>
          </div>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange({ align: a })}
            className={`rounded-full px-2 py-0.5 border ${
              layer.align === a ? "bg-foreground text-background border-foreground" : "border-border"
            }`}
            data-testid={`${testIdPrefix}-text-align-${a}`}
          >
            {a === "left" ? "左对齐" : a === "center" ? "居中" : "右对齐"}
          </button>
        ))}
        <label className="inline-flex items-center gap-1 text-muted-foreground">
          <input
            type="checkbox"
            checked={layer.shadow}
            onChange={(e) => onChange({ shadow: e.target.checked })}
            data-testid={`${testIdPrefix}-text-shadow`}
          />
          文字阴影
        </label>
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
const clampNum = clamp;

function parseColor(c: string | null): string {
  if (!c) return "#000000";
  if (c.startsWith("#")) return c;
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const r = Number(m[1]).toString(16).padStart(2, "0");
    const g = Number(m[2]).toString(16).padStart(2, "0");
    const b = Number(m[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return "#000000";
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
