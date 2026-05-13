// Client-side AI generation wrapper.
//
// On every "生成笔记" / "重新生成" click we:
//   1. Build the deterministic "visual scaffold" from generate.ts — cover
//      design, page layout, page designs, stickers, screenshot/viral style
//      summaries, warnings. This is fast, local, and does not depend on
//      network.
//   2. Decide whether to call the AI:
//      - If the user uploaded a style-learning screenshot AND OCR recovered
//        usable text, the style imitation step needs the model. We POST the
//        user's text inputs + style + OCR profile to /api/generate-note,
//        which calls Zhipu (BigModel) to produce the actual title / body /
//        tags / comment seeds. Hotel/scene photos uploaded for the cover do
//        NOT trigger this path on their own — they are content, not style
//        references.
//      - Otherwise we return the local scaffold directly. The local
//        generator already follows the user-approved Xiaohongshu rules
//        (warm tone, no banned phrases, auto-clustered dimensions, ~500
//        char body, dedicated price section, 3 default hashtags, no
//        fabrication), so for the no-imitation path it produces the same
//        kind of output without paying the latency or risking model
//        failure.
//   3. Merge AI text on top of the deterministic scaffold and return a
//      `GeneratedNote` the result page can render as-is.
//
// If the AI call fails (missing key, network, parse error, malformed JSON,
// timeout, etc.), we fall back to the local scaffold and surface a warning
// telling the user that local fallback was used. The 503 "未配置" path is
// the single exception that still throws as `AiNotConfiguredError` so the
// create page can show its install-guidance banner — and only when the user
// explicitly opted into the model by uploading a style screenshot.

import { generateNote } from "./generate";
import { STYLES } from "./styles";
import { TEXT_CUE_LABELS } from "./screenshot-text-style";
import type { AppInputState, GeneratedNote } from "./types";
import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiImageSummary,
  AiScreenshotStyleRef,
  AiTextStyleStrength,
} from "../../../shared/ai-prompt";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Where the AI backend lives when the frontend is served from a host that
// does NOT have its own /api/generate-note (i.e. GitHub Pages). The Vercel
// deployment of the same app hosts the real serverless function.
//
// Resolution order:
//   1. Build-time override `import.meta.env.VITE_AI_API_BASE_URL`. Set this
//      when you fork the project to a different Vercel URL.
//   2. If the page is served from `*.github.io`, use the canonical Vercel URL.
//   3. Otherwise (Vercel, local dev), use a same-origin relative path. This
//      keeps the existing same-origin behaviour intact, so cookies, CSP,
//      and proxy setups all keep working on Vercel.
//
// Exported so smoke tests and tooling can exercise the resolver.
export const DEFAULT_VERCEL_AI_API_URL =
  "https://notestay.vercel.app/api/generate-note";

export interface ResolveAiApiUrlEnv {
  hostname?: string;
  buildOverride?: string;
}

export function resolveAiApiUrl(env: ResolveAiApiUrlEnv = {}): string {
  const override = (env.buildOverride || "").trim();
  if (override) {
    // Allow either a full URL or just a base; append /api/generate-note if
    // the override does not already point at the route.
    if (/\/api\/generate-note\/?$/.test(override)) return override;
    return override.replace(/\/+$/, "") + "/api/generate-note";
  }
  const host = (env.hostname || "").toLowerCase();
  if (host.endsWith(".github.io") || host === "github.io") {
    return DEFAULT_VERCEL_AI_API_URL;
  }
  return `${API_BASE}/api/generate-note`;
}

function currentHostname(): string {
  try {
    return typeof globalThis !== "undefined" &&
      (globalThis as any).location &&
      typeof (globalThis as any).location.hostname === "string"
      ? ((globalThis as any).location.hostname as string)
      : "";
  } catch {
    return "";
  }
}

function buildOverride(): string {
  try {
    // import.meta.env is a Vite-injected object. In smoke-test / Node
    // contexts it may be undefined — guard everything.
    const meta: any = (import.meta as any) || {};
    const env = meta.env || {};
    return typeof env.VITE_AI_API_BASE_URL === "string"
      ? env.VITE_AI_API_BASE_URL
      : "";
  } catch {
    return "";
  }
}

const IMAGE_CATEGORIES = ["外观", "大堂", "房间", "床品", "浴室", "早餐", "夜景", "周边", "其他"];

// Public for tests / debugging — builds the JSON payload the server expects.
// Pure function: no fetch, no DOM access, safe to call from smoke tests.
export function buildAiRequest(input: AppInputState): AiGenerateRequest {
  const style = STYLES[input.style];
  const strength: AiTextStyleStrength = input.textStyleStrength ?? "medium";

  // Strict mode exclusion mirrors generate.ts: only send the active mode's
  // payload so the model never sees leaked content from the other mode.
  const framework =
    input.inputMode === "framework"
      ? input.framework
          .filter((f) => f.value.trim().length > 0)
          .map((f) => ({ label: (f.label || "").trim(), value: f.value.trim() }))
      : [];
  const freeText = input.inputMode === "freeform" ? input.freeText.trim() : "";

  const counts = new Map<string, number>();
  for (const img of input.images) {
    const k = IMAGE_CATEGORIES.includes(img.category) ? img.category : "其他";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const images: AiImageSummary = {
    totalCount: input.images.length,
    categories: Array.from(counts.entries()).map(([name, count]) => ({ name, count })),
  };

  let screenshotStyle: AiScreenshotStyleRef | null = null;
  const ts = input.screenshotRef?.textStyle;
  if (ts && ts.hasText) {
    screenshotStyle = {
      hasText: true,
      tone: ts.tone,
      cues: ts.cues,
      cueLabels: ts.cues.map((c) => TEXT_CUE_LABELS[c as keyof typeof TEXT_CUE_LABELS] ?? c),
      detectedEmoji: ts.detectedEmoji,
      punctIntensity: ts.punctIntensity,
      avgSentenceLen: ts.avgSentenceLen,
      hashtagCount: ts.hashtagCount,
    };
  }

  return {
    inputMode: input.inputMode,
    framework,
    freeText,
    hotel: { ...input.hotel },
    images,
    styleKey: style.key,
    styleName: style.name,
    styleTone: style.vibe,
    textStyleStrength: strength,
    screenshotStyle,
  };
}

// Merge AI-produced text fields onto the deterministic visual scaffold.
// Visual layout, cover design, sticker placement and page designs are kept
// from the local generator so the editor / preview / export pipeline
// continues to work unchanged.
export function mergeAiResponse(
  scaffold: GeneratedNote,
  ai: AiGenerateResponse,
): GeneratedNote {
  const title = ai.title.trim();
  // Keep up to 3 alts and dedupe against the main title.
  const altTitles = ai.altTitles
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== title)
    .slice(0, 3);
  // Hashtags: enforce "#" prefix, dedupe case-sensitively, prefer the AI's
  // ordering, default to exactly 3 by truncation.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of ai.hashtags) {
    const t = raw.startsWith("#") ? raw : `#${raw}`;
    if (!seen.has(t)) {
      seen.add(t);
      tags.push(t);
    }
    if (tags.length >= 3) break;
  }
  if (tags.length === 0) tags.push(...scaffold.tags);

  const commentSeeds = ai.commentGuide.length ? ai.commentGuide : scaffold.commentSeeds;

  // Merge warnings: scaffold warnings already capture missing-info /
  // visual-only notes (no images, no city …); AI may add safety notes.
  const warnings = dedupe([...scaffold.warnings, ...ai.warnings]);

  // Update the cover layer "title caption" to mirror the new title so the
  // export pipeline doesn't ship a stale template title under the cover.
  const cover = { ...scaffold.cover };
  const updatedPageLayout = scaffold.pageLayout.map((p) =>
    p.index === 0 ? { ...p, caption: title } : p,
  );

  return {
    ...scaffold,
    title,
    originalTitle: title,
    altTitles,
    body: ai.body,
    tags,
    commentSeeds,
    pageLayout: updatedPageLayout,
    cover,
    warnings,
  };
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export interface AiGenerateOptions {
  // Inject a fetch implementation for tests. Defaults to global fetch.
  fetchImpl?: typeof fetch;
  // Override endpoint for tests. Defaults to relative /api/generate-note.
  endpoint?: string;
  // Per-request timeout in ms. Defaults to FRONTEND_AI_TIMEOUT_MS.
  timeoutMs?: number;
  // For tests: force the API path even when needsApiCall would return false,
  // or force the local-only path even when a screenshot was provided.
  forceApi?: boolean;
  forceLocal?: boolean;
}

// True when the request needs the external model to do style imitation —
// i.e. the user uploaded a 爆款笔记正文风格学习 screenshot and OCR recovered
// usable text. Hotel/scene photos uploaded for the cover deck are content,
// not style references, and do NOT trigger the API path on their own.
export function needsApiCall(input: AppInputState): boolean {
  const ts = input.screenshotRef?.textStyle;
  return !!(ts && ts.hasText);
}

// Convert raw prose (when the model failed to produce JSON at all) into a
// best-effort response shape that the merge step can consume. We never
// fabricate hotel facts here — the prose is offered as a single body block
// and we lean on the local scaffold for the title / hashtags / comment guide
// downstream. Returns null if the prose is too short to be useful.
function proseToResponse(raw: string): AiGenerateResponse | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/```[a-z]*\n?|\n?```/gi, "").trim();
  if (cleaned.length < 20) return null;
  return {
    title: "",
    altTitles: [],
    body: cleaned,
    hashtags: [],
    commentGuide: [],
    warnings: [],
  };
}

// Frontend abort budget. Must be larger than the Vercel function
// maxDuration (60s on Hobby, up to 300s on Pro) plus cold-start overhead,
// so the browser doesn't kill a request the model and the function would
// have completed. The previous 70s budget cut off requests just as the
// model was responding, surfacing as "signal is aborted without reason".
export const FRONTEND_AI_TIMEOUT_MS = 180_000;

// Localized error thrown when the AI route is missing / misconfigured. The
// UI distinguishes this from generic API failures to show a "请部署到 Vercel
// 并配置 ZHIPU_API_KEY" hint.
export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

// Add a single user-visible warning to a scaffold, dedupe-aware.
function withWarning(note: GeneratedNote, warning: string): GeneratedNote {
  if (note.warnings.includes(warning)) return note;
  return { ...note, warnings: [...note.warnings, warning] };
}

const API_FAILURE_FALLBACK_PREFIX = "AI 调用失败，已自动切换为本地生成：";

// Top-level call used by the create page. Returns a fully-merged
// GeneratedNote ready to navigate to /result.
//
// IMPORTANT: this function always reads the CURRENT app input state passed in.
// It never persists or reuses output from a previous call as input — every
// regenerate starts from the same `AppInputState` the user is currently
// editing. The local scaffold inside `generateNote(input)` is recomputed
// fresh each call.
export async function generateNoteWithAi(
  input: AppInputState,
  opts: AiGenerateOptions = {},
): Promise<GeneratedNote> {
  const scaffold = generateNote(input);

  // Decide whether to talk to the model at all. We only call the API when the
  // user explicitly opted into style imitation via the 爆款笔记正文风格学习
  // screenshot AND OCR produced usable text. Otherwise the local scaffold —
  // which already follows the user-approved writing rules — is returned as is.
  const apiRequired = opts.forceApi
    ? true
    : opts.forceLocal
    ? false
    : needsApiCall(input);
  if (!apiRequired) {
    return scaffold;
  }

  const endpoint =
    opts.endpoint ||
    resolveAiApiUrl({
      hostname: currentHostname(),
      buildOverride: buildOverride(),
    });
  const fetchFn = opts.fetchImpl || (globalThis.fetch as typeof fetch);
  if (!fetchFn) {
    return withWarning(
      scaffold,
      `${API_FAILURE_FALLBACK_PREFIX}当前运行环境缺少 fetch 实现。`,
    );
  }

  const payload = buildAiRequest(input);
  const timeoutMs = opts.timeoutMs ?? FRONTEND_AI_TIMEOUT_MS;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  // Track whether the abort came from OUR timeout vs. the user / page unload,
  // so we can surface a friendly Chinese timeout message instead of the raw
  // "signal is aborted without reason" string the platform throws.
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;
  let res: Response;
  try {
    res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (isAbortError(err) || timedOut) {
      const seconds = Math.round(timeoutMs / 1000);
      return withWarning(
        scaffold,
        `${API_FAILURE_FALLBACK_PREFIX}AI 生成超时（已等待 ${seconds} 秒）。`,
      );
    }
    return withWarning(
      scaffold,
      `${API_FAILURE_FALLBACK_PREFIX}无法连接到 AI 生成服务（${(err as Error).message}）。`,
    );
  }
  if (timer) clearTimeout(timer);

  if (res.status === 503) {
    const body = await safeReadJson(res);
    throw new AiNotConfiguredError(
      body?.error ||
        "AI 生成服务未配置。请在 Vercel 部署并设置 ZHIPU_API_KEY，参考 VERCEL_DEPLOY.md。",
    );
  }
  if (!res.ok) {
    const body = await safeReadJson(res);
    const msg = body?.error || `${res.status} ${res.statusText}`;
    return withWarning(scaffold, `${API_FAILURE_FALLBACK_PREFIX}${msg}`);
  }
  // Parse the response defensively. The server SHOULD return a strict shape,
  // but if the upstream model emitted prose-with-JSON the server may have
  // forwarded a partial / malformed body to keep the request usable. We accept
  // partial fields and fill the missing pieces from the local scaffold.
  let ai: AiGenerateResponse | null = null;
  try {
    const raw = (await res.json()) as any;
    if (raw && typeof raw === "object") {
      const looksUsable =
        typeof raw.title === "string" || typeof raw.body === "string";
      if (looksUsable) {
        ai = raw as AiGenerateResponse;
      } else if (typeof raw.body === "string" || typeof raw === "string") {
        ai = proseToResponse(typeof raw === "string" ? raw : raw.body);
      }
    }
  } catch {
    ai = null;
  }

  if (!ai || (typeof ai.title !== "string" && typeof ai.body !== "string")) {
    return withWarning(
      scaffold,
      `${API_FAILURE_FALLBACK_PREFIX}返回结果缺少 title 与 body。`,
    );
  }
  // Always layer AI text on top of the scaffold so missing fields keep their
  // local-rule defaults instead of vanishing.
  const merged = mergeAiResponse(scaffold, {
    title: typeof ai.title === "string" && ai.title.trim() ? ai.title : scaffold.title,
    altTitles: Array.isArray(ai.altTitles) ? ai.altTitles : scaffold.altTitles,
    body: typeof ai.body === "string" && ai.body.trim() ? ai.body : scaffold.body,
    hashtags: Array.isArray(ai.hashtags) && ai.hashtags.length > 0 ? ai.hashtags : scaffold.tags,
    commentGuide: Array.isArray(ai.commentGuide) ? ai.commentGuide : scaffold.commentSeeds,
    warnings: Array.isArray(ai.warnings) ? ai.warnings : [],
  });
  return merged;
}

// Exposed for tests.
export { API_FAILURE_FALLBACK_PREFIX };

async function safeReadJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Recognise the various ways fetch reports an aborted request across
// browsers and Node. In modern browsers the message is "signal is aborted
// without reason"; in Node 20 it's "The operation was aborted"; both set
// `name === "AbortError"` reliably.
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string; message?: string };
  if (e.name === "AbortError") return true;
  if (e.code === "ABORT_ERR") return true;
  if (typeof e.message === "string" && /aborted/i.test(e.message)) return true;
  return false;
}
