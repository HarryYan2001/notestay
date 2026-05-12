// Canonical prompt construction + response parsing + Zhipu HTTP wiring for
// the AI note generation feature. Used by:
//   - the Express dev server (`server/routes.ts`)
//   - the client bundle (`client/src/lib/ai-generate.ts`) for typings + tests
//   - offline smoke tests under `script/`
//
// The Vercel serverless function (`api/generate-note.ts`) DELIBERATELY does
// NOT import this file. After repeated production failures
// (FUNCTION_INVOCATION_FAILED on static cross-dir imports, "Cannot find
// module '/var/task/shared/ai-prompt'" on dynamic ones, then
// FUNCTION_INVOCATION_FAILED again even with a sibling `api/_ai-prompt.ts`
// helper), we now keep the handler fully self-contained — its runtime is
// inlined inside `api/generate-note.ts` with zero value imports so cold
// start cannot fail on resolution / bundling. See the comment block at the
// top of that file for the full history. This module is the canonical
// source for everyone ELSE; the duplication is deliberate.
//
// Design goals (unchanged):
//   1. Model only generates Chinese Xiaohongshu hotel-review TEXT.
//   2. Strong guardrails — no invented facts.
//   3. OCR-learned reference style is style METHOD, never content to copy.
//   4. Output is strict JSON.

// ---------- request payload (client -> server) ----------

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

// ---------- response payload (server -> client) ----------

export interface AiGenerateResponse {
  title: string;
  altTitles: string[];
  body: string;
  hashtags: string[];
  commentGuide: string[];
  warnings: string[];
}

// ---------- helpers ----------

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

export function parseModelOutput(raw: string): AiGenerateResponse {
  if (!raw || typeof raw !== "string") {
    throw new Error("AI 返回内容为空。");
  }
  let body = raw.trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  if (!body.startsWith("{")) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) body = body.slice(start, end + 1);
  }
  let obj: any;
  try {
    obj = JSON.parse(body);
  } catch (err) {
    throw new Error(`AI 返回内容不是合法 JSON：${(err as Error).message}`);
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("AI 返回 JSON 结构异常（非对象）。");
  }
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) throw new Error("AI 返回缺少 title 字段。");
  const altTitles = Array.isArray(obj.altTitles)
    ? obj.altTitles.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim())
    : [];
  const bodyText = typeof obj.body === "string" ? obj.body.trim() : "";
  if (!bodyText) throw new Error("AI 返回缺少 body 字段。");
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

// ---------- Zhipu (BigModel) HTTP wiring ----------

export const ZHIPU_DEFAULT_MODEL = "glm-4.5";
export const ZHIPU_ENDPOINT =
  "https://open.bigmodel.cn/api/paas/v4/chat/completions";

export interface ZhipuCallOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ZhipuRawChoice {
  message?: { content?: string };
}

export interface ZhipuRawResponse {
  choices?: ZhipuRawChoice[];
  error?: { message?: string } | string;
}

export const ZHIPU_DEFAULT_TIMEOUT_MS = 55_000;

export async function callZhipu(
  systemPrompt: string,
  userPrompt: string,
  opts: ZhipuCallOptions,
): Promise<string> {
  const model = opts.model || ZHIPU_DEFAULT_MODEL;
  const endpoint = opts.endpoint || ZHIPU_ENDPOINT;
  const timeoutMs = opts.timeoutMs ?? ZHIPU_DEFAULT_TIMEOUT_MS;
  const fetchFn = opts.fetchImpl || (globalThis.fetch as typeof fetch);
  if (!fetchFn) throw new Error("当前运行环境缺少 fetch 实现。");
  if (!opts.apiKey) throw new Error("ZHIPU_API_KEY 未配置。");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
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
        signal: controller.signal,
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
    const content = json.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("Zhipu API 返回中没有可用的 message.content。");
    }
    return content;
  } finally {
    clearTimeout(timer);
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
