// Smoke test for shared/ai-prompt.ts and client/src/lib/ai-generate.ts.
// Verifies:
//   - prompt construction includes user-supplied hotel facts + framework
//     content + OCR-style profile, and clearly fences reference style as
//     METHOD-only with explicit forbidden-fact language.
//   - parseModelOutput handles strict JSON, fenced JSON, and rejects bad
//     payloads.
//   - buildAiRequest / mergeAiResponse pass the right shape and merge AI
//     text on top of the deterministic visual scaffold.
//   - generateNoteWithAi short-circuits to AiNotConfiguredError on 503 and
//     succeeds on a mocked 200 — never hits a real Zhipu key.

import {
  buildSystemPrompt,
  buildUserPrompt,
  parseModelOutput,
  extractFirstJsonObject,
  type AiGenerateRequest,
} from "../shared/ai-prompt";
import {
  buildAiRequest,
  mergeAiResponse,
  generateNoteWithAi,
  AiNotConfiguredError,
  FRONTEND_AI_TIMEOUT_MS,
  isAbortError,
  needsApiCall,
  API_FAILURE_FALLBACK_PREFIX,
} from "../client/src/lib/ai-generate";
import { generateNote } from "../client/src/lib/generate";
import type { AppInputState, ScreenshotRef } from "../client/src/lib/types";

// A baseline reference-note screenshot OCR profile that turns ON the API
// path. Tests that exercise the upstream Zhipu flow use this so the local
// fallback short-circuit doesn't bypass the fetch call.
function styleScreenshotRef(): ScreenshotRef {
  return {
    previewUrl: null,
    filename: "ref.png",
    textStyle: {
      hasText: true,
      charCount: 220,
      cjkCount: 200,
      tone: "dramatic",
      cues: ["heavy_emoji", "exclamation_burst", "cta_collect"],
      detectedEmoji: ["✨", "🥺", "💖"],
      punctIntensity: 0.45,
      avgSentenceLen: 14,
      hashtagCount: 5,
      status: "ok",
      previewText: "（OCR preview text — should NOT leak into prompt）",
    },
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function baseInput(overrides: Partial<AppInputState> = {}): AppInputState {
  return {
    inputMode: "framework",
    framework: [
      { id: "f1", label: "位置", value: "酒店在市中心，步行就能到地铁站，逛街很方便。" },
      { id: "f2", label: "房间", value: "推开门是落地窗，床品柔软，洗手间干湿分离很舒服。" },
      { id: "f3", label: "早餐", value: "现做的鸡蛋很香，咖啡也不错，水果新鲜。" },
    ],
    freeText: "",
    hotel: {
      name: "测试酒店",
      brand: "测试品牌",
      city: "上海",
      price: "888/晚",
      roomType: "豪华大床房",
      stayDate: "周末两晚",
    },
    images: [],
    style: "korean_cream",
    viralRef: "",
    viralRefNotes: "",
    screenshotRef: null,
    textStyleStrength: "medium",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Case 1: prompt construction includes user facts and material.
// ---------------------------------------------------------------------------
{
  console.log("--- prompt: framework mode with hotel + material ---");
  const req = buildAiRequest(baseInput());
  const sys = buildSystemPrompt();
  const user = buildUserPrompt(req);

  // System prompt must lock in guardrails about not inventing facts.
  assert(/不得|严禁|禁止|不可以/.test(sys), "system prompt must include hard guardrails");
  assert(sys.includes("性价比之选") || sys.includes("不得不说"), "system prompt must enumerate banned phrases");
  assert(sys.includes("JSON"), "system prompt must require JSON output");

  // User prompt must include hotel + framework values verbatim.
  assert(user.includes("测试酒店"), "user prompt must include hotel name");
  assert(user.includes("888/晚"), "user prompt must include user-supplied price");
  assert(user.includes("上海"), "user prompt must include city");
  assert(user.includes("酒店在市中心，步行就能到地铁站，逛街很方便。"), "framework value must be present");
  assert(user.includes("床品柔软"), "framework value 2 must be present");
  assert(user.includes("现做的鸡蛋很香"), "framework value 3 must be present");
  assert(/参考笔记 OCR 风格/.test(user), "user prompt must label reference profile as OCR style");
}

// ---------------------------------------------------------------------------
// Case 2: missing fields are clearly marked as forbidden to invent.
// ---------------------------------------------------------------------------
{
  console.log("--- prompt: missing price / city explicitly forbidden ---");
  const input = baseInput();
  input.hotel.price = "";
  input.hotel.city = "";
  input.hotel.name = "";
  const req = buildAiRequest(input);
  const user = buildUserPrompt(req);

  assert(/价格[\s\S]*未提供[\s\S]*不得出现/.test(user), "missing price must be marked forbidden");
  assert(/城市[\s\S]*未提供[\s\S]*不得添加/.test(user), "missing city must be marked forbidden");
  assert(/酒店名称[\s\S]*未提供/.test(user), "missing hotel name must be flagged");
}

// ---------------------------------------------------------------------------
// Case 3: OCR style profile is fenced as METHOD only with forbid-copy warning.
// ---------------------------------------------------------------------------
{
  console.log("--- prompt: OCR reference style passed as method-only ---");
  const input = baseInput({
    screenshotRef: {
      previewUrl: null,
      filename: "ref.png",
      textStyle: {
        hasText: true,
        charCount: 220,
        cjkCount: 200,
        tone: "dramatic",
        cues: ["heavy_emoji", "exclamation_burst", "cta_collect"],
        detectedEmoji: ["✨", "🥺", "💖"],
        punctIntensity: 0.45,
        avgSentenceLen: 14,
        hashtagCount: 5,
        status: "ok",
        previewText: "（OCR preview text — should NOT leak into prompt）",
      },
    },
  });
  const req = buildAiRequest(input);
  const user = buildUserPrompt(req);

  assert(user.includes("dramatic"), "OCR tone must be included");
  assert(/高频 emoji|重复感叹|收藏号召/.test(user), "OCR cue labels must be included");
  assert(user.includes("✨"), "OCR detected emoji must be included");
  assert(/严禁直接搬运|严禁照抄/.test(user) || /绝对禁止/.test(user), "must explicitly forbid copying reference content");
  assert(!user.includes("（OCR preview text"), "OCR preview text must NOT leak into prompt");
}

// ---------------------------------------------------------------------------
// Case 4: strength materially changes the prompt instruction.
// ---------------------------------------------------------------------------
{
  console.log("--- prompt: strength affects instruction body ---");
  const light = buildUserPrompt(buildAiRequest(baseInput({ textStyleStrength: "light" })));
  const high = buildUserPrompt(buildAiRequest(baseInput({ textStyleStrength: "high" })));
  assert(light !== high, "light and high prompts must differ");
  assert(light.includes("轻度模仿"), "light strength must include 轻度模仿 instruction");
  assert(high.includes("高强度模仿"), "high strength must include 高强度模仿 instruction");
}

// ---------------------------------------------------------------------------
// Case 5: freeform mode payload uses freeText, framework is empty.
// ---------------------------------------------------------------------------
{
  console.log("--- prompt: freeform mode ---");
  const req = buildAiRequest(
    baseInput({
      inputMode: "freeform",
      framework: [
        { id: "f1", label: "位置", value: "should NOT leak from framework when in freeform" },
      ],
      freeText: "前台很热情，房间安静，早餐种类丰富。",
    }),
  );
  const user = buildUserPrompt(req);
  assert(req.framework.length === 0, "framework must be empty in freeform request");
  assert(req.freeText.includes("前台很热情"), "freeText must be sent");
  assert(!user.includes("should NOT leak"), "framework content must not leak into freeform prompt");
  assert(user.includes("前台很热情"), "freeText must appear in prompt body");
}

// ---------------------------------------------------------------------------
// Case 6: parseModelOutput tolerates fenced JSON and rejects garbage.
// ---------------------------------------------------------------------------
{
  console.log("--- parseModelOutput: strict + fenced ---");
  const good = JSON.stringify({
    title: "🌸 这家酒店真的住到不想退房",
    altTitles: ["温柔治愈系小住", "周末出片清单"],
    body: "真的，住完只想说一句：治愈到想再来一次。\n\n📍 位置\n靠近地铁，步行可达。\n\n💰 价格\n本次入住价格888/晚。",
    hashtags: ["上海酒店", "测试酒店", "酒店测评"],
    commentGuide: ["蹲一个上海姐妹，这家值得冲吗？", "888 这个价位还有什么平替？"],
    warnings: [],
  });
  const parsed1 = parseModelOutput(good);
  assert(parsed1.title.length > 0, "title parsed");
  assert(parsed1.body.includes("📍 位置"), "body parsed");
  assert(parsed1.hashtags.every((h) => h.startsWith("#")), "hashtags normalized with #");
  assert(parsed1.hashtags.length === 3, "hashtags count preserved");

  const fenced = "```json\n" + good + "\n```";
  const parsed2 = parseModelOutput(fenced);
  assert(parsed2.title === parsed1.title, "fenced parses same as strict");

  const prefixedJunk = "好的，这是结果：\n" + good;
  const parsed3 = parseModelOutput(prefixedJunk);
  assert(parsed3.title === parsed1.title, "prose-prefixed JSON still parses");

  // Trailing prose after the JSON object must not pollute the parse.
  const trailingJunk = good + "\n\n以上就是生成结果，请查收。";
  const parsed4 = parseModelOutput(trailingJunk);
  assert(parsed4.title === parsed1.title, "trailing-prose JSON still parses");

  // The specific failure shape from the user's bug report: the model
  // produced reasoning prose like 我需要根据用户提供的… without any JSON.
  // parseModelOutput in strict mode must throw, but in lenient (non-strict)
  // mode must return an empty-shaped response that the client can fall
  // back from instead of hard-crashing.
  let threwOnProse = false;
  try {
    parseModelOutput("我需要根据用户提供的酒店信息，写一篇笔记。");
  } catch {
    threwOnProse = true;
  }
  assert(threwOnProse, "parseModelOutput must throw in strict mode on pure prose");
  const lenient = parseModelOutput(
    "我需要根据用户提供的酒店信息，写一篇笔记。",
    { strict: false },
  );
  assert(
    typeof lenient.title === "string" && typeof lenient.body === "string",
    "parseModelOutput(non-strict) must return a response shape",
  );

  let threw = false;
  try {
    parseModelOutput("not json at all");
  } catch {
    threw = true;
  }
  assert(threw, "parseModelOutput must throw on irrecoverable garbage");

  // extractFirstJsonObject helper coverage — should isolate the first
  // balanced object even when nested braces or string-quoted braces appear.
  assert(
    extractFirstJsonObject('garbage {"a": 1} tail') === '{"a": 1}',
    "extractFirstJsonObject finds simple object",
  );
  assert(
    extractFirstJsonObject('我需要根据用户提供的{"title":"t","body":"b"}然后…') ===
      '{"title":"t","body":"b"}',
    "extractFirstJsonObject works after Chinese preamble (the user-reported bug shape)",
  );
  assert(
    extractFirstJsonObject('{"a":{"b":"}"}}') === '{"a":{"b":"}"}}',
    "extractFirstJsonObject handles nested objects and braces inside strings",
  );
  assert(extractFirstJsonObject("no braces here") === null, "no-object returns null");
}

// ---------------------------------------------------------------------------
// Case 7: mergeAiResponse overlays AI text on the deterministic scaffold.
// ---------------------------------------------------------------------------
{
  console.log("--- mergeAiResponse: overlay onto scaffold ---");
  const scaffold = generateNote(baseInput());
  const merged = mergeAiResponse(scaffold, {
    title: "AI 真正生成的标题",
    altTitles: ["备选 1", "备选 2", "备选 3", "备选 4"],
    body: "AI 真正生成的正文。\n\n📍 位置\nAI 写的位置段。",
    hashtags: ["上海酒店", "#已带井号", "测试酒店"],
    commentGuide: ["AI 评论 1", "AI 评论 2"],
    warnings: ["AI 标注的一条 warning"],
  });
  assert(merged.title === "AI 真正生成的标题", "AI title takes precedence");
  assert(merged.originalTitle === merged.title, "originalTitle reset to AI title");
  assert(merged.altTitles.length === 3, "altTitles capped at 3");
  assert(merged.body.startsWith("AI 真正生成的正文"), "AI body used");
  assert(merged.tags.length === 3 && merged.tags.every((t) => t.startsWith("#")), "tags ensured 3 with #");
  assert(merged.commentSeeds[0] === "AI 评论 1", "comment guide replaces seeds");
  assert(merged.pageLayout[0].caption === merged.title, "cover caption mirrors AI title");
  // scaffold-side warnings preserved + AI warnings appended/deduped
  assert(merged.warnings.includes("AI 标注的一条 warning"), "AI warning kept");
}

// ---------------------------------------------------------------------------
// Case 8: generateNoteWithAi end-to-end with mocked fetch (success path).
// ---------------------------------------------------------------------------
async function runFetchMocks() {
  console.log("--- generateNoteWithAi: mocked 200 ---");
  let capturedUrl: string | null = null;
  let capturedBody: any = null;
  const mockOk: typeof fetch = async (url: any, init?: any) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        title: "AI 标题",
        altTitles: ["alt1"],
        body: "AI body\n\n📍 位置\n写的位置。",
        hashtags: ["上海酒店", "测试酒店", "酒店测评"],
        commentGuide: ["问 1"],
        warnings: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  // The 200 path needs the API to actually be reached — attach a style
  // screenshot so needsApiCall() returns true.
  const apiInput = baseInput({ screenshotRef: styleScreenshotRef() });
  const merged = await generateNoteWithAi(apiInput, {
    fetchImpl: mockOk,
    endpoint: "/api/generate-note",
  });
  assert(capturedUrl?.endsWith("/api/generate-note") ?? false, "client must POST to /api/generate-note");
  assert(capturedBody.inputMode === "framework", "request must carry inputMode");
  assert(capturedBody.hotel.name === "测试酒店", "request must carry hotel name");
  assert(capturedBody.styleKey === "korean_cream", "request must carry styleKey");
  assert(capturedBody.textStyleStrength === "medium", "request must carry strength");
  assert(merged.title === "AI 标题", "merged note uses AI title");

  // -------------------------------------------------------------------
  // Case: with NO style screenshot, the client should never call the API
  // at all and must short-circuit to the local scaffold. This is the
  // "speed" optimisation — hotel/scene photos on their own MUST NOT
  // trigger an API request.
  // -------------------------------------------------------------------
  console.log("--- generateNoteWithAi: no style screenshot → skips API entirely ---");
  let calledFetch = false;
  const trackingFetch: typeof fetch = async () => {
    calledFetch = true;
    return new Response("{}", { status: 200 });
  };
  const local = await generateNoteWithAi(baseInput(), {
    fetchImpl: trackingFetch,
    endpoint: "/api/generate-note",
  });
  assert(!calledFetch, "no-style-screenshot path must NOT call fetch");
  assert(typeof local.title === "string" && local.title.length > 0, "local scaffold must produce a title");
  assert(typeof local.body === "string" && local.body.length > 0, "local scaffold must produce body");
  assert(needsApiCall(baseInput()) === false, "needsApiCall returns false without screenshot");
  assert(needsApiCall(apiInput) === true, "needsApiCall returns true with usable style OCR");

  // Even when the user uploaded normal hotel photos (but no style screenshot),
  // we still must NOT call the API — photos are content, not style references.
  let calledFetch2 = false;
  const trackingFetch2: typeof fetch = async () => {
    calledFetch2 = true;
    return new Response("{}", { status: 200 });
  };
  await generateNoteWithAi(
    baseInput({
      images: [
        { id: "img1", url: "blob:x", name: "lobby.jpg", category: "大堂" },
        { id: "img2", url: "blob:y", name: "room.jpg", category: "房间" },
      ],
    }),
    { fetchImpl: trackingFetch2, endpoint: "/api/generate-note" },
  );
  assert(
    !calledFetch2,
    "uploading hotel photos alone must NOT trigger API call",
  );

  console.log("--- generateNoteWithAi: mocked 503 surfaces AiNotConfiguredError ---");
  const mock503: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "未配置 ZHIPU_API_KEY" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  let saw503Error = false;
  try {
    await generateNoteWithAi(apiInput, { fetchImpl: mock503, endpoint: "/api/generate-note" });
  } catch (err) {
    saw503Error = err instanceof AiNotConfiguredError;
  }
  assert(saw503Error, "503 must throw AiNotConfiguredError");

  console.log("--- generateNoteWithAi: mocked 502 falls back to local generation with warning ---");
  const mock502: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "模型超时" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  const fallback502 = await generateNoteWithAi(apiInput, {
    fetchImpl: mock502,
    endpoint: "/api/generate-note",
  });
  assert(
    typeof fallback502.title === "string" && fallback502.title.length > 0,
    "502 fallback still returns a usable note",
  );
  assert(
    fallback502.warnings.some((w) =>
      w.startsWith(API_FAILURE_FALLBACK_PREFIX) && /模型超时/.test(w),
    ),
    `502 fallback must surface a warning explaining the fallback, got warnings=${JSON.stringify(fallback502.warnings)}`,
  );

  console.log("--- generateNoteWithAi: mocked malformed JSON falls back to local ---");
  const mockBadJson: typeof fetch = async () =>
    new Response("not a json body", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const fallbackBad = await generateNoteWithAi(apiInput, {
    fetchImpl: mockBadJson,
    endpoint: "/api/generate-note",
  });
  assert(
    fallbackBad.warnings.some((w) => w.startsWith(API_FAILURE_FALLBACK_PREFIX)),
    "malformed JSON response must trigger fallback warning",
  );
  assert(
    typeof fallbackBad.body === "string" && fallbackBad.body.length > 0,
    "fallback body must be non-empty",
  );

  // -------------------------------------------------------------------
  // Case: client-side AbortError must surface as a friendly Chinese
  // timeout warning — the local fallback runs and the user is told why.
  // -------------------------------------------------------------------
  console.log("--- generateNoteWithAi: AbortError falls back to local with friendly warning ---");
  const abortingFetch: typeof fetch = async (_url: any, init?: any) => {
    // Wait for the signal to abort, then reject with the same shape
    // modern fetch implementations use.
    const signal: AbortSignal | undefined = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const fail = () => {
        const err: any = new Error("signal is aborted without reason");
        err.name = "AbortError";
        reject(err);
      };
      if (signal?.aborted) return fail();
      signal?.addEventListener("abort", fail, { once: true });
    });
  };
  const fallbackAbort = await generateNoteWithAi(apiInput, {
    fetchImpl: abortingFetch,
    endpoint: "/api/generate-note",
    timeoutMs: 50,
  });
  const abortWarning = fallbackAbort.warnings.find((w) => /AI 生成超时/.test(w));
  assert(abortWarning, `abort must surface 'AI 生成超时' in warnings, got ${JSON.stringify(fallbackAbort.warnings)}`);
  assert(
    !fallbackAbort.warnings.some((w) => /signal is aborted/i.test(w)),
    "raw 'signal is aborted' string must NOT leak to UI",
  );

  // -------------------------------------------------------------------
  // Case: regenerating multiple times with progressively richer user
  // input must never truncate the body — each pass must reflect the
  // current inputs, not a previously shortened output. We simulate the
  // "API fails on regenerate" path so we exercise the fallback, which is
  // the regression the user reported.
  // -------------------------------------------------------------------
  console.log("--- generateNoteWithAi: repeated regenerate preserves current input content ---");
  const failingFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "transient" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  const inputShort = baseInput({ screenshotRef: styleScreenshotRef() });
  const inputRich = baseInput({
    screenshotRef: styleScreenshotRef(),
    framework: [
      { id: "f1", label: "位置", value: "酒店离地铁口走 3 分钟，旁边就是商圈，逛街吃饭很方便。" },
      { id: "f2", label: "房间", value: "推开门是落地窗，能看到江景，床品是丝绒触感，洗手间干湿分离。" },
      { id: "f3", label: "早餐", value: "餐厅自助早餐很丰富，有现做蛋类、咖啡和水果，国风甜点也好吃。" },
      { id: "f4", label: "服务", value: "前台办理 check-in 速度快，礼宾还主动帮忙叫车。" },
    ],
  });
  const r1 = await generateNoteWithAi(inputShort, { fetchImpl: failingFetch, endpoint: "/api/generate-note" });
  const r2 = await generateNoteWithAi(inputRich, { fetchImpl: failingFetch, endpoint: "/api/generate-note" });
  const r3 = await generateNoteWithAi(inputRich, { fetchImpl: failingFetch, endpoint: "/api/generate-note" });
  assert(
    r2.body.length > r1.body.length,
    `richer input must yield longer body (r1=${r1.body.length}, r2=${r2.body.length})`,
  );
  assert(
    r3.body.length >= r2.body.length * 0.9,
    `repeating regenerate with the same rich input must not shrink body (r2=${r2.body.length}, r3=${r3.body.length})`,
  );
  // Each regeneration must reflect the CURRENT inputs, not a previously
  // shortened body. We assert that the framework content the user typed
  // makes it into the regenerated body.
  assert(/地铁口|商圈|逛街/.test(r3.body), "regenerated body must reflect current location input");
  assert(/落地窗|江景|床品/.test(r3.body), "regenerated body must reflect current room input");

  // -------------------------------------------------------------------
  // Case: isAbortError recognises the various shapes browsers / Node use.
  // -------------------------------------------------------------------
  console.log("--- isAbortError recognises AbortError / ABORT_ERR / 'aborted' ---");
  const e1: any = new Error("x");
  e1.name = "AbortError";
  assert(isAbortError(e1), "name === AbortError matches");
  const e2: any = new Error("x");
  e2.code = "ABORT_ERR";
  assert(isAbortError(e2), "code === ABORT_ERR matches");
  assert(
    isAbortError(new Error("signal is aborted without reason")),
    "message containing 'aborted' matches",
  );
  assert(!isAbortError(new Error("some other error")), "unrelated error rejected");
  assert(!isAbortError(null), "null rejected");

  // -------------------------------------------------------------------
  // Case: default frontend timeout is long enough to outlast a Vercel
  // function call (must be larger than the platform's maxDuration so we
  // never abort a request the server would have completed).
  // -------------------------------------------------------------------
  console.log("--- FRONTEND_AI_TIMEOUT_MS must exceed 60s Vercel maxDuration ---");
  assert(
    FRONTEND_AI_TIMEOUT_MS >= 90_000,
    `frontend timeout must be >= 90s, got ${FRONTEND_AI_TIMEOUT_MS}`,
  );

  // -------------------------------------------------------------------
  // Case: payload shape sent by buildAiRequest passes the server's
  // validatePayload check. Catches drift between client and server.
  // -------------------------------------------------------------------
  console.log("--- buildAiRequest output passes server validatePayload ---");
  const { validatePayload } = await import("../api/generate-note");
  const req = buildAiRequest(baseInput());
  const err = validatePayload(req);
  assert(err === null, `buildAiRequest must satisfy server validation, got: ${err}`);
  // Also check the freeform branch.
  const reqFree = buildAiRequest(
    baseInput({ inputMode: "freeform", freeText: "随便写一段" }),
  );
  assert(
    validatePayload(reqFree) === null,
    "freeform buildAiRequest must satisfy server validation",
  );
}

runFetchMocks()
  .then(() => {
    console.log("AI prompt smoke tests OK");
  })
  .catch((err) => {
    console.error("AI prompt smoke tests FAILED:", err);
    process.exit(1);
  });
