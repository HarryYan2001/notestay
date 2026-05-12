import type { Express, Request, Response } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage } from "./storage";
import {
  buildSystemPrompt,
  buildUserPrompt,
  callZhipu,
  parseModelOutput,
  ZHIPU_DEFAULT_MODEL,
  type AiGenerateRequest,
} from "../shared/ai-prompt";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // POST /api/generate-note — mirrors the Vercel serverless function so the
  // same client code works against the local Express dev server. Requires
  // ZHIPU_API_KEY in the dev environment; otherwise returns 503 with the
  // same shape as production so the UI can surface the missing-config
  // message.
  app.post("/api/generate-note", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          "AI 生成服务未配置。本地开发请在环境变量中设置 ZHIPU_API_KEY，或参考 VERCEL_DEPLOY.md 在 Vercel 部署后使用。",
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
