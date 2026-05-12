// Vercel serverless function: POST /api/generate-note
//
// Accepts an AiGenerateRequest (see api/_ai-prompt.ts), calls Zhipu's
// (BigModel) OpenAI-compatible chat-completions endpoint, and returns a
// strict-JSON AiGenerateResponse the client can render.
//
// Auth & secrets:
//   - ZHIPU_API_KEY  (required) — server-side only, never shipped to the client bundle
//   - ZHIPU_MODEL    (optional) — defaults to ZHIPU_DEFAULT_MODEL
//
// Vercel compatibility notes (this file is the canonical workaround for the
// FUNCTION_INVOCATION_FAILED / "Cannot find module" production bugs):
//
//   1. The prompt + Zhipu wrapper runtime lives in `./_ai-prompt.ts`, a
//      SIBLING file inside `api/`. The leading underscore tells Vercel not
//      to expose it as its own serverless function (see
//      https://github.com/vercel/vercel/discussions/4983). Sibling files in
//      `api/` are always included in the function bundle, so we can use a
//      plain static import here without risking the cross-directory tracer
//      failures we saw with `../shared/ai-prompt`. Dynamic imports are
//      avoided because Vercel's NFT cannot statically trace dynamic-import
//      string paths — that was the bug that PR #28 introduced.
//   2. NO `export const config = { runtime: ... }`. That field is a
//      Next.js middleware concept; on a plain Vercel `api/*.ts` Node
//      function it has historically caused init crashes.
//   3. NO TypeScript path aliases (`@shared/...`). All imports are relative
//      and sibling-only.
//   4. NO `process.env` reads or other side-effects at module top level.
//   5. The handler is wrapped in a defensive try/catch so any unexpected
//      throw is converted to a structured 500 JSON instead of
//      FUNCTION_INVOCATION_FAILED.

import {
  ZHIPU_DEFAULT_MODEL,
  buildSystemPrompt,
  buildUserPrompt,
  callZhipu,
  parseModelOutput,
  type AiGenerateRequest,
  type AiGenerateResponse,
} from "./_ai-prompt";

// Vercel's Node helpers don't require @vercel/node types; we describe the
// minimal request/response shape we depend on so the file compiles cleanly
// under the repo's tsconfig.
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
  // Always set headers FIRST, before any branch can return. This guarantees
  // every response — including error paths — is identifiable as JSON.
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  } catch {
    // Some adapters may reject setHeader after the response has begun. We
    // swallow because the response will still carry SOME content-type.
  }

  try {
    if (req.method === "OPTIONS") {
      try {
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      } catch {
        /* noop */
      }
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
      // Surface upstream timeouts as 504 with an actionable Chinese hint so
      // the frontend can distinguish "slow model" from "model returned 4xx".
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
    // Last-resort guard: any unexpected throw outside the inner blocks
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

// ---------- helpers (kept local — no shared-module dependency) ----------

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
