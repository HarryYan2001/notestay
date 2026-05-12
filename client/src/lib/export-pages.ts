import * as htmlToImage from "html-to-image";
import JSZip from "jszip";
import type { CoverImageLayer, CoverTextLayer, PageDesign, StickerOverlay } from "@/lib/types";
import { fontFamilyFor } from "@/lib/sticker-fonts";

// Wait for all <img> descendants in an element to have completed loading.
async function waitForImagesIn(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => {
          img.removeEventListener("load", done);
          img.removeEventListener("error", done);
          resolve();
        };
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        // Safety timeout so a stuck image doesn't deadlock the export.
        setTimeout(done, 4000);
      });
    }),
  );
}

// Capture a DOM element and return a PNG dataURL. Retries with progressively
// safer settings on failure (CORS-tainted canvases, font issues, etc.)
export async function elementToPng(
  el: HTMLElement,
  width: number,
  height: number,
): Promise<string> {
  await waitForImagesIn(el);

  const baseOptions: Parameters<typeof htmlToImage.toPng>[1] = {
    width,
    height,
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    canvasWidth: width,
    canvasHeight: height,
    style: { transform: "none", transformOrigin: "top left" },
    skipFonts: false,
    fetchRequestInit: { mode: "cors", credentials: "omit" },
  };

  // Attempt 1 — standard.
  try {
    return await htmlToImage.toPng(el, baseOptions);
  } catch (e) {
    // fall through to retry
    console.warn("[export] toPng attempt 1 failed", e);
  }

  // Attempt 2 — skip font embedding (avoids stylesheet parsing errors).
  try {
    return await htmlToImage.toPng(el, { ...baseOptions, skipFonts: true });
  } catch (e) {
    console.warn("[export] toPng attempt 2 (skipFonts) failed", e);
  }

  // Attempt 3 — fall back to JPEG which is more permissive in some browsers
  // when canvas is tainted by a single problematic image.
  try {
    return await htmlToImage.toJpeg(el, {
      ...baseOptions,
      quality: 0.95,
      skipFonts: true,
    });
  } catch (e) {
    console.warn("[export] toJpeg attempt 3 failed", e);
  }

  // Attempt 4 — use toCanvas → canvas.toDataURL manually, which sometimes
  // works when toPng's internal toBlob path fails.
  try {
    const canvas = await htmlToImage.toCanvas(el, {
      ...baseOptions,
      skipFonts: true,
    });
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.error("[export] toCanvas attempt 4 failed", e);
    throw new Error("浏览器无法将此页面渲染为图片,请刷新后重试或更换浏览器");
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(b64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

export function triggerDownloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

export async function exportPagesAsZip(
  captures: { name: string; dataUrl: string }[],
  zipName: string,
) {
  const zip = new JSZip();
  for (const c of captures) {
    const blob = dataUrlToBlob(c.dataUrl);
    zip.file(c.name, blob);
  }
  const out = await zip.generateAsync({ type: "blob" });
  triggerDownloadBlob(out, zipName);
}

export async function exportPagesSequentially(
  captures: { name: string; dataUrl: string }[],
) {
  for (const c of captures) {
    const blob = dataUrlToBlob(c.dataUrl);
    triggerDownloadBlob(blob, c.name);
    // small delay so browser doesn't drop downloads
    await new Promise((r) => setTimeout(r, 250));
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label}超时`)), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function extractGradientColors(background: string): string[] {
  const hex = background.match(/#[0-9a-fA-F]{3,8}/g);
  if (hex && hex.length > 0) return hex;
  const rgb = background.match(/rgba?\([^)]+\)/g);
  if (rgb && rgb.length > 0) return rgb;
  return [background || "#f5f1ee"];
}

function fillBackground(ctx: CanvasRenderingContext2D, background: string, width: number, height: number) {
  if (background.includes("gradient")) {
    const colors = extractGradientColors(background);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    colors.forEach((color, index) => {
      gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color);
    });
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = background || "#f5f1ee";
  }
  ctx.fillRect(0, 0, width, height);
}

async function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  const img = new Image();
  if (!src.startsWith("blob:") && !src.startsWith("data:")) {
    img.crossOrigin = "anonymous";
  }
  const load = new Promise<HTMLImageElement | null>((resolve) => {
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  return withTimeout(load, 5000, "图片加载").catch(() => null);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  align: CanvasTextAlign,
) {
  const lines = text.split("\n");
  let cursorY = y;
  for (const rawLine of lines) {
    let line = "";
    for (const char of rawLine) {
      const test = line + char;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        cursorY += lineHeight;
        line = char;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
    }
  }
  ctx.textAlign = align;
}

async function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: CoverImageLayer,
  width: number,
  height: number,
  scale: number,
) {
  const img = await loadImageSafe(layer.imageUrl);
  const x = (layer.x / 100) * width;
  const y = (layer.y / 100) * height;
  const w = (layer.w / 100) * width;
  const h = (layer.h / 100) * height;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  if (layer.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.24)";
    ctx.shadowBlur = 22 * scale;
    ctx.shadowOffsetY = 9 * scale;
  }
  roundedRect(ctx, -w / 2, -h / 2, w, h, layer.radius * scale);
  ctx.clip();
  if (img) {
    const zoom = Math.max(0.2, layer.zoom || 1);
    const coverScale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
    const drawW = img.naturalWidth * coverScale;
    const drawH = img.naturalHeight * coverScale;
    const maxDx = Math.max(0, drawW - w);
    const maxDy = Math.max(0, drawH - h);
    const dx = -w / 2 - (maxDx * layer.offsetX) / 100;
    const dy = -h / 2 - (maxDy * layer.offsetY) / 100;
    ctx.drawImage(img, dx, dy, drawW, drawH);
  } else {
    const gradient = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    gradient.addColorStop(0, "#ffe1e6");
    gradient.addColorStop(1, "#d83a4d");
    ctx.fillStyle = gradient;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: CoverTextLayer,
  width: number,
  height: number,
  scale: number,
) {
  const x = (layer.x / 100) * width;
  const y = (layer.y / 100) * height;
  const w = (layer.w / 100) * width;
  const h = (layer.h / 100) * height;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  if (layer.background && layer.background !== "transparent") {
    ctx.fillStyle = layer.background;
    roundedRect(ctx, -w / 2, -h / 2, w, h, 14 * scale);
    ctx.fill();
  }
  ctx.fillStyle = layer.color;
  ctx.font = `${layer.fontWeight} ${layer.fontSize * scale}px ${fontFamilyFor(layer.font)}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = layer.align as CanvasTextAlign;
  if (layer.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.42)";
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetY = 2 * scale;
  }
  const alignX = layer.align === "left" ? -w / 2 + 10 * scale : layer.align === "right" ? w / 2 - 10 * scale : 0;
  drawWrappedText(ctx, layer.text, alignX, -h / 2 + h / 2, w - 20 * scale, layer.fontSize * 1.12 * scale, layer.align as CanvasTextAlign);
  ctx.restore();
}

function drawSticker(
  ctx: CanvasRenderingContext2D,
  sticker: StickerOverlay,
  width: number,
  height: number,
  scale: number,
) {
  const x = (sticker.x / 100) * width;
  const y = (sticker.y / 100) * height;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.font = `700 ${sticker.fontSize * scale}px ${fontFamilyFor(sticker.font)}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const padX = 10 * scale;
  const padY = 4 * scale;
  const metrics = ctx.measureText(sticker.text);
  const textH = sticker.fontSize * scale;
  if (sticker.background && sticker.background !== "transparent") {
    ctx.fillStyle = sticker.background;
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 12 * scale;
    roundedRect(ctx, 0, -textH / 2 - padY, metrics.width + padX * 2, textH + padY * 2, 14 * scale);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetY = 2 * scale;
  }
  ctx.fillStyle = sticker.color;
  ctx.fillText(sticker.text, padX, 0);
  ctx.restore();
}

export async function renderPageDesignToPng(
  design: PageDesign,
  stickers: StickerOverlay[],
  width: number,
  height: number,
): Promise<string> {
  const canvas = document.createElement("canvas");
  const pixelRatio = 2;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持图片导出画布");
  ctx.scale(pixelRatio, pixelRatio);
  fillBackground(ctx, design.background, width, height);
  if (design.bgImageUrl) {
    const bg = await loadImageSafe(design.bgImageUrl);
    if (bg) {
      const s = Math.max(width / bg.naturalWidth, height / bg.naturalHeight);
      const dw = bg.naturalWidth * s;
      const dh = bg.naturalHeight * s;
      ctx.drawImage(bg, (width - dw) / 2, (height - dh) / 2, dw, dh);
    }
  }
  const layerScale = width / 320;
  const layers = [...design.layers].sort((a, b) => a.z - b.z);
  for (const layer of layers) {
    if (layer.type === "image") {
      await drawImageLayer(ctx, layer, width, height, layerScale);
    } else {
      drawTextLayer(ctx, layer, width, height, layerScale);
    }
  }
  for (const sticker of stickers) drawSticker(ctx, sticker, width, height, layerScale);
  return canvas.toDataURL("image/png");
}
