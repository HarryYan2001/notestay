// Smoke test for the Express server's /api surface (server/routes.ts).
//
// Goal: lock down the behavior that lets this same Express app act as a
// DOMESTIC backend (e.g. running on Volcengine ECS) for the static
// GitHub Pages frontend:
//   - GET /api/health returns 200 + JSON with zhipuConfigured flag
//   - POST /api/generate-note returns 503 + Chinese error when ZHIPU_API_KEY
//     is missing (same shape as the Vercel function)
//   - OPTIONS preflight returns 204 with the matching Access-Control-* headers
//   - CORS allow-list helpers echo only known origins (never "*")
//   - AI_CORS_ALLOWED_ORIGINS extends the allow-list at runtime
//
// We never hit Zhipu here; the missing-key path is enough to exercise CORS
// and the route wiring. We use Node's built-in http client against an
// ephemeral port so this stays a single-process self-contained smoke.

import express from "express";
import { createServer } from "node:http";
import {
  registerRoutes,
  buildAllowedOrigins,
  resolveAllowedOrigin,
  DEFAULT_ALLOWED_ORIGINS,
} from "../server/routes";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function request(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    import("node:http").then(({ request: httpRequest }) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: {
            ...(body ? { "Content-Length": Buffer.byteLength(body).toString() } : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const flat: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === "string") flat[k.toLowerCase()] = v;
              else if (Array.isArray(v)) flat[k.toLowerCase()] = v.join(",");
            }
            resolve({
              status: res.statusCode ?? 0,
              headers: flat,
              body: Buffer.concat(chunks).toString("utf-8"),
            });
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  });
}

async function main() {
  // ── pure helpers ────────────────────────────────────────────────────────
  console.log("--- buildAllowedOrigins: defaults present ---");
  const defaults = buildAllowedOrigins();
  for (const expected of DEFAULT_ALLOWED_ORIGINS) {
    assert(
      defaults.includes(expected),
      `default allow-list must include ${expected}`,
    );
  }

  console.log("--- buildAllowedOrigins: extra extends, dedupes, trims ---");
  const extended = buildAllowedOrigins({
    extra:
      "https://custom.example.cn, https://harryyan2001.github.io,   https://api.notestay.cn ",
  });
  assert(extended.includes("https://custom.example.cn"), "extra origin added");
  assert(extended.includes("https://api.notestay.cn"), "trimmed extra origin added");
  assert(
    extended.filter((o) => o === "https://harryyan2001.github.io").length === 1,
    "duplicate origin must be deduped",
  );

  console.log("--- resolveAllowedOrigin: echoes only matches ---");
  const allow = buildAllowedOrigins();
  assert(
    resolveAllowedOrigin("https://harryyan2001.github.io", allow) ===
      "https://harryyan2001.github.io",
    "known origin must be echoed verbatim",
  );
  assert(
    resolveAllowedOrigin("https://evil.example.com", allow) === null,
    "unknown origin must NOT be echoed",
  );
  assert(
    resolveAllowedOrigin(undefined, allow) === null,
    "missing origin must return null (no CORS header set)",
  );
  assert(
    resolveAllowedOrigin(
      ["https://harryyan2001.github.io", "https://evil.example.com"],
      allow,
    ) === "https://harryyan2001.github.io",
    "array origin header: first element matches → echoed",
  );

  // ── live Express server (ephemeral port, no Zhipu key) ──────────────────
  // Wipe any inherited key so the 503 path is reproducible.
  delete process.env.ZHIPU_API_KEY;
  process.env.AI_CORS_ALLOWED_ORIGINS = "https://custom-pages.example.cn";

  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = httpServer.address();
  if (!addr || typeof addr === "string") {
    console.error("FAIL: server did not bind to a TCP port");
    process.exit(1);
  }
  const port = addr.port;

  try {
    console.log("--- GET /api/health: 200 + JSON, zhipuConfigured=false ---");
    {
      const r = await request(port, "GET", "/api/health");
      assert(r.status === 200, `/api/health status ${r.status} (want 200)`);
      const j = JSON.parse(r.body);
      assert(j.status === "ok", "/api/health status field must be ok");
      assert(j.service === "notestay-api", "/api/health service field");
      assert(j.zhipuConfigured === false, "zhipuConfigured must reflect missing key");
      assert(typeof j.model === "string" && j.model.length > 0, "model must be a string");
      assert(typeof j.time === "string", "time must be a string");
      assert(r.headers["cache-control"] === "no-store", "health must be uncacheable");
    }

    console.log("--- OPTIONS /api/generate-note: 204 + CORS headers ---");
    {
      const r = await request(port, "OPTIONS", "/api/generate-note", {
        Origin: "https://harryyan2001.github.io",
        "Access-Control-Request-Method": "POST",
      });
      assert(r.status === 204, `OPTIONS status ${r.status} (want 204)`);
      assert(
        r.headers["access-control-allow-origin"] === "https://harryyan2001.github.io",
        `must echo allowed origin, got: ${r.headers["access-control-allow-origin"]}`,
      );
      assert(r.headers["vary"] === "Origin", "must set Vary: Origin");
      assert(
        (r.headers["access-control-allow-methods"] || "").includes("POST"),
        "must allow POST",
      );
    }

    console.log("--- OPTIONS /api/generate-note: AI_CORS_ALLOWED_ORIGINS extension ---");
    {
      const r = await request(port, "OPTIONS", "/api/generate-note", {
        Origin: "https://custom-pages.example.cn",
        "Access-Control-Request-Method": "POST",
      });
      assert(r.status === 204, `OPTIONS extra-origin status ${r.status}`);
      assert(
        r.headers["access-control-allow-origin"] === "https://custom-pages.example.cn",
        "AI_CORS_ALLOWED_ORIGINS must extend the runtime allow-list",
      );
    }

    console.log("--- OPTIONS /api/generate-note: unknown origin gets NO CORS echo ---");
    {
      const r = await request(port, "OPTIONS", "/api/generate-note", {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "POST",
      });
      // We still return 204 (preflight isn't blocked at the protocol level)
      // but the Allow-Origin header must NOT be set, so the browser will
      // reject the actual POST.
      assert(r.status === 204, `unknown-origin OPTIONS status ${r.status}`);
      assert(
        !("access-control-allow-origin" in r.headers),
        "unknown origin must NOT receive Access-Control-Allow-Origin",
      );
    }

    console.log("--- POST /api/generate-note: 503 when ZHIPU_API_KEY missing ---");
    {
      const payload = {
        inputMode: "framework",
        framework: [{ label: "位置", value: "市中心" }],
        freeText: "",
        hotel: { name: "", brand: "", city: "", price: "", roomType: "", stayDate: "" },
        images: { totalCount: 0, categories: [] },
        styleKey: "fresh",
        styleName: "清新自然",
        styleTone: "neutral",
        textStyleStrength: "medium",
        screenshotStyle: null,
      };
      const r = await request(
        port,
        "POST",
        "/api/generate-note",
        {
          "Content-Type": "application/json",
          Origin: "https://harryyan2001.github.io",
        },
        JSON.stringify(payload),
      );
      assert(r.status === 503, `missing-key status ${r.status} (want 503)`);
      const j = JSON.parse(r.body);
      assert(
        typeof j.error === "string" && /未配置/.test(j.error),
        `503 body must include Chinese 未配置 error, got: ${j.error}`,
      );
      assert(
        r.headers["access-control-allow-origin"] === "https://harryyan2001.github.io",
        "503 must still carry CORS so the browser can read the error",
      );
    }

    console.log("--- POST /api/generate-note: 400 on bad payload (key set, no real call) ---");
    {
      process.env.ZHIPU_API_KEY = "smoke-test-key-not-real";
      try {
        const r = await request(
          port,
          "POST",
          "/api/generate-note",
          { "Content-Type": "application/json" },
          JSON.stringify({ inputMode: "bogus" }),
        );
        assert(r.status === 400, `bad-payload status ${r.status} (want 400)`);
        const j = JSON.parse(r.body);
        assert(
          typeof j.error === "string" && j.error.length > 0,
          "400 body must include validation error string",
        );
      } finally {
        delete process.env.ZHIPU_API_KEY;
      }
    }

    console.log("server CORS/health smoke OK");
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    delete process.env.AI_CORS_ALLOWED_ORIGINS;
  }
}

main().catch((err) => {
  console.error("FAIL: smoke-server-cors-health threw:", err);
  process.exit(1);
});
