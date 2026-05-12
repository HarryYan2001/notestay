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
  // Branch: OPTIONS preflight → 204.
  // ------------------------------------------------------------------
  console.log("--- handler: OPTIONS returns 204 ---");
  {
    const res = mockRes();
    await handler(mockReq({ method: "OPTIONS" }), res);
    assert(res.statusCode === 204, `expected 204, got ${res.statusCode}`);
  }

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

  console.log("API handler smoke tests OK");
}

run().catch((err) => {
  console.error("API handler smoke tests FAILED:", err);
  process.exit(1);
});
