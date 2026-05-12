// Smoke test that emulates how Vercel imports api/*.ts at function-init
// time and exercises the FULL request path — including the configured-key
// branch that actually pulls in the prompt + Zhipu wrapper module. This is
// the regression we are guarding against:
//
//   - Pre-PR #27, a missing key caused a top-level crash → Vercel
//     FUNCTION_INVOCATION_FAILED page (no JSON, hard to surface to user).
//   - PR #28 moved the prompt module to a dynamic `import("../shared/…")`.
//     That defused the cold-start crash, but in production Vercel never
//     bundled the shared file at all, so any request with a valid key hit
//     a "Cannot find module '/var/task/shared/ai-prompt'" 500.
//   - Current fix: the prompt runtime is a sibling file inside `api/`
//     (`api/_ai-prompt.ts`) imported statically. Sibling files are always
//     bundled and static imports are always traced.
//
// We test this by spawning a fresh Node process (no module cache shared
// with the parent runner) for each case. The success cases mock fetch so
// no real Zhipu key or network is required.

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

// Child script: import the handler in a clean process, invoke it across
// every branch we care about, print JSON results.
const childSrc = `
import handler from "${repoRoot}/api/generate-note.ts";

function mockRes() {
  const headers = {};
  const res = {
    statusCode: 0,
    body: undefined,
    headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

function mockReq(opts) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: undefined, ...opts };
}

const validPayload = {
  inputMode: "freeform",
  framework: [],
  freeText: "房间很干净，床很舒服，早餐有咖啡。",
  hotel: { name: "测试酒店", brand: "", city: "上海", price: "", roomType: "", stayDate: "" },
  images: { totalCount: 0, categories: [] },
  styleKey: "xiaohongshu",
  styleName: "小红书爆款",
  styleTone: "playful",
  textStyleStrength: "medium",
  screenshotStyle: null,
};

// A minimal valid Zhipu JSON response — shaped exactly like what BigModel
// returns on a successful chat-completions call.
function mockZhipuOk() {
  return new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            title: "上海这家酒店住一晚刚刚好",
            altTitles: ["蹲一个上海宝藏入住", "上海出差住这家不踩雷"],
            body: "📍 位置\\n市区，方便。\\n\\n🛏️ 房间\\n房间很干净，床很舒服。\\n\\n🍳 早餐\\n早餐有咖啡。",
            hashtags: ["#上海酒店", "#酒店测评", "#旅行住宿"],
            commentGuide: ["你们最近住上海哪家？", "需要房型对比吗？", "蹲一个性价比 tips"],
            warnings: []
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

async function main() {
  // ----------------------------------------------------------------------
  // Case 1: no key set — must return 503 even with no further setup.
  // ----------------------------------------------------------------------
  delete process.env.ZHIPU_API_KEY;
  const r1 = mockRes();
  await handler(mockReq({ body: validPayload }), r1);
  console.log("CASE1:" + JSON.stringify({ status: r1.statusCode, body: r1.body, ct: r1.headers["content-type"] }));

  // ----------------------------------------------------------------------
  // Case 2: key set, valid payload, mocked successful Zhipu response.
  // This is the path that broke in production after PR #28 — the prompt
  // module failed to load and we returned a 500 "Cannot find module".
  // It must now return 200 with a structured AiGenerateResponse.
  // ----------------------------------------------------------------------
  process.env.ZHIPU_API_KEY = "dummy-key-for-test";
  globalThis.fetch = async () => mockZhipuOk();
  const r2 = mockRes();
  await handler(mockReq({ body: validPayload }), r2);
  console.log("CASE2:" + JSON.stringify({
    status: r2.statusCode,
    title: r2.body && r2.body.title,
    hashtagCount: r2.body && Array.isArray(r2.body.hashtags) ? r2.body.hashtags.length : -1,
    hasBody: !!(r2.body && typeof r2.body.body === "string" && r2.body.body.length > 0),
    errorMsg: r2.body && typeof r2.body.error === "string" ? r2.body.error : null,
  }));

  // ----------------------------------------------------------------------
  // Case 3: upstream 502 — Zhipu returns non-2xx. We must surface 502
  // with a structured Chinese error message, not a bare crash.
  // ----------------------------------------------------------------------
  globalThis.fetch = async () => new Response("upstream broke", { status: 502 });
  const r3 = mockRes();
  await handler(mockReq({ body: validPayload }), r3);
  console.log("CASE3:" + JSON.stringify({
    status: r3.statusCode,
    error: r3.body && typeof r3.body.error === "string" ? r3.body.error.slice(0, 80) : null,
  }));

  // ----------------------------------------------------------------------
  // Case 4: upstream timeout / abort — must surface 504 with the Chinese
  // "AI 模型响应超时" prefix the UI shows to the user.
  // ----------------------------------------------------------------------
  globalThis.fetch = async () => {
    const err = new Error("signal is aborted without reason");
    err.name = "AbortError";
    throw err;
  };
  const r4 = mockRes();
  await handler(mockReq({ body: validPayload }), r4);
  console.log("CASE4:" + JSON.stringify({
    status: r4.statusCode,
    error: r4.body && typeof r4.body.error === "string" ? r4.body.error.slice(0, 80) : null,
  }));
}

main().catch((err) => {
  console.error("CHILD_FAIL:" + (err && err.message ? err.message : String(err)));
  console.error(err && err.stack ? err.stack : "");
  process.exit(2);
});
`;

// Write the child file inside the repo's script/ directory so Node can
// resolve the `tsx/esm` loader from the repo's node_modules. The file is
// deleted in the finally block.
const childFile = join(repoRoot, "script", ".smoke-vercel-child.ts");
writeFileSync(childFile, childSrc, "utf-8");

try {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx/esm", childFile],
    {
      cwd: repoRoot,
      env: { ...process.env, ZHIPU_API_KEY: "" },
      encoding: "utf-8",
    },
  );

  if (result.status !== 0) {
    console.error("Child exited", result.status);
    console.error("STDOUT:", result.stdout);
    console.error("STDERR:", result.stderr);
    process.exit(1);
  }

  const stdout = result.stdout || "";
  const lines = stdout.split("\n");
  const find = (prefix: string) => {
    const l = lines.find((x) => x.startsWith(prefix));
    if (!l) {
      console.error(`Missing ${prefix} in child stdout`);
      console.error(stdout);
      process.exit(1);
    }
    return JSON.parse(l!.slice(prefix.length));
  };

  const case1 = find("CASE1:");
  const case2 = find("CASE2:");
  const case3 = find("CASE3:");
  const case4 = find("CASE4:");

  // -- Case 1: missing key returns structured 503 JSON --
  if (case1.status !== 503) {
    console.error("FAIL: case1 expected 503, got", case1.status, case1.body);
    process.exit(1);
  }
  if (typeof case1.body?.error !== "string" || !/AI 生成服务未配置/.test(case1.body.error)) {
    console.error("FAIL: case1 error message missing", case1.body);
    process.exit(1);
  }
  if (!case1.ct || !/application\/json/i.test(case1.ct)) {
    console.error("FAIL: case1 content-type not JSON", case1.ct);
    process.exit(1);
  }

  // -- Case 2: configured-key SUCCESS path — the production regression --
  // The prompt module must load (no "Cannot find module" / 500), the
  // handler must call into it, and a mocked Zhipu response must round-trip
  // back as a 200 with a real AiGenerateResponse shape.
  if (case2.status !== 200) {
    console.error(
      "FAIL: case2 expected 200 (configured-key success path), got",
      case2.status,
      "errorMsg:",
      case2.errorMsg,
    );
    console.error(
      "This is the production regression: api/generate-note must be able " +
      "to load its prompt + Zhipu wrapper module in a fresh Vercel-like " +
      "process when ZHIPU_API_KEY is set.",
    );
    process.exit(1);
  }
  if (typeof case2.title !== "string" || !case2.title) {
    console.error("FAIL: case2 missing title", case2);
    process.exit(1);
  }
  if (!case2.hasBody) {
    console.error("FAIL: case2 missing body", case2);
    process.exit(1);
  }
  if (case2.hashtagCount < 1) {
    console.error("FAIL: case2 hashtags not populated", case2);
    process.exit(1);
  }

  // -- Case 3: upstream non-2xx surfaces as structured 502 --
  if (case3.status !== 502) {
    console.error("FAIL: case3 expected 502, got", case3.status);
    process.exit(1);
  }
  if (!case3.error || !/调用智谱 AI 失败/.test(case3.error)) {
    console.error("FAIL: case3 missing Chinese error prefix", case3);
    process.exit(1);
  }

  // -- Case 4: upstream abort / timeout surfaces as structured 504 --
  if (case4.status !== 504) {
    console.error("FAIL: case4 expected 504 on abort, got", case4.status);
    process.exit(1);
  }
  if (!case4.error || !/AI 模型响应超时/.test(case4.error)) {
    console.error("FAIL: case4 missing 'AI 模型响应超时'", case4);
    process.exit(1);
  }

  console.log(
    "Vercel bundling smoke OK (fresh process: missing-key → 503 JSON; " +
    "configured-key + mocked Zhipu → 200 structured response; " +
    "upstream 5xx → 502 JSON; abort/timeout → 504 JSON)",
  );
} finally {
  try {
    unlinkSync(childFile);
  } catch {
    /* ignore */
  }
}
