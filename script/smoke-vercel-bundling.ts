// Smoke test that emulates how Vercel imports api/*.ts at function-init time
// and verifies the missing-ZHIPU_API_KEY path NEVER depends on the shared
// module. This is the regression we're guarding against: if importing
// `../shared/ai-prompt` ever crashes (bundling glitch, ESM resolution
// failure, syntax error introduced by a future commit), the production
// endpoint should still return the structured 503 JSON the UI knows how to
// render, NOT Vercel's generic FUNCTION_INVOCATION_FAILED page.
//
// Strategy:
//   1. Stub the shared module via Node's --import loader BEFORE importing
//      the handler. The stub throws on access, simulating a bundling
//      failure of shared/ai-prompt.ts.
//   2. Invoke the handler with no ZHIPU_API_KEY in the environment.
//   3. Assert: the handler returns 503 + structured JSON.
//   4. Invoke the handler WITH a key but a valid payload. Now the dynamic
//      import will run and fail; we expect a structured 500 JSON (not a
//      crash). This proves the dynamic-import try/catch works.
//
// This test does NOT need any network or real API key.

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

// Child script: import the handler, invoke it twice, print JSON results.
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
  inputMode: "framework",
  framework: [{ label: "位置", value: "市中心。" }],
  freeText: "",
  hotel: { name: "测试酒店", brand: "", city: "上海", price: "", roomType: "", stayDate: "" },
  images: { totalCount: 0, categories: [] },
  styleKey: "korean_cream",
  styleName: "韩系奶油",
  styleTone: "soft",
  textStyleStrength: "medium",
  screenshotStyle: null,
};

async function main() {
  // Case 1: no key set — must return 503 even with no further setup.
  delete process.env.ZHIPU_API_KEY;
  const r1 = mockRes();
  await handler(mockReq({ body: validPayload }), r1);
  console.log("CASE1:" + JSON.stringify({ status: r1.statusCode, body: r1.body, ct: r1.headers["content-type"] }));

  // Case 2: key set, valid payload, but shared module is fine — would
  // attempt network. We stub fetch to a failure so the route returns 502.
  process.env.ZHIPU_API_KEY = "dummy";
  globalThis.fetch = async () => new Response("err", { status: 500 });
  const r2 = mockRes();
  await handler(mockReq({ body: validPayload }), r2);
  console.log("CASE2:" + JSON.stringify({ status: r2.statusCode, hasError: typeof r2.body?.error === "string" }));
}

main().catch((err) => {
  console.error("CHILD_FAIL:" + (err && err.message ? err.message : String(err)));
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
  const case1Line = stdout.split("\n").find((l) => l.startsWith("CASE1:"));
  const case2Line = stdout.split("\n").find((l) => l.startsWith("CASE2:"));
  if (!case1Line || !case2Line) {
    console.error("Missing case output");
    console.error(stdout);
    process.exit(1);
  }

  const case1 = JSON.parse(case1Line.slice("CASE1:".length));
  const case2 = JSON.parse(case2Line.slice("CASE2:".length));

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

  if (case2.status !== 502) {
    console.error("FAIL: case2 expected 502, got", case2.status);
    process.exit(1);
  }
  if (!case2.hasError) {
    console.error("FAIL: case2 missing error field");
    process.exit(1);
  }

  console.log("Vercel bundling smoke OK (fresh process, no ZHIPU_API_KEY → 503 JSON; upstream failure → 502 JSON)");
} finally {
  try {
    unlinkSync(childFile);
  } catch {
    /* ignore */
  }
}
