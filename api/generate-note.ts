// Vercel serverless function: POST /api/generate-note
//
// Accepts an AiGenerateRequest, calls Zhipu's (BigModel) OpenAI-compatible
// chat-completions endpoint, and returns a strict-JSON AiGenerateResponse
// the client can render.
//
// Auth & secrets:
//   - ZHIPU_API_KEY  (required) — server-side only, never shipped to the client bundle
//   - ZHIPU_MODEL    (optional) — defaults to ZHIPU_DEFAULT_MODEL
//
// ──────────────────────────────────────────────────────────────────────────
// VERCEL HARDENING — this file is intentionally fully self-contained.
// ──────────────────────────────────────────────────────────────────────────
// History of production failures (each one fixed a layer but revealed the
// next):
//
//   PR #27 — top-level `import { … } from "../shared/ai-prompt"` caused a
//            cold-start crash on Vercel → FUNCTION_INVOCATION_FAILED page,
//            no JSON body, the user only saw a generic 500.
//
//   PR #28 — switched to `await import("../shared/ai-prompt")`. Cold start
//            survived, but at request time NFT (Vercel's file tracer)
//            had not bundled the shared file at all (dynamic import strings
//            are not statically traceable), so any configured-key request
//            failed with "Cannot find module '/var/task/shared/ai-prompt'".
//
//   PR #30 — moved the runtime into a sibling `api/_ai-prompt.ts` and
//            re-introduced a STATIC sibling import. Smoke tests all
//            passed; tsc was clean; Vercel's own docs say sibling api/*.ts
//            files are always bundled. But the deployed function STILL
//            returned the generic `FUNCTION_INVOCATION_FAILED ... pdx1::…`
//            text/plain page on the configured-key path, with no JSON and
//            no useful logs accessible via the CLI.
//
// Since we cannot reliably observe what the Vercel tracer/runtime does to
// our function, this file now removes the only remaining variable: it has
// ZERO value imports. Every helper — request parsing, validation, prompt
// construction, Zhipu HTTP call, output parsing, timeout handling — is
// inlined below. The only top-level statements are `const`/`function`/
// `export` declarations; no module-level `process.env` reads, no top-level
// `await`, no side effects.
//
// Other anti-footguns this file observes:
//   * No `export const config = { runtime: ... }` (that field is a Next.js
//     middleware concept and has historically caused init crashes on plain
//     Vercel `api/*.ts` Node functions). `vercel.json` controls maxDuration.
//   * No TypeScript path aliases (`@shared/...`).
//   * No third-party imports (no `zod`, no `@vercel/node`).
//   * No top-level error possibilities — the handler body, including
//     `process.env` reads, lives inside try/catch so anything unexpected
//     becomes a structured 500 JSON instead of FUNCTION_INVOCATION_FAILED.
//   * The handler signature is the documented Vercel one:
//       `export default async function handler(req, res)`
//     and we only use `req.method`, `req.body`, `res.setHeader`, `res.status`,
//     `res.json` — all stable across Vercel's Node runtime versions.
//   * fetch / AbortController are referenced via `globalThis` so the
//     reference itself never throws at module init even on the off chance a
//     runtime is missing them. Missing-fetch is reported as a structured
//     500 from inside the handler instead.
//
// The canonical copy of this runtime ALSO lives in `shared/ai-prompt.ts`
// for the dev server (`server/routes.ts`), the client bundle, and the
// offline smoke tests. The duplication is deliberate: those consumers
// cannot crash Vercel, and the cost of two copies of ~300 lines of TS is
// far smaller than a recurring production outage.

// ───────────────── Vercel handler types (structural, type-only) ──────────

export interface VercelLikeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

export interface VercelLikeResponse {
  status(code: number): VercelLikeResponse;
  json(body: any): VercelLikeResponse;
  setHeader(name: string, value: string): void;
  end?: (body?: any) => void;
}

// ───────────────── inlined: request / response payloads ──────────────────

export type AiInputMode = "framework" | "freeform";
export type AiTextStyleStrength = "light" | "medium" | "high";

export interface AiFrameworkField {
  label: string;
  value: string;
}

export interface AiHotelInfo {
  name: string;
  brand: string;
  city: string;
  price: string;
  roomType: string;
  stayDate: string;
}

export interface AiImageSummary {
  totalCount: number;
  categories: { name: string; count: number }[];
}

export interface AiScreenshotStyleRef {
  hasText: boolean;
  tone: string;
  cues: string[];
  cueLabels: string[];
  detectedEmoji: string[];
  punctIntensity: number;
  avgSentenceLen: number;
  hashtagCount: number;
}

export interface AiGenerateRequest {
  inputMode: AiInputMode;
  framework: AiFrameworkField[];
  freeText: string;
  hotel: AiHotelInfo;
  images: AiImageSummary;
  styleKey: string;
  styleName: string;
  styleTone: string;
  textStyleStrength: AiTextStyleStrength;
  screenshotStyle: AiScreenshotStyleRef | null;
}

export interface AiGenerateResponse {
  title: string;
  altTitles: string[];
  body: string;
  hashtags: string[];
  commentGuide: string[];
  warnings: string[];
}

// ───────────────── inlined: prompt construction ──────────────────────────

const STRENGTH_INSTRUCTIONS: Record<AiTextStyleStrength, string> = {
  light:
    "轻度模仿：仅在标题或开头处轻触参考语气，正文整体保持 NoteStay 默认的小红书博主口吻，emoji 数量克制。",
  medium:
    "中度模仿：标题、开头、正文段落与结尾都按参考节奏调整。句长、emoji 密度、口吻向参考靠拢，但严禁照抄原句。",
  high:
    "高强度模仿：必须明显呈现参考风格——句长、emoji 数量、感叹/省略号节奏、称呼语（如「姐妹们」「宝子」等只在参考中出现时才用）、CTA 钩子（蹲/求/收藏/抄作业）都要紧扣参考。正文每段都要有可识别的风格痕迹，但只复刻方法，不复刻字句。",
};

function nonEmpty(s: string | null | undefined): string {
  return (s || "").trim();
}

function fmtList(items: string[]): string {
  return items.filter((x) => x && x.trim()).join("、") || "（无）";
}

export function buildSystemPrompt(): string {
  return [
    "你是 NoteStay 的小红书酒店测评写作助手，专门为中文用户撰写小红书风格的酒店入住笔记。",
    "你的输出必须是严格 JSON，遵守用户给定的 JSON Schema，不要包裹 markdown 代码块、不要添加说明文字。",
    "你必须遵守以下硬性内容规则：",
    "1. 只能使用用户在请求中提供的「酒店事实」与「用户心得」。若信息缺失，必须用中性表述或直接省略；严禁编造价格、服务、设施、早餐内容、地理位置、品牌承诺等任何未提供的事实。",
    "2. 当用户未提供酒店名称时，正文以「这家酒店」「这家」等中性指代；不得编造名称。未提供价格时，整篇笔记不得出现具体价格数字。未提供城市时，不得添加城市定位。",
    "3. 严禁使用以下口水短语：不得不说、总体而言、综合来说、性价比之选、性价比天花板、宝藏酒店。",
    "4. 如用户提供了「参考笔记 OCR 风格」，你只能模仿其文字风格方法（标题节奏、句长、emoji 密度、口吻、CTA 钩子、段落节奏），绝对不可以照抄参考笔记中的任何具体词句、酒店名、品牌、地名、价格、设施或事实，也不可暗示自己读过该参考。",
    "5. 正文整体目标 ~500 中文字符，硬上限 600 中文字符。",
    "6. 默认输出 3 个 hashtag，形式为「#标签」。若用户提供了城市或酒店名，请把它们体现在 hashtag 中。",
    "7. 标题以小红书钩子风格为主，可使用 emoji，但不得超过 2 个。",
    "8. body 中使用「emoji 空格 标签」开头作为分段小标题（例如「📍 位置」「🛏️ 房间」），仅为用户实际提供过的维度添加小节，不要凭空补充小节。",
    "9. 若用户根本没提供任何文字内容，请在 warnings 中明确告知并输出极简的提示性 body，而非编造细节。",
    "返回结构必须包含字段：title (string), altTitles (string[]), body (string), hashtags (string[]), commentGuide (string[]), warnings (string[])。",
  ].join("\n");
}

export function buildUserPrompt(req: AiGenerateRequest): string {
  const lines: string[] = [];
  const hotel = req.hotel;

  lines.push("【酒店事实 / Hotel Facts — 仅可使用以下提供过的字段】");
  lines.push(`酒店名称: ${nonEmpty(hotel.name) || "（用户未提供 — 正文不得出现名称）"}`);
  lines.push(`品牌: ${nonEmpty(hotel.brand) || "（未提供）"}`);
  lines.push(`城市: ${nonEmpty(hotel.city) || "（未提供 — 不得添加城市定位）"}`);
  lines.push(`价格: ${nonEmpty(hotel.price) || "（未提供 — 正文不得出现任何价格数字）"}`);
  lines.push(`房型: ${nonEmpty(hotel.roomType) || "（未提供）"}`);
  lines.push(`入住时间: ${nonEmpty(hotel.stayDate) || "（未提供）"}`);

  lines.push("");
  lines.push("【用户心得 / User Material — 只能基于这些内容展开】");
  if (req.inputMode === "framework") {
    const blocks = req.framework.filter((f) => nonEmpty(f.value));
    if (blocks.length === 0) {
      lines.push("（框架模式：用户未填写任何维度内容。请在 warnings 中说明，并仅输出占位性 body。）");
    } else {
      lines.push("输入模式: 框架模式（用户已分维度填写，请按用户提供的标签为每个非空维度生成对应小节）。");
      for (const b of blocks) {
        lines.push(`- 「${b.label}」: ${b.value.trim()}`);
      }
    }
  } else {
    const ft = nonEmpty(req.freeText);
    lines.push("输入模式: 自由文本模式（用户用一段话描述本次入住）。");
    lines.push(ft || "（用户未填写任何自由文本。请在 warnings 中说明，并仅输出占位性 body。）");
  }

  lines.push("");
  lines.push("【图片素材摘要 — 仅作上下文，禁止据此编造照片中根本看不到的细节】");
  if (req.images.totalCount === 0) {
    lines.push("（用户未上传任何照片）");
  } else {
    lines.push(`上传 ${req.images.totalCount} 张照片，分类：${fmtList(req.images.categories.map((c) => `${c.name}×${c.count}`))}`);
  }

  lines.push("");
  lines.push("【视觉风格倾向（仅文本语气参考，不影响排版）】");
  lines.push(`风格: ${req.styleName}｜调性: ${req.styleTone}`);

  lines.push("");
  lines.push("【参考笔记 OCR 风格 — 只模仿方法，绝对禁止照抄字句或暗示读过】");
  if (req.screenshotStyle && req.screenshotStyle.hasText) {
    const s = req.screenshotStyle;
    lines.push(`参考 tone: ${s.tone}`);
    lines.push(`参考 cues: ${fmtList(s.cueLabels.length ? s.cueLabels : s.cues)}`);
    lines.push(`平均句长: ${s.avgSentenceLen.toFixed(1)} 字 | 标点强度: ${(s.punctIntensity * 100).toFixed(0)}% | hashtag 数量: ${s.hashtagCount}`);
    lines.push(`参考 emoji 集合: ${fmtList(s.detectedEmoji)}`);
    lines.push("⚠️ 严禁直接搬运参考笔记中的酒店名、品牌、城市、价格、设施、人物、事件、原句；只复刻节奏与口吻。");
  } else {
    lines.push("（用户未提供参考笔记截图 / OCR 文本不足。按 NoteStay 默认博主语气生成。）");
  }

  lines.push("");
  lines.push("【模仿强度】");
  lines.push(STRENGTH_INSTRUCTIONS[req.textStyleStrength]);

  lines.push("");
  lines.push("请输出严格 JSON，键名固定为 title / altTitles / body / hashtags / commentGuide / warnings。");
  lines.push("altTitles 提供 2-3 条备选标题；hashtags 默认 3 条（形如「#xxxx」）；commentGuide 提供 3-5 条评论引导；warnings 列出所有信息缺失或风险提示。");

  return lines.join("\n");
}

// ───────────────── inlined: model output parsing ────────────────────────

// Find the first top-level balanced JSON object inside a string. See
// shared/ai-prompt.ts:extractFirstJsonObject for the canonical implementation
// and rationale. Duplicated here for the Vercel-zero-imports invariant.
export function extractFirstJsonObject(s: string): string | null {
  if (!s) return null;
  let i = 0;
  while (i < s.length && s[i] !== "{") i++;
  if (i >= s.length) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return s.slice(i, j + 1);
      }
    }
  }
  return null;
}

export function parseModelOutput(
  raw: string,
  opts: { strict?: boolean } = {},
): AiGenerateResponse {
  const strict = opts.strict !== false;
  if (!raw || typeof raw !== "string") {
    throw new Error("AI 返回内容为空。");
  }
  let body = raw.trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  let candidate = body;
  if (!candidate.startsWith("{")) {
    const found = extractFirstJsonObject(body);
    if (found) candidate = found;
  } else {
    const found = extractFirstJsonObject(body);
    if (found && found.length < body.length) candidate = found;
  }
  let obj: any;
  try {
    obj = JSON.parse(candidate);
  } catch (err) {
    if (strict) {
      throw new Error(`AI 返回内容不是合法 JSON：${(err as Error).message}`);
    }
    obj = null;
  }
  if (!obj || typeof obj !== "object") {
    if (strict) throw new Error("AI 返回 JSON 结构异常（非对象）。");
    obj = {};
  }
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title && strict) throw new Error("AI 返回缺少 title 字段。");
  const altTitles = Array.isArray(obj.altTitles)
    ? obj.altTitles.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim())
    : [];
  const bodyText = typeof obj.body === "string" ? obj.body.trim() : "";
  if (!bodyText && strict) throw new Error("AI 返回缺少 body 字段。");
  const hashtagsRaw = Array.isArray(obj.hashtags) ? obj.hashtags : [];
  const hashtags = hashtagsRaw
    .filter((x: any) => typeof x === "string" && x.trim())
    .map((x: string) => {
      const t = x.trim();
      return t.startsWith("#") ? t : `#${t}`;
    });
  const commentGuide = Array.isArray(obj.commentGuide)
    ? obj.commentGuide.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim())
    : [];
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim())
    : [];
  return { title, altTitles, body: bodyText, hashtags, commentGuide, warnings };
}

// ───────────────── inlined: Zhipu HTTP call ─────────────────────────────

export const ZHIPU_DEFAULT_MODEL = "glm-4.5";
export const ZHIPU_ENDPOINT =
  "https://open.bigmodel.cn/api/paas/v4/chat/completions";

// Kept ~5s below the Vercel Hobby plan maxDuration (60s) so the upstream
// call has a chance to finish cleanly and we can format a readable error
// before the platform kills the invocation. If you raise maxDuration in
// vercel.json (Pro plan allows up to 300s), raise this too.
export const ZHIPU_DEFAULT_TIMEOUT_MS = 55_000;

export interface ZhipuCallOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ZhipuRawResponse {
  choices?: any[];
  error?: { message?: string } | string;
}

// Zhipu / BigModel (GLM-4.x) is OpenAI-compatible but its returned shape
// drifts in practice. We've observed all of these in the wild:
//
//   1. canonical:                choices[0].message.content = "…json…"
//   2. structured content parts: choices[0].message.content = [{type:"text", text:"…"}, …]
//   3. reasoning_content split:  choices[0].message.content = "" and
//                                choices[0].message.reasoning_content = "…json…"
//                                (a GLM-4 reasoning-tier quirk)
//   4. tool-call style:          choices[0].message.tool_calls[0].function.arguments = "…json…"
//                                (model interprets json_object response_format
//                                 as a function call)
//   5. streaming chunk in body:  choices[0].delta.content = "…"
//   6. legacy text completion:   choices[0].text = "…"
//
// Before PR #34 we only accepted (1) and failed every other shape with
// "Zhipu API 返回中没有可用的 message.content" — which is what GitHub Pages
// users were seeing intermittently. This extractor accepts all six.
export function extractZhipuContent(json: ZhipuRawResponse): string | null {
  const choice = json.choices?.[0];
  if (!choice || typeof choice !== "object") return null;
  const msg = (choice as any).message;
  if (msg && typeof msg === "object") {
    // (1) canonical string content
    if (typeof msg.content === "string" && msg.content.trim()) {
      return msg.content;
    }
    // (2) structured content parts (OpenAI vision-style array)
    if (Array.isArray(msg.content)) {
      const parts: string[] = [];
      for (const part of msg.content) {
        if (typeof part === "string" && part.trim()) {
          parts.push(part);
        } else if (part && typeof part === "object") {
          const p: any = part;
          if (typeof p.text === "string" && p.text.trim()) parts.push(p.text);
          else if (typeof p.content === "string" && p.content.trim()) parts.push(p.content);
        }
      }
      const joined = parts.join("").trim();
      if (joined) return joined;
    }
    // (3) reasoning_content fallback (GLM-4 reasoning tier)
    if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
      return msg.reasoning_content;
    }
    // (4) tool-call style — model returned its JSON as a function call
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const args = tc?.function?.arguments;
        if (typeof args === "string" && args.trim()) return args;
      }
    }
  }
  // (5) streaming chunk shape that occasionally leaks through
  const delta = (choice as any).delta;
  if (delta && typeof delta.content === "string" && delta.content.trim()) {
    return delta.content;
  }
  // (6) legacy text-completion shape
  if (typeof (choice as any).text === "string" && (choice as any).text.trim()) {
    return (choice as any).text;
  }
  return null;
}

export async function callZhipu(
  systemPrompt: string,
  userPrompt: string,
  opts: ZhipuCallOptions,
): Promise<string> {
  const model = opts.model || ZHIPU_DEFAULT_MODEL;
  const endpoint = opts.endpoint || ZHIPU_ENDPOINT;
  const timeoutMs = opts.timeoutMs ?? ZHIPU_DEFAULT_TIMEOUT_MS;
  // Reference fetch + AbortController via globalThis so even if the
  // runtime lacks them, the THROW happens inside the handler's try/catch
  // (visible as a clean 500 JSON), not at module init.
  const g: any = globalThis as any;
  const fetchFn: typeof fetch = opts.fetchImpl || g.fetch;
  const AbortCtor: typeof AbortController | undefined = g.AbortController;
  if (!fetchFn) throw new Error("当前运行环境缺少 fetch 实现。");
  if (!opts.apiKey) throw new Error("ZHIPU_API_KEY 未配置。");

  const controller = AbortCtor ? new AbortCtor() : null;
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;
  try {
    let res: Response;
    try {
      res = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.85,
          top_p: 0.9,
          max_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller ? controller.signal : undefined,
      });
    } catch (err) {
      if (timedOut || isAbortLike(err)) {
        const seconds = Math.round(timeoutMs / 1000);
        throw new Error(`Zhipu API 调用超时（${seconds} 秒未返回）`);
      }
      throw err;
    }
    if (!res.ok) {
      const text = await safeReadText(res);
      throw new Error(`Zhipu API ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = (await res.json()) as ZhipuRawResponse;
    const errMsg =
      typeof json.error === "string"
        ? json.error
        : json.error && typeof json.error.message === "string"
        ? json.error.message
        : null;
    if (errMsg) throw new Error(`Zhipu API error: ${errMsg}`);
    const content = extractZhipuContent(json);
    if (!content) {
      // Build a SAFE diagnostic: top-level keys + first-choice key shape +
      // finish_reason. Never includes the request, headers, or API key.
      const choice0 = json.choices?.[0];
      const diag = {
        topKeys: Object.keys(json || {}),
        choiceKeys: choice0 && typeof choice0 === "object" ? Object.keys(choice0) : [],
        messageKeys:
          choice0 && typeof (choice0 as any).message === "object"
            ? Object.keys((choice0 as any).message)
            : [],
        finishReason:
          (choice0 && (choice0 as any).finish_reason) ||
          (choice0 && (choice0 as any).finishReason) ||
          null,
      };
      throw new Error(
        `Zhipu API 返回中没有可用的 message.content。诊断: ${JSON.stringify(diag).slice(0, 300)}`,
      );
    }
    return content;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string; message?: string };
  if (e.name === "AbortError") return true;
  if (e.code === "ABORT_ERR") return true;
  if (typeof e.message === "string" && /aborted/i.test(e.message)) return true;
  return false;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// ───────────────── inlined: body parsing + validation ───────────────────

export function parseBody(body: any): unknown {
  if (body == null) throw new Error("请求体为空。");
  if (typeof body === "string") {
    return JSON.parse(body);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
    return JSON.parse(body.toString("utf-8"));
  }
  return body;
}

export function validatePayload(p: any): string | null {
  if (!p || typeof p !== "object") return "请求体不是合法 JSON 对象。";
  if (p.inputMode !== "framework" && p.inputMode !== "freeform") {
    return "inputMode 必须为 framework 或 freeform。";
  }
  if (!Array.isArray(p.framework)) return "framework 字段必须是数组。";
  if (typeof p.freeText !== "string") return "freeText 字段必须是字符串。";
  if (!p.hotel || typeof p.hotel !== "object") return "hotel 字段必须是对象。";
  if (!p.images || typeof p.images !== "object") return "images 字段必须是对象。";
  if (typeof p.styleKey !== "string" || !p.styleKey)
    return "styleKey 字段必须是非空字符串。";
  if (
    p.textStyleStrength !== "light" &&
    p.textStyleStrength !== "medium" &&
    p.textStyleStrength !== "high"
  ) {
    return "textStyleStrength 必须为 light / medium / high 之一。";
  }
  return null;
}

// ───────────────── inlined: CORS allowlist ──────────────────────────────
//
// The static GitHub Pages build (https://harryyan2001.github.io/notestay/)
// calls THIS Vercel function cross-origin — same app, different host. We
// echo back an allowed origin instead of "*" so:
//   * Browsers accept the response even when credentials/cookies are sent.
//   * We never become an open relay for arbitrary third parties.
//
// Add new origins to DEFAULT_ALLOWED_ORIGINS when you fork. You can also
// extend at runtime via the AI_CORS_ALLOWED_ORIGINS env var (comma-separated
// list of full origins).
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://harryyan2001.github.io",
  "https://notestay.vercel.app",
];

export function buildAllowedOrigins(env?: { extra?: string }): string[] {
  const extra = (env?.extra || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]));
}

export function resolveAllowedOrigin(
  requestOrigin: string | string[] | undefined,
  allowed: string[],
): string | null {
  if (!requestOrigin) return null;
  const o = Array.isArray(requestOrigin) ? requestOrigin[0] : requestOrigin;
  if (typeof o !== "string" || !o) return null;
  return allowed.includes(o) ? o : null;
}

function applyCorsHeaders(req: VercelLikeRequest, res: VercelLikeResponse) {
  try {
    const allowed = buildAllowedOrigins({
      extra: process.env.AI_CORS_ALLOWED_ORIGINS,
    });
    const origin = resolveAllowedOrigin(req.headers?.origin, allowed);
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      // Vary: Origin is essential when echoing the origin, so intermediary
      // caches (Vercel edge, browser HTTP cache) don't serve one origin's
      // response to another.
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
  } catch {
    /* noop */
  }
}

// ───────────────── handler ──────────────────────────────────────────────

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse,
) {
  // Always set headers FIRST. Wrapped in try because some adapters reject
  // setHeader after the response has begun.
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  } catch {
    /* noop */
  }
  applyCorsHeaders(req, res);

  try {
    if (req.method === "OPTIONS") {
      return res.status(204).json({});
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "仅支持 POST 请求。" });
    }

    // process.env reads live INSIDE the handler (never at module top
    // level) so that a missing env var can never crash cold start.
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          "AI 生成服务未配置。请在 Vercel 部署环境中设置 ZHIPU_API_KEY，并参考 VERCEL_DEPLOY.md。",
      });
    }

    let payload: AiGenerateRequest;
    try {
      payload = parseBody(req.body) as AiGenerateRequest;
    } catch (err) {
      return res
        .status(400)
        .json({ error: `请求体解析失败：${(err as Error).message}` });
    }
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const model = process.env.ZHIPU_MODEL || ZHIPU_DEFAULT_MODEL;

    try {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(payload);
      const raw = await callZhipu(systemPrompt, userPrompt, {
        apiKey,
        model,
      });
      const parsed: AiGenerateResponse = parseModelOutput(raw);
      return res.status(200).json(parsed);
    } catch (err) {
      const msg = (err as Error).message || "Unknown error";
      console.error("[api/generate-note] failed:", msg);
      if (/超时|aborted|timed? out/i.test(msg)) {
        return res.status(504).json({
          error: `AI 模型响应超时：${msg}。请稍后重试或减少输入内容。`,
        });
      }
      return res.status(502).json({
        error: `调用智谱 AI 失败：${msg}`,
      });
    }
  } catch (err) {
    // Last-resort guard: any unexpected throw inside the handler body
    // becomes a structured 500 so the frontend can show a readable error
    // instead of Vercel's generic FUNCTION_INVOCATION_FAILED page.
    const msg = (err as Error)?.message || "Unknown error";
    console.error("[api/generate-note] unhandled:", msg);
    try {
      return res.status(500).json({
        error: `服务器内部错误：${msg}`,
      });
    } catch {
      throw err;
    }
  }
}
