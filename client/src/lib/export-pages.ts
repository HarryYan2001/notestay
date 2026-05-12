import * as htmlToImage from "html-to-image";
import JSZip from "jszip";

// Capture a DOM element and return a PNG dataURL.
export async function elementToPng(el: HTMLElement, width: number, height: number): Promise<string> {
  return htmlToImage.toPng(el, {
    width,
    height,
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    style: { transform: "none" },
  });
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
