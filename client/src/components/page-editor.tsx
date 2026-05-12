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
import { STICKER_PRESETS, type StickerPreset } from "@/lib/sticker-presets";
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

type EdgeSide = "left" | "right" | "top" | "bottom";

type DragState =
  | { kind: "move"; layerId: string; startX: number; startY: number; origX: number; origY: number }
  | {
      kind: "transform";
      layerId: string;
      centerX: number;
      centerY: number;
      startAngle: number;
      startDist: number;
      origW: number;
      origH: number;
      origRot: number;
    }
  | { kind: "imgpan"; layerId: string; startX: number; startY: number; origOX: number; origOY: number }
  | {
      kind: "edge";
      layerId: string;
      side: EdgeSide;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    };

type StickerDrag =
  | { kind: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
  | {
      kind: "transform";
      id: string;
      centerX: number;
      centerY: number;
      startAngle: number;
      startDist: number;
      origFontSize: number;
      origRot: number;
    };

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
  const editorRootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [stickerDrag, setStickerDrag] = useState<StickerDrag | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [editingStickerId, setEditingStickerId] = useState<string | null>(null);
  const stageH = Math.round((width * 4) / 3);

  const selected = design.layers.find((l) => l.id === selectedId) || null;
  const selectedSticker = stickers.find((s) => s.id === selectedStickerId) || null;

  // Hide settings when nothing is selected.
  useEffect(() => {
    if (!selected && !selectedSticker) setSettingsOpen(false);
  }, [selected, selectedSticker]);
  // Exit inline text edit mode when the selected layer changes.
  useEffect(() => {
    if (!selected || selected.id !== editingTextId) setEditingTextId(null);
  }, [selected, editingTextId]);
  // Exit inline sticker edit mode when the selected sticker changes.
  useEffect(() => {
    if (!selectedSticker || selectedSticker.id !== editingStickerId) setEditingStickerId(null);
  }, [selectedSticker, editingStickerId]);

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
      } else if (drag.kind === "transform") {
        const ang = Math.atan2(ev.clientY - drag.centerY, ev.clientX - drag.centerX);
        const deg = (ang - drag.startAngle) * (180 / Math.PI);
        const dist = Math.hypot(
          ev.clientX - drag.centerX,
          ev.clientY - drag.centerY,
        );
        const scale = drag.startDist > 0 ? dist / drag.startDist : 1;
        updateLayer(drag.layerId, {
          rotation: Math.round(drag.origRot + deg),
          w: clamp(drag.origW * scale, 8, 110),
          h: clamp(drag.origH * scale, 4, 110),
        });
      } else if (drag.kind === "imgpan") {
        const dxPct = ((ev.clientX - drag.startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - drag.startY) / rect.height) * 100;
        const layer = design.layers.find((l) => l.id === drag.layerId);
        if (layer?.type !== "image") return;
        updateLayer(drag.layerId, {
          offsetX: clamp(drag.origOX - dxPct * 0.6, 0, 100),
          offsetY: clamp(drag.origOY - dyPct * 0.6, 0, 100),
        });
      } else if (drag.kind === "edge") {
        // Edge-based cropping: dragging an edge re-shapes the layer frame
        // while the inner image keeps object-fit cover, so the image is
        // visually cropped to the new frame without overflowing.
        const dxPct = ((ev.clientX - drag.startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - drag.startY) / rect.height) * 100;
        // Minimum frame size in % of page (keeps the layer pickable).
        const MIN = 6;
        if (drag.side === "left") {
          const maxDx = drag.origW - MIN;
          const d = clamp(dxPct, -drag.origX, maxDx);
          updateLayer(drag.layerId, { x: drag.origX + d, w: drag.origW - d });
        } else if (drag.side === "right") {
          const maxRight = 100 - drag.origX;
          const d = clamp(dxPct, -(drag.origW - MIN), maxRight - drag.origW);
          updateLayer(drag.layerId, { w: drag.origW + d });
        } else if (drag.side === "top") {
          const maxDy = drag.origH - MIN;
          const d = clamp(dyPct, -drag.origY, maxDy);
          updateLayer(drag.layerId, { y: drag.origY + d, h: drag.origH - d });
        } else {
          const maxBottom = 100 - drag.origY;
          const d = clamp(dyPct, -(drag.origH - MIN), maxBottom - drag.origH);
          updateLayer(drag.layerId, { h: drag.origH + d });
        }
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
        const dist = Math.hypot(
          ev.clientX - stickerDrag.centerX,
          ev.clientY - stickerDrag.centerY,
        );
        const scale = stickerDrag.startDist > 0 ? dist / stickerDrag.startDist : 1;
        onChangeStickers(
          stickers.map((s) =>
            s.id === stickerDrag.id
              ? {
                  ...s,
                  rotation: Math.round(stickerDrag.origRot + deg),
                  fontSize: clamp(
                    Math.round(stickerDrag.origFontSize * scale),
                    8,
                    72,
                  ),
                }
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
  function startTransform(e: React.PointerEvent, l: CoverLayer, target: HTMLElement) {
    e.stopPropagation();
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    setDrag({
      kind: "transform",
      layerId: l.id,
      centerX: cx,
      centerY: cy,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
      startDist: dist,
      origW: l.w,
      origH: l.h,
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
  function startEdgeDrag(e: React.PointerEvent, l: CoverImageLayer, side: EdgeSide) {
    e.stopPropagation();
    setSelectedId(l.id);
    setSelectedStickerId(null);
    setDrag({
      kind: "edge",
      layerId: l.id,
      side,
      startX: e.clientX,
      startY: e.clientY,
      origX: l.x,
      origY: l.y,
      origW: l.w,
      origH: l.h,
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
  function startStickerTransform(e: React.PointerEvent, s: StickerOverlay, target: HTMLElement) {
    e.stopPropagation();
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    setStickerDrag({
      kind: "transform",
      id: s.id,
      centerX: cx,
      centerY: cy,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
      startDist: dist,
      origFontSize: s.fontSize,
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

  // Wheel zoom while in image edit mode — uses a native non-passive listener
  // (see effect below) so preventDefault actually blocks the page from scrolling.
  useEffect(() => {
    if (!editingImageId) return;
    const stage = stageRef.current;
    if (!stage) return;
    const handler = (e: WheelEvent) => {
      const layer = design.layers.find((l) => l.id === editingImageId);
      if (!layer || layer.type !== "image") return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      // Min zoom is 1 so the image always covers the frame edge-to-edge —
      // shrinking below 1 would expose the page background inside the layer
      // frame, making the module visibly larger than the photo itself.
      const next = clamp(layer.zoom + delta, 1, 3);
      updateLayer(layer.id, { zoom: Number(next.toFixed(2)) });
    };
    stage.addEventListener("wheel", handler, { passive: false });
    return () => {
      stage.removeEventListener("wheel", handler);
    };
  }, [editingImageId, design.layers, updateLayer]);

  // Exit image adjustment mode when the user clicks anywhere outside the
  // editor (including outside the stage, e.g. clicking far below the
  // canvas). The stage's own onPointerDown already clears editingImageId
  // for clicks on the stage background, but it cannot see clicks that
  // never enter the stage at all. A document-level capture-phase listener
  // covers that gap. We intentionally treat the entire editor root as
  // "inside" so the settings panel's "退出调整图片" button and the
  // adjust-aware toolbar stay reachable while the mode is active.
  useEffect(() => {
    if (!editingImageId) return;
    const handler = (ev: PointerEvent) => {
      const root = editorRootRef.current;
      if (!root) return;
      const target = ev.target as Node | null;
      if (target && root.contains(target)) return;
      setEditingImageId(null);
    };
    document.addEventListener("pointerdown", handler, true);
    return () => {
      document.removeEventListener("pointerdown", handler, true);
    };
  }, [editingImageId]);

  // Stickers
  function addSticker(preset?: StickerPreset) {
    const id = `stk_${Date.now()}`;
    onChangeStickers([
      ...stickers,
      {
        id,
        pageIndex: page.index,
        text: preset?.text ?? "添加文字",
        x: 30,
        y: 30,
        rotation: preset?.rotation ?? 0,
        font: preset?.font ?? "marker",
        color: preset?.color ?? "#ffffff",
        background: preset?.background ?? "rgba(232,89,107,0.85)",
        fontSize: preset?.fontSize ?? 16,
      },
    ]);
    setSelectedStickerId(id);
    setSelectedId(null);
    setStickerPickerOpen(false);
  }
  function updateSticker(id: string, patch: Partial<StickerOverlay>) {
    onChangeStickers(stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeSticker(id: string) {
    onChangeStickers(stickers.filter((s) => s.id !== id));
    setSelectedStickerId((s) => (s === id ? null : s));
  }

  return (
    <div
      ref={editorRootRef}
      className="space-y-3"
      data-testid={`${testIdPrefix}-editor`}
    >
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
        <div className="text-[11px] hidden md:block">点击图层选中,双击图片进入裁切模式(滚轮缩放),点击空白处退出</div>
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
          setEditingTextId(null);
          setEditingStickerId(null);
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
                  data-adjusting={isImageEditing ? "true" : "false"}
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
                        // Render zoom is clamped to >= 1: combined with
                        // object-fit cover this guarantees the photo fills
                        // the layer frame with no exposed page background.
                        transform: `scale(${Math.max(1, l.zoom)})`,
                        transformOrigin: `${l.offsetX}% ${l.offsetY}%`,
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                  {isSelected && (
                    <>
                      <CornerButton
                        position="tl"
                        label=""
                        onClick={() => replaceInputRef.current?.click()}
                        testId={`${testIdPrefix}-corner-replace-${l.id}`}
                        icon={<Repeat className="size-3" />}
                        title="换图"
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
                      <TransformHandle
                        onPointerDown={(e) => {
                          const target = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                          startTransform(e, l, target);
                        }}
                        testId={`${testIdPrefix}-corner-transform-${l.id}`}
                      />
                      <EdgeCropHandle
                        side="left"
                        onPointerDown={(e) => startEdgeDrag(e, l, "left")}
                        testId={`${testIdPrefix}-crop-left-${l.id}`}
                      />
                      <EdgeCropHandle
                        side="right"
                        onPointerDown={(e) => startEdgeDrag(e, l, "right")}
                        testId={`${testIdPrefix}-crop-right-${l.id}`}
                      />
                      <EdgeCropHandle
                        side="top"
                        onPointerDown={(e) => startEdgeDrag(e, l, "top")}
                        testId={`${testIdPrefix}-crop-top-${l.id}`}
                      />
                      <EdgeCropHandle
                        side="bottom"
                        onPointerDown={(e) => startEdgeDrag(e, l, "bottom")}
                        testId={`${testIdPrefix}-crop-bottom-${l.id}`}
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
            const isTextEditing = editingTextId === l.id;
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
                  outline: isSelected
                    ? isTextEditing
                      ? "2px solid #fde68a"
                      : "2px dashed #fff"
                    : "none",
                  outlineOffset: 2,
                  cursor: isTextEditing ? "text" : "grab",
                }}
                data-testid={`${testIdPrefix}-layer-${l.id}`}
                onPointerDown={(e) => {
                  if (isTextEditing) {
                    e.stopPropagation();
                    return;
                  }
                  startMove(e, l);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(l.id);
                  setSelectedStickerId(null);
                  setEditingTextId(l.id);
                }}
              >
                <EditableTextContent
                  layer={l}
                  editing={isTextEditing}
                  onChange={(t) => updateLayer(l.id, { text: t })}
                  onExit={() => setEditingTextId((s) => (s === l.id ? null : s))}
                  testId={`${testIdPrefix}-text-inline-${l.id}`}
                />
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
                    <TransformHandle
                      onPointerDown={(e) => {
                        const target = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                        startTransform(e, l, target);
                      }}
                      testId={`${testIdPrefix}-corner-transform-${l.id}`}
                    />
                  </>
                )}
              </div>
            );
          })}

        {/* Stickers — rendered on top */}
        {stickers.map((s) => {
          const isStickerEditing = editingStickerId === s.id;
          const isStickerSelected = s.id === selectedStickerId;
          return (
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
                cursor: isStickerEditing ? "text" : "grab",
                touchAction: "none",
                boxShadow:
                  s.background && s.background !== "transparent"
                    ? "0 4px 14px rgba(0,0,0,0.18)"
                    : "0 2px 6px rgba(0,0,0,0.25)",
                textShadow:
                  !s.background || s.background === "transparent"
                    ? "0 2px 6px rgba(0,0,0,0.45)"
                    : "none",
                outline: isStickerSelected
                  ? isStickerEditing
                    ? "2px solid #fde68a"
                    : "2px dashed #fff"
                  : "none",
                outlineOffset: 2,
                userSelect: isStickerEditing ? "text" : "none",
                zIndex: 1000,
              }}
              data-testid={`${testIdPrefix}-sticker-${s.id}`}
              onPointerDown={(e) => {
                if (isStickerEditing) {
                  e.stopPropagation();
                  return;
                }
                startStickerMove(e, s);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setSelectedStickerId(s.id);
                setSelectedId(null);
                setEditingStickerId(s.id);
              }}
            >
              <EditableStickerContent
                sticker={s}
                editing={isStickerEditing}
                onChange={(t) => updateSticker(s.id, { text: t })}
                onExit={() => setEditingStickerId((curr) => (curr === s.id ? null : curr))}
                testId={`${testIdPrefix}-sticker-inline-${s.id}`}
              />
              {isStickerSelected && (
                <>
                  <CornerButton
                    position="tr"
                    label=""
                    onClick={() => removeSticker(s.id)}
                    testId={`${testIdPrefix}-sticker-corner-delete-${s.id}`}
                    icon={<Trash2 className="size-3" />}
                    variant="danger"
                    title="删除贴纸"
                  />
                  <CornerButton
                    position="bl"
                    label=""
                    onClick={() => setSettingsOpen((v) => !v)}
                    testId={`${testIdPrefix}-sticker-corner-settings-${s.id}`}
                    icon={<Settings className="size-3" />}
                    title="详细设置"
                  />
                  <TransformHandle
                    onPointerDown={(e) => {
                      const target = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                      startStickerTransform(e, s, target);
                    }}
                    testId={`${testIdPrefix}-sticker-corner-transform-${s.id}`}
                  />
                </>
              )}
            </div>
          );
        })}
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
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 ${
            stickerPickerOpen
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card hover-elevate"
          }`}
          onClick={() => setStickerPickerOpen((v) => !v)}
          data-testid={`${testIdPrefix}-add-sticker`}
          aria-expanded={stickerPickerOpen}
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

      {stickerPickerOpen && (
        <div
          className="rounded-2xl border border-card-border bg-card/70 p-3 text-xs space-y-2"
          data-testid={`${testIdPrefix}-sticker-presets`}
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold inline-flex items-center gap-1">
              <Sticker className="size-3.5" /> 添加贴纸 · 空白 / 小红书模板
            </div>
            <button
              type="button"
              onClick={() => setStickerPickerOpen(false)}
              className="rounded-full border border-border px-2 py-0.5 hover-elevate inline-flex items-center gap-1"
              data-testid={`${testIdPrefix}-sticker-presets-close`}
            >
              <X className="size-3" /> 收起
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => addSticker()}
              className="rounded-full border border-dashed border-border bg-background px-3 py-1 hover-elevate inline-flex items-center gap-1 text-foreground"
              data-testid={`${testIdPrefix}-sticker-preset-blank`}
              title="添加一个空白贴纸,双击可编辑文字"
            >
              <Sticker className="size-3" /> 空白贴纸
            </button>
            {STICKER_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => addSticker(p)}
                className="rounded-full border border-border bg-background px-2 py-1 hover-elevate inline-flex items-center gap-1"
                style={{
                  color: p.color,
                  background: p.background ?? undefined,
                  fontFamily: fontFamilyFor(p.font),
                  borderColor: "rgba(0,0,0,0.1)",
                  transform: `rotate(${Math.max(-6, Math.min(6, p.rotation))}deg)`,
                }}
                data-testid={`${testIdPrefix}-sticker-preset-${p.key}`}
                title={`使用「${p.label}」模板`}
              >
                {p.text}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            空白贴纸方便自定义文字;选中后双击贴纸即可在画布上原地编辑,与文字模块一致。
          </p>
        </div>
      )}

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
          点击图层选中后:右下角拖动可缩放/旋转;左上角"换图";右上角删除;左下角设置查看详细参数;双击图片进入裁切模式(滚轮缩放,点击空白处退出),双击文字 / 贴纸进入原地编辑。
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

function TransformHandle({
  onPointerDown,
  testId,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      className="absolute -right-2.5 -bottom-2.5 inline-flex items-center justify-center size-6 rounded-full bg-white shadow border border-black/10 hover:bg-primary/10 cursor-nwse-resize"
      style={{ zIndex: 5 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e);
      }}
      onClick={(e) => e.stopPropagation()}
      data-testid={testId}
      title="拖动可同时缩放与旋转"
      aria-label="缩放与旋转"
    >
      <RotateCcw className="size-3 text-primary" />
    </button>
  );
}

function EdgeCropHandle({
  side,
  onPointerDown,
  testId,
}: {
  side: EdgeSide;
  onPointerDown: (e: React.PointerEvent) => void;
  testId: string;
}) {
  // Thin, visible bar sitting on the layer's edge. Drag it along the
  // perpendicular axis to crop. Hit area is larger than the visible bar.
  const isH = side === "left" || side === "right";
  const style: React.CSSProperties = {
    position: "absolute",
    zIndex: 4,
    background: "transparent",
    border: "none",
    touchAction: "none",
    padding: 0,
  };
  if (isH) {
    style.top = "20%";
    style.bottom = "20%";
    style.width = 14;
    style.cursor = "ew-resize";
    if (side === "left") style.left = -7;
    else style.right = -7;
  } else {
    style.left = "20%";
    style.right = "20%";
    style.height = 14;
    style.cursor = "ns-resize";
    if (side === "top") style.top = -7;
    else style.bottom = -7;
  }
  const barInner: React.CSSProperties = isH
    ? {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: 4,
        borderRadius: 2,
        background: "rgba(255,255,255,0.85)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
      }
    : {
        position: "absolute",
        left: 0,
        right: 0,
        top: "50%",
        transform: "translateY(-50%)",
        height: 4,
        borderRadius: 2,
        background: "rgba(255,255,255,0.85)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
      };
  return (
    <button
      type="button"
      style={style}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e);
      }}
      onClick={(e) => e.stopPropagation()}
      data-testid={testId}
      title="拖动边缘可裁切图片"
      aria-label="边缘裁切"
    >
      <span style={barInner} />
    </button>
  );
}

function EditableTextContent({
  layer,
  editing,
  onChange,
  onExit,
  testId,
}: {
  layer: CoverTextLayer;
  editing: boolean;
  onChange: (text: string) => void;
  onExit: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerText !== layer.text) {
      el.innerText = layer.text;
    }
    if (editing) {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing, layer.text]);
  return (
    <div
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      style={{
        color: layer.color,
        fontSize: layer.fontSize,
        fontWeight: layer.fontWeight,
        fontFamily: fontFamilyFor(layer.font),
        lineHeight: 1.05,
        textAlign: layer.align,
        width: "100%",
        whiteSpace: "pre-wrap",
        textShadow: layer.shadow ? "0 2px 8px rgba(0,0,0,0.45)" : "none",
        outline: "none",
        cursor: editing ? "text" : undefined,
        pointerEvents: editing ? "auto" : "none",
      }}
      onBlur={(e) => {
        const next = (e.currentTarget as HTMLDivElement).innerText;
        if (next !== layer.text) onChange(next);
        onExit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          (e.currentTarget as HTMLDivElement).blur();
        }
      }}
      data-testid={testId}
    />
  );
}

function EditableStickerContent({
  sticker,
  editing,
  onChange,
  onExit,
  testId,
}: {
  sticker: StickerOverlay;
  editing: boolean;
  onChange: (text: string) => void;
  onExit: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerText !== sticker.text) {
      el.innerText = sticker.text;
    }
    if (editing) {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing, sticker.text]);
  return (
    <span
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      style={{
        outline: "none",
        cursor: editing ? "text" : undefined,
        pointerEvents: editing ? "auto" : "none",
        whiteSpace: "pre",
      }}
      onPointerDown={(e) => {
        if (editing) e.stopPropagation();
      }}
      onBlur={(e) => {
        const next = (e.currentTarget as HTMLSpanElement).innerText;
        if (next !== sticker.text) onChange(next);
        onExit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLSpanElement).blur();
        } else if (e.key === "Escape") {
          (e.currentTarget as HTMLSpanElement).blur();
        }
      }}
      data-testid={testId}
    />
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
          onClick={() => onChange({ zoom: Math.max(1, Number((layer.zoom - 0.08).toFixed(2))) })}
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
