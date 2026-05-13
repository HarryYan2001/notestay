import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from 'node:http';
import {
  buildSystemPrompt,
  buildUserPrompt,
  callZhipu,
  parseModelOutput,
  ZHIPU_DEFAULT_MODEL,
  type AiGenerateRequest,
} from "../shared/ai-prompt";

// CORS allow-list shared with the Vercel function. Keep these in sync with
// api/generate-note.ts:DEFAULT_ALLOWED_ORIGINS — when this Express server is
// the domestic (e.g. Volcengine) backend serving a static GitHub Pages
// frontend, the browser will send a cross-origin request from
// https://harryyan2001.github.io and the response MUST echo a single
// allowed origin (not "*") so credentials and HTTPS-mixed-content rules stay
// happy. Extend at runtime via AI_CORS_ALLOWED_ORIGINS (comma-separated).
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

function applyCors(req: Request, res: Response) {
  try {
    const allowed = buildAllowedOrigins({
      extra: process.env.AI_CORS_ALLOWED_ORIGINS,
    });
    const origin = resolveAllowedOrigin(req.headers.origin, allowed);
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      // Vary: Origin is essential when echoing the origin, so intermediary
      // caches don't serve one origin's response to another.
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
  } catch {
    /* noop */
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Apply CORS headers + preflight handling for the entire /api surface. The
  // dev server has historically been same-origin only, but when this same
  // Express app is deployed on a domestic Node host (e.g. Volcengine ECS)
  // serving the static GitHub Pages frontend, requests arrive cross-origin.
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // GET /api/health — cheap liveness probe for PM2 / Nginx / Volcengine
  // load-balancer health checks. Reports whether the server has a Zhipu key
  // configured so an operator can tell at a glance whether the backend is
  // wired up; never returns the key itself.
  app.get("/api/health", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      status: "ok",
      service: "notestay-api",
      zhipuConfigured: Boolean(process.env.ZHIPU_API_KEY),
      model: process.env.ZHIPU_MODEL || ZHIPU_DEFAULT_MODEL,
      time: new Date().toISOString(),
    });
  });

  // POST /api/generate-note — mirrors the Vercel serverless function so the
  // same client code works against this Express server (local dev OR a
  // domestic Node host such as Volcengine ECS). Requires ZHIPU_API_KEY in
  // the environment; otherwise returns 503 with the same shape as production
  // so the UI can surface the missing-config message.
  app.post("/api/generate-note", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          "AI 生成服务未配置。请在服务器环境变量中设置 ZHIPU_API_KEY，参考 VOLCENGINE_DEPLOY.md 或 VERCEL_DEPLOY.md。",
      });
    }
    const model = process.env.ZHIPU_MODEL || ZHIPU_DEFAULT_MODEL;
    const payload = req.body as AiGenerateRequest;
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
      console.error("[/api/generate-note] failed:", msg);
      if (/超时|aborted|timed? out/i.test(msg)) {
        return res.status(504).json({
          error: `AI 模型响应超时：${msg}。请稍后重试或减少输入内容。`,
        });
      }
      return res.status(502).json({
        error: `调用智谱 AI 失败：${msg}`,
      });
    }
  });

  return httpServer;
}

function validatePayload(p: any): string | null {
  if (!p || typeof p !== "object") return "请求体不是合法 JSON 对象。";
  if (p.inputMode !== "framework" && p.inputMode !== "freeform") {
    return "inputMode 必须为 framework 或 freeform。";
  }
  if (!Array.isArray(p.framework)) return "framework 字段必须是数组。";
  if (typeof p.freeText !== "string") return "freeText 字段必须是字符串。";
  if (!p.hotel || typeof p.hotel !== "object") return "hotel 字段必须是对象。";
  if (!p.images || typeof p.images !== "object") return "images 字段必须是对象。";
  if (typeof p.styleKey !== "string" || !p.styleKey) return "styleKey 字段必须是非空字符串。";
  if (p.textStyleStrength !== "light" && p.textStyleStrength !== "medium" && p.textStyleStrength !== "high") {
    return "textStyleStrength 必须为 light / medium / high 之一。";
  }
  return null;
}
