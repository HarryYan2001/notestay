import * as htmlToImage from "html-to-image";
import JSZip from "jszip";

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
