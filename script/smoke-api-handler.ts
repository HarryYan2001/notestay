// Smoke test for api/generate-note.ts (Vercel serverless handler).
//
// Goal: exercise every branch the handler can take WITHOUT a real
// ZHIPU_API_KEY, so we catch regressions like the runtime config bug that
// caused FUNCTION_INVOCATION_FAILED on Vercel.
//
// Covered branches:
//   - missing ZHIPU_API_KEY → 503 + Chinese error JSON
//   - non-POST method → 405 + JSON
//   - OPTIONS preflight → 204
//   - empty body → 400 + JSON
//   - invalid payload shape → 400 + JSON
//   - string body (raw JSON) → parsed and reaches Zhipu call (mocked here)
//   - thrown error inside Zhipu call → 502 + JSON, NOT a bare crash
//
// We never reach the real Zhipu endpoint: the success path is exercised by
// monkey-patching globalThis.fetch with a stub that returns a canned
// response. The key is set/unset around each case via process.env.

import handler, {
  parseBody,
  validatePayload,
  buildAllowedOrigins,
  resolveAllowedOrigin,
  DEFAULT_ALLOWED_ORIGINS,
  extractZhipuContent,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from "../api/generate-note";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// Minimal Vercel-like response recorder.
function mockRes(): VercelLikeResponse & {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    body: undefined as any,
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function mockReq(opts: Partial<VercelLikeRequest>): VercelLikeRequest {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: undefined,
    ...opts,
  };
}

const validPayload = {
  inputMode: "framework" as const,
  framework: [{ label: "位置", value: "市中心，交通便利。" }],
  freeText: "",
  hotel: {
    name: "测试酒店",
    brand: "",
    city: "上海",
    price: "",
    roomType: "",
    stayDate: "",
  },
  images: { totalCount: 0, categories: [] },
  styleKey: "korean_cream",
  styleName: "韩系奶油",
  styleTone: "soft",
  textStyleStrength: "medium" as const,
  screenshotStyle: null,
};

async function run() {
  // ------------------------------------------------------------------
  // Pure helper coverage: parseBody / validatePayload should never throw
  // unexpectedly across the inputs the handler will see.
  // ------------------------------------------------------------------
  console.log("--- parseBody: object, string, buffer, null ---");
  const obj = parseBody({ a: 1 });
  assert(JSON.stringify(obj) === JSON.stringify({ a: 1 }), "object body passes through");
  const fromStr = parseBody(JSON.stringify({ b: 2 }));
  assert(JSON.stringify(fromStr) === JSON.stringify({ b: 2 }), "string body parses as JSON");
  const fromBuf = parseBody(Buffer.from(JSON.stringify({ c: 3 }), "utf-8"));
  assert(JSON.stringify(fromBuf) === JSON.stringify({ c: 3 }), "buffer body parses as JSON");
  let threw = false;
  try {
    parseBody(null);
  } catch {
    threw = true;
  }
  assert(threw, "null body throws");

  console.log("--- validatePayload: rejects bad shapes ---");
  assert(validatePayload(null) !== null, "null payload rejected");
  assert(validatePayload({}) !== null, "empty object rejected");
  assert(
    validatePayload({ ...validPayload, inputMode: "wrong" }) !== null,
    "bad inputMode rejected",
  );
  assert(
    validatePayload({ ...validPayload, textStyleStrength: "extreme" }) !== null,
    "bad strength rejected",
  );
  assert(validatePayload(validPayload) === null, "valid payload passes");

  // ------------------------------------------------------------------
  // Branch: missing ZHIPU_API_KEY → 503 + structured JSON.
  // This is the exact production regression we are guarding against.
  // ------------------------------------------------------------------
  console.log("--- handler: missing ZHIPU_API_KEY returns 503 JSON ---");
  const savedKey = process.env.ZHIPU_API_KEY;
  delete process.env.ZHIPU_API_KEY;
  try {
    const res = mockRes();
    await handler(mockReq({ body: validPayload }), res);
    assert(res.statusCode === 503, `expected 503, got ${res.statusCode}`);
    assert(typeof res.body?.error === "string", "error field must be a string");
    assert(
      /AI 生成服务未配置/.test(res.body.error),
      "503 message must include 'AI 生成服务未配置' so the UI matches it",
    );
    assert(
      /ZHIPU_API_KEY/.test(res.body.error),
      "503 message must mention ZHIPU_API_KEY for operator guidance",
    );
    assert(
      (res.headers["content-type"] || "").toLowerCase().includes("application/json"),
      "Content-Type must be application/json on the 503 path",
    );
    assert(res.headers["cache-control"] === "no-store", "Cache-Control must be no-store");
  } finally {
    if (savedKey !== undefined) process.env.ZHIPU_API_KEY = savedKey;
  }

  // ------------------------------------------------------------------
  // Branch: non-POST → 405. Must NOT depend on the API key being set.
  // ------------------------------------------------------------------
  console.log("--- handler: GET returns 405 even without ZHIPU_API_KEY ---");
  {
    const saved = process.env.ZHIPU_API_KEY;
    delete process.env.ZHIPU_API_KEY;
    try {
      const res = mockRes();
      await handler(mockReq({ method: "GET" }), res);
      assert(res.statusCode === 405, `expected 405, got ${res.statusCode}`);
      assert(typeof res.body?.error === "string", "error field must be a string");
    } finally {
      if (saved !== undefined) process.env.ZHIPU_API_KEY = saved;
    }
  }

  // ------------------------------------------------------------------
  // Branch: OPTIONS preflight → 204 with CORS headers echoed for an
  // allowed origin (GitHub Pages static frontend).
  // ------------------------------------------------------------------
  console.log("--- handler: OPTIONS returns 204 with CORS headers ---");
  {
    const res = mockRes();
    await handler(
      mockReq({
        method: "OPTIONS",
        headers: {
          "content-type": "application/json",
          origin: "https://harryyan2001.github.io",
        },
      }),
      res,
    );
    assert(res.statusCode === 204, `expected 204, got ${res.statusCode}`);
    assert(
      res.headers["access-control-allow-origin"] === "https://harryyan2001.github.io",
      `OPTIONS must echo GitHub Pages origin, got ${res.headers["access-control-allow-origin"]}`,
    );
    assert(
      (res.headers["access-control-allow-methods"] || "").includes("POST"),
      "OPTIONS must advertise POST in Allow-Methods",
    );
    assert(
      (res.headers["access-control-allow-headers"] || "")
        .toLowerCase()
        .includes("content-type"),
      "OPTIONS must allow Content-Type header",
    );
    assert(
      (res.headers["vary"] || "").toLowerCase().includes("origin"),
      "OPTIONS must set Vary: Origin so caches don't mix responses across origins",
    );
  }

  // ------------------------------------------------------------------
  // Branch: OPTIONS preflight from a DISALLOWED origin → still 204 but
  // no Allow-Origin header echoed. Same-origin Vercel + Browser fallback
  // path must keep working.
  // ------------------------------------------------------------------
  console.log("--- handler: OPTIONS from disallowed origin does NOT echo Allow-Origin ---");
  {
    const res = mockRes();
    await handler(
      mockReq({
        method: "OPTIONS",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.com",
        },
      }),
      res,
    );
    assert(res.statusCode === 204, `expected 204, got ${res.statusCode}`);
    assert(
      !res.headers["access-control-allow-origin"],
      `disallowed origin must not be echoed, got ${res.headers["access-control-allow-origin"]}`,
    );
  }

  // ------------------------------------------------------------------
  // Pure helper coverage: allowlist + origin resolution.
  // ------------------------------------------------------------------
  console.log("--- CORS allowlist helpers ---");
  assert(
    DEFAULT_ALLOWED_ORIGINS.includes("https://harryyan2001.github.io"),
    "GitHub Pages origin must be in DEFAULT_ALLOWED_ORIGINS",
  );
  assert(
    DEFAULT_ALLOWED_ORIGINS.includes("https://notestay.vercel.app"),
    "Vercel origin must be in DEFAULT_ALLOWED_ORIGINS for explicit cross-origin",
  );
  assert(
    buildAllowedOrigins({ extra: "https://staging.example.com" }).includes(
      "https://staging.example.com",
    ),
    "env-provided extra origins must be merged in",
  );
  assert(
    resolveAllowedOrigin("https://harryyan2001.github.io", DEFAULT_ALLOWED_ORIGINS) ===
      "https://harryyan2001.github.io",
    "GitHub Pages origin must resolve",
  );
  assert(
    resolveAllowedOrigin("https://evil.example.com", DEFAULT_ALLOWED_ORIGINS) === null,
    "unknown origin must NOT resolve",
  );
  assert(
    resolveAllowedOrigin(undefined, DEFAULT_ALLOWED_ORIGINS) === null,
    "missing origin must resolve to null (same-origin path)",
  );

  // ------------------------------------------------------------------
  // Branch: empty body with key set → 400.
  // ------------------------------------------------------------------
  console.log("--- handler: empty body returns 400 ---");
  process.env.ZHIPU_API_KEY = "dummy-key-for-test";
  try {
    const res = mockRes();
    await handler(mockReq({ body: null }), res);
    assert(res.statusCode === 400, `expected 400, got ${res.statusCode}`);
    assert(/请求体/.test(res.body?.error || ""), "400 must mention 请求体");
  } finally {
    delete process.env.ZHIPU_API_KEY;
  }

  // ------------------------------------------------------------------
  // Branch: invalid payload shape → 400.
  // ------------------------------------------------------------------
  console.log("--- handler: invalid payload returns 400 ---");
  process.env.ZHIPU_API_KEY = "dummy-key-for-test";
  try {
    const res = mockRes();
    await handler(mockReq({ body: { inputMode: "garbage" } }), res);
    assert(res.statusCode === 400, `expected 400, got ${res.statusCode}`);
    assert(/inputMode/.test(res.body?.error || ""), "400 must explain inputMode");
  } finally {
    delete process.env.ZHIPU_API_KEY;
  }

  // ------------------------------------------------------------------
  // Branch: string body (raw JSON) → parsed and reaches Zhipu call.
  // We stub globalThis.fetch so no real network is hit.
  // ------------------------------------------------------------------
  console.log("--- handler: string body is parsed; fetch stub yields 200 ---");
  const originalFetch = globalThis.fetch;
  process.env.ZHIPU_API_KEY = "dummy-key-for-test";
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "标题",
                  altTitles: ["备 1"],
                  body: "正文。\n\n📍 位置\n市中心。",
                  hashtags: ["#上海酒店", "#测试酒店", "#酒店测评"],
                  commentGuide: ["问 1"],
                  warnings: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as any;
    const res = mockRes();
    await handler(mockReq({ body: JSON.stringify(validPayload) }), res);
    assert(res.statusCode === 200, `expected 200, got ${res.statusCode} (body: ${JSON.stringify(res.body)})`);
    assert(res.body?.title === "标题", "title roundtrips");
    assert(Array.isArray(res.body?.hashtags), "hashtags is array");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ZHIPU_API_KEY;
  }

  // ------------------------------------------------------------------
  // Branch: Zhipu returns non-2xx → 502 with Chinese error message.
  // ------------------------------------------------------------------
  console.log("--- handler: upstream 401 surfaces as 502 JSON, not a crash ---");
  process.env.ZHIPU_API_KEY = "dummy-key-for-test";
  try {
    globalThis.fetch = (async () =>
      new Response("invalid api key", { status: 401 })) as any;
    const res = mockRes();
    await handler(mockReq({ body: validPayload }), res);
    assert(res.statusCode === 502, `expected 502, got ${res.statusCode}`);
    assert(/调用智谱 AI 失败/.test(res.body?.error || ""), "502 must include Chinese error prefix");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ZHIPU_API_KEY;
  }

  // ------------------------------------------------------------------
  // Branch: upstream Zhipu call aborts (timeout). The handler must
  // surface this as a 504 with a Chinese "AI 模型响应超时" prefix so the
  // UI can show an actionable message — NOT a 502 lumped in with auth
  // failures, and NOT a bare crash.
  // ------------------------------------------------------------------
  console.log("--- handler: upstream timeout/abort surfaces as 504 JSON ---");
  process.env.ZHIPU_API_KEY = "dummy-key-for-test";
  try {
    // Simulate the abort path: fetch immediately rejects with the same
    // shape modern runtimes use when AbortController.abort() fires.
    // callZhipu must recognise this and rephrase as "Zhipu API 调用超时",
    // which the handler must then map to a 504 with the Chinese
    // "AI 模型响应超时" prefix the UI shows to the user.
    globalThis.fetch = (async () => {
      const err: any = new Error("signal is aborted without reason");
      err.name = "AbortError";
      throw err;
    }) as any;
    const res = mockRes();
    await handler(mockReq({ body: validPayload }), res);
    assert(res.statusCode === 504, `expected 504 on abort, got ${res.statusCode}`);
    assert(
      /AI 模型响应超时/.test(res.body?.error || ""),
      `504 must include 'AI 模型响应超时', got: ${res.body?.error}`,
    );
    assert(
      !/signal is aborted/i.test(res.body?.error || ""),
      "raw 'signal is aborted' must NOT leak into the error message",
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ZHIPU_API_KEY;
  }

  // ------------------------------------------------------------------
  // extractZhipuContent: accept every upstream shape we know about, and
  // explicitly fail on a shape with no content at all.
  // ------------------------------------------------------------------
  console.log("--- extractZhipuContent: canonical message.content string ---");
  assert(
    extractZhipuContent({
      choices: [{ message: { content: "hello" } }],
    }) === "hello",
    "canonical string content extracted",
  );

  console.log("--- extractZhipuContent: structured content parts (array) ---");
  assert(
    extractZhipuContent({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "{" },
              { type: "text", text: '"title":"x"}' },
            ],
          } as any,
        },
      ],
    }) === '{"title":"x"}',
    "array content parts concatenated",
  );

  console.log("--- extractZhipuContent: reasoning_content fallback ---");
  assert(
    extractZhipuContent({
      choices: [
        {
          message: {
            content: "",
            reasoning_content: '{"title":"y"}',
          } as any,
        },
      ],
    }) === '{"title":"y"}',
    "reasoning_content used when content empty",
  );

  console.log("--- extractZhipuContent: tool_calls arguments ---");
  assert(
    extractZhipuContent({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                function: { name: "respond", arguments: '{"title":"z"}' },
              },
            ],
          } as any,
        },
      ],
    }) === '{"title":"z"}',
    "tool_call arguments used when content null",
  );

  console.log("--- extractZhipuContent: streaming delta.content fallback ---");
  assert(
    extractZhipuContent({
      choices: [{ delta: { content: "streamed" } } as any],
    }) === "streamed",
    "delta.content used when message missing",
  );

  console.log("--- extractZhipuContent: legacy text completion ---");
  assert(
    extractZhipuContent({
      choices: [{ text: "legacy" } as any],
    }) === "legacy",
    "legacy choices[0].text used as last resort",
  );

  console.log("--- extractZhipuContent: truly empty payload → null ---");
  assert(extractZhipuContent({} as any) === null, "no choices → null");
  assert(
    extractZhipuContent({ choices: [{ message: { content: "" } }] }) === null,
    "empty-string content → null (so handler raises diagnostic)",
  );

  // ------------------------------------------------------------------
  // Branch: handler must succeed when upstream uses the tool_calls shape
  // (the shape that GitHub Pages users were intermittently hitting). This
  // is the regression PR #34 fixes — before, this returned a 502 with
  // "Zhipu API 返回中没有可用的 message.content".
  // ------------------------------------------------------------------
  console.log("--- handler: tool_calls upstream shape returns 200 ---");
  process.env.ZHIPU_API_KEY = "dummy-key-for-test";
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    function: {
                      name: "respond",
                      arguments: JSON.stringify({
                        title: "标题 via tool_call",
                        altTitles: ["备 1"],
                        body: "正文。\n\n📍 位置\n市中心。",
                        hashtags: ["#上海酒店"],
                        commentGuide: ["问 1"],
                        warnings: [],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as any;
    const res = mockRes();
    await handler(mockReq({ body: validPayload }), res);
    assert(
      res.statusCode === 200,
      `tool_calls shape must succeed (got ${res.statusCode}: ${JSON.stringify(res.body)})`,
    );
    assert(res.body?.title === "标题 via tool_call", "title roundtrips from tool_call args");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ZHIPU_API_KEY;
  }

  // ------------------------------------------------------------------
  // Branch: truly empty upstream content → 502 with a diagnostic blob
  // that lists the keys we saw (but NEVER leaks the API key / request).
  // ------------------------------------------------------------------
  console.log("--- handler: empty content payload returns diagnostic 502 ---");
  process.env.ZHIPU_API_KEY = "dummy-key-for-test";
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "abc",
          choices: [{ finish_reason: "length", message: { content: "" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as any;
    const res = mockRes();
    await handler(mockReq({ body: validPayload }), res);
    assert(res.statusCode === 502, `empty content must be 502, got ${res.statusCode}`);
    const err = String(res.body?.error || "");
    assert(/没有可用的 message\.content/.test(err), "error message preserved");
    assert(/诊断/.test(err), "diagnostic blob included");
    assert(/finishReason/.test(err), "finishReason included in diagnostic");
    assert(!/dummy-key-for-test/.test(err), "API key MUST NOT leak into error");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ZHIPU_API_KEY;
  }

  console.log("API handler smoke tests OK");
}

run().catch((err) => {
  console.error("API handler smoke tests FAILED:", err);
  process.exit(1);
});
