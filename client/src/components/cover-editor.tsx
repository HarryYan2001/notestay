import { useRef, useState, useEffect, useCallback } from "react";
import type {
  CoverDesign,
  CoverLayer,
  CoverImageLayer,
  CoverTextLayer,
  StickerFont,
} from "@/lib/types";
import { STICKER_FONT_LIST, fontFamilyFor } from "@/lib/sticker-fonts";
import {
  Trash2,
  Image as ImageIcon,
  Type,
  ZoomIn,
  ZoomOut,
  Crop,
  RotateCcw,
  Upload,
} from "lucide-react";

interface Props {
  design: CoverDesign;
  onChange: (next: CoverDesign) => void;
  width?: number; // px
  height?: number; // px (aspect 3/4 default)
  testIdPrefix?: string;
}

type DragState =
  | { kind: "move"; layerId: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize"; layerId: string; startX: number; startY: number; origW: number; origH: number }
  | { kind: "crop"; layerId: string; startX: number; startY: number; origOX: number; origOY: number };

export function CoverEditor({
  design,
  onChange,
  width = 320,
  height,
  testIdPrefix = "cover",
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const stageH = height ?? Math.round((width * 4) / 3);

  const selected = design.layers.find((l) => l.id === selectedId) || null;

  const updateLayer = useCallback(
    (id: string, patch: Partial<CoverLayer>) => {
      onChange({
        ...design,
        layers: design.layers.map((l) =>
          l.id === id ? ({ ...l, ...patch } as CoverLayer) : l,
        ),
      });
    },
    [design, onChange],
  );

  const removeLayer = useCallback(
    (id: string) => {
      onChange({
        ...design,
        layers: design.layers.filter((l) => l.id !== id),
      });
      setSelectedId((s) => (s === id ? null : s));
    },
    [design, onChange],
  );

  const bringForward = useCallback(
    (id: string) => {
      const max = Math.max(0, ...design.layers.map((l) => l.z));
      updateLayer(id, { z: max + 1 });
    },
    [design.layers, updateLayer],
  );

  // Drag/move/resize/crop handlers
  useEffect(() => {
    if (!drag) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    function move(ev: PointerEvent) {
      if (!drag) return;
      const dxPct = ((ev.clientX - drag.startX) / rect.width) * 100;
      const dyPct = ((ev.clientY - drag.startY) / rect.height) * 100;
      if (drag.kind === "move") {
        updateLayer(drag.layerId, {
          x: clamp(drag.origX + dxPct, -10, 105),
          y: clamp(drag.origY + dyPct, -10, 105),
        });
      } else if (drag.kind === "resize") {
        updateLayer(drag.layerId, {
          w: clamp(drag.origW + dxPct, 8, 110),
          h: clamp(drag.origH + dyPct, 4, 110),
        });
      } else if (drag.kind === "crop") {
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

  function startMove(e: React.PointerEvent, l: CoverLayer) {
    e.stopPropagation();
    setSelectedId(l.id);
    setDrag({
      kind: "move",
      layerId: l.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: l.x,
      origY: l.y,
    });
  }
  function startResize(e: React.PointerEvent, l: CoverLayer) {
    e.stopPropagation();
    setSelectedId(l.id);
    setDrag({
      kind: "resize",
      layerId: l.id,
      startX: e.clientX,
      startY: e.clientY,
      origW: l.w,
      origH: l.h,
    });
  }
  function startCrop(e: React.PointerEvent, l: CoverImageLayer) {
    e.stopPropagation();
    setSelectedId(l.id);
    setDrag({
      kind: "crop",
      layerId: l.id,
      startX: e.clientX,
      startY: e.clientY,
      origOX: l.offsetX,
      origOY: l.offsetY,
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
    onChange({ ...design, layers: [...design.layers, newLayer] });
    setSelectedId(id);
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
      onChange({ ...design, layers: [...design.layers, newLayer] });
      setSelectedId(id);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function replaceBackgroundImage(files: FileList | null) {
    if (!files || !files[0]) return;
    const url = URL.createObjectURL(files[0]);
    onChange({ ...design, bgImageUrl: url });
  }

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-editor`}>
      <div
        ref={stageRef}
        className="relative mx-auto overflow-hidden rounded-2xl shadow-lg select-none"
        style={{
          width,
          height: stageH,
          background: design.background,
        }}
        onPointerDown={() => setSelectedId(null)}
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
            const left = `${l.x}%`;
            const top = `${l.y}%`;
            const w = `${l.w}%`;
            const h = `${l.h}%`;
            const isSelected = l.id === selectedId;
            const common: React.CSSProperties = {
              position: "absolute",
              left,
              top,
              width: w,
              height: h,
              transform: `rotate(${l.rotation}deg)`,
              transformOrigin: "center",
              zIndex: l.z,
              cursor: "grab",
              touchAction: "none",
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
                    outline: isSelected ? "2px solid #fff" : "none",
                    outlineOffset: isSelected ? 2 : 0,
                  }}
                  data-testid={`${testIdPrefix}-layer-${l.id}`}
                  onPointerDown={(e) => startMove(e, l)}
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
                    }}
                  />
                  {isSelected && (
                    <>
                      <div
                        className="absolute right-0 bottom-0 size-4 bg-white rounded-tl-md cursor-se-resize"
                        onPointerDown={(e) => startResize(e, l)}
                        data-testid={`${testIdPrefix}-resize-${l.id}`}
                      />
                      <div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-6 rounded-full bg-black/50 text-white inline-flex items-center justify-center cursor-move"
                        onPointerDown={(e) => startCrop(e, l)}
                        title="拖动以裁切位置"
                        data-testid={`${testIdPrefix}-crop-${l.id}`}
                      >
                        <Crop className="size-3" />
                      </div>
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
                  }}
                >
                  {l.text}
                </div>
                {isSelected && (
                  <div
                    className="absolute right-0 bottom-0 size-4 bg-white rounded-tl-md cursor-se-resize"
                    onPointerDown={(e) => startResize(e, l)}
                    data-testid={`${testIdPrefix}-resize-${l.id}`}
                  />
                )}
              </div>
            );
          })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) =>
            onPickImage(e.target.files, selected?.type === "image" ? "replace" : "add")
          }
          data-testid={`${testIdPrefix}-file-input`}
        />
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 hover-elevate"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.dataset.mode = "add";
              fileInputRef.current.click();
            }
          }}
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
            onClick={() => onChange({ ...design, bgImageUrl: null })}
            data-testid={`${testIdPrefix}-bg-clear`}
          >
            <Trash2 className="size-3.5" /> 移除背景图
          </button>
        )}
      </div>

      {/* Selected layer panel */}
      {selected ? (
        <div className="rounded-2xl border border-card-border bg-card/70 p-3 text-xs space-y-3" data-testid={`${testIdPrefix}-selected-panel`}>
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              {selected.type === "image" ? "图片图层" : "文字图层"}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => bringForward(selected.id)}
                className="rounded-full border border-border px-2 py-0.5 hover-elevate"
                data-testid={`${testIdPrefix}-forward`}
              >
                置顶
              </button>
              <button
                type="button"
                onClick={() => removeLayer(selected.id)}
                className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5"
                data-testid={`${testIdPrefix}-delete-layer`}
              >
                <Trash2 className="size-3" /> 删除
              </button>
            </div>
          </div>

          {selected.type === "image" ? (
            <ImageLayerPanel
              layer={selected}
              onChange={(p) => updateLayer(selected.id, p)}
              onReplace={() => fileInputRef.current?.click()}
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
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 p-3 text-xs text-muted-foreground">
          点击封面上的图层进行编辑;拖拽移动、右下角缩放、中心十字图标拖动裁切。
        </div>
      )}
    </div>
  );
}

function ImageLayerPanel({
  layer,
  onChange,
  onReplace,
  testIdPrefix,
}: {
  layer: CoverImageLayer;
  onChange: (p: Partial<CoverImageLayer>) => void;
  onReplace: () => void;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 hover-elevate"
          onClick={onReplace}
          data-testid={`${testIdPrefix}-replace-image`}
        >
          <Upload className="size-3" /> 替换图片
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
            min={-30}
            max={30}
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
            min={-30}
            max={30}
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
