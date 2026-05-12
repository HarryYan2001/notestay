// Vercel serverless function: POST /api/generate-note
//
// Accepts an AiGenerateRequest (see shared/ai-prompt.ts), calls Zhipu's
// (BigModel) OpenAI-compatible chat-completions endpoint, and returns a
// strict-JSON AiGenerateResponse the client can render.
//
// Auth & secrets:
//   - ZHIPU_API_KEY  (required) — server-side only, never shipped to the client bundle
//   - ZHIPU_MODEL    (optional) — defaults to shared/ai-prompt.ts ZHIPU_DEFAULT_MODEL
//
// On any configuration failure (missing key) we return 503 with a Chinese
// message so the UI can surface a clear "AI 生成服务未配置" message rather
// than silently falling back to template output.
//
// IMPORTANT: This file is consumed by Vercel's Node.js serverless runtime
// (the default for `api/*.ts`). We deliberately do NOT export a `config`
// object — `export const config = { runtime: "nodejs" }` is only valid for
// Next.js middleware. Setting it on a plain Vercel function bundle has been
// observed to surface as FUNCTION_INVOCATION_FAILED at runtime. The Node
// runtime is the default; no opt-in is required.

import {
  buildSystemPrompt,
  buildUserPrompt,
  callZhipu,
  parseModelOutput,
  ZHIPU_DEFAULT_MODEL,
  type AiGenerateRequest,
} from "../shared/ai-prompt";

// Vercel's Node helpers don't require @vercel/node types; we describe the
// minimal request/response shape we depend on so the file compiles cleanly
// under the repo's tsconfig (which doesn't include api/ in its build but is
// used for editor / smoke-test type-checking).
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

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse,
) {
  // CORS / cache headers. Same-origin frontend doesn't strictly need CORS,
  // but setting Content-Type defensively guarantees the client always gets
  // a JSON error even on the failure paths below.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // Defensive top-level try/catch: anything that throws synchronously or
  // asynchronously inside the handler must return a structured JSON error
  // and a non-2xx status — never a bare 500 / FUNCTION_INVOCATION_FAILED.
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).json({});
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "仅支持 POST 请求。" });
    }

    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          "AI 生成服务未配置。请在 Vercel 部署环境中设置 ZHIPU_API_KEY，并参考 VERCEL_DEPLOY.md。",
      });
    }
    const model = process.env.ZHIPU_MODEL || ZHIPU_DEFAULT_MODEL;

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

    try {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(payload);
      const raw = await callZhipu(systemPrompt, userPrompt, { apiKey, model });
      const parsed = parseModelOutput(raw);
      return res.status(200).json(parsed);
    } catch (err) {
      const msg = (err as Error).message || "Unknown error";
      console.error("[api/generate-note] failed:", msg);
      return res.status(502).json({
        error: `调用智谱 AI 失败：${msg}`,
      });
    }
  } catch (err) {
    // Last-resort guard: any unexpected throw outside the inner blocks
    // (e.g. malformed headers, unexpected runtime crash) is turned into a
    // structured 500 so the frontend can show a readable error instead of
    // Vercel's generic FUNCTION_INVOCATION_FAILED page.
    const msg = (err as Error)?.message || "Unknown error";
    console.error("[api/generate-note] unhandled:", msg);
    try {
      return res.status(500).json({
        error: `服务器内部错误：${msg}`,
      });
    } catch {
      // If even res.status throws, there's nothing we can do — let Vercel
      // surface its own error.
      throw err;
    }
  }
}

// ---------- helpers ----------

// Parse the incoming request body across the shapes Vercel may deliver it in:
//   - object: when Content-Type is application/json, Vercel parses for us.
//   - string: raw JSON string (e.g. when Content-Type was wrong or missing).
//   - Buffer: when Content-Type is application/octet-stream or unset.
//   - null / undefined: empty body — rejected with a clear message.
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
