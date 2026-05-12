// Client-side OCR for the uploaded target-note screenshot.
//
// We use tesseract.js loaded via dynamic import so:
//   1) the heavy WASM / worker / language-data assets are NOT in the initial
//      bundle — they only download when the user actually uploads a screenshot;
//   2) if the CDN load fails (offline, blocked region, etc.) the visual-style
//      learning path still works — we degrade gracefully to "no text learned"
//      and the rest of the flow keeps running.
//
// The function returns plain recognized text. The downstream analyzer
// (`screenshot-text-style.ts`) is a pure function on that string, so it is
// fully testable without spinning up an OCR engine.

export type OcrStatus = "idle" | "loading" | "recognizing" | "done" | "error";

export interface OcrResult {
  text: string;
  // Average word confidence in [0..1]. 0 when no text found.
  confidence: number;
  // True when OCR engine ran end-to-end. False when it failed to load /
  // recognize — text will be empty in that case.
  ok: boolean;
}

// Tesseract.js v5 ships language data + worker + wasm via CDN by default,
// which is what we want for a static GitHub Pages deploy. We pin the langPath
// to the jsdelivr mirror of @tesseract.js-data/chi_sim so we can recognize
// Chinese characters; English is loaded alongside for hashtag / latin text.
// Falling back to the npm-bundled default if the CDN is reachable.
const TESS_LANG = "chi_sim+eng";

export async function recognizeScreenshotText(file: File): Promise<OcrResult> {
  try {
    // Lazy import so the WASM/worker assets stay out of the initial bundle.
    const Tesseract = await import("tesseract.js");
    const result = await Tesseract.recognize(file, TESS_LANG, {
      // Silenced: tesseract logs every progress tick otherwise.
      logger: () => {},
    });
    const text = (result?.data?.text ?? "").trim();
    const conf = typeof result?.data?.confidence === "number" ? result.data.confidence / 100 : 0;
    return { text, confidence: conf, ok: true };
  } catch (err) {
    console.warn("screenshot OCR failed", err);
    return { text: "", confidence: 0, ok: false };
  }
}
