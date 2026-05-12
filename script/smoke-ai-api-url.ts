// Smoke test for the AI API URL resolver in client/src/lib/ai-generate.ts.
//
// Goal: lock down the rule that decides where the static frontend POSTs
// `/api/generate-note` requests, so the GitHub Pages build keeps reaching
// the Vercel-hosted serverless function and the Vercel build keeps using a
// same-origin relative path.
//
// Covered:
//   - GitHub Pages host (*.github.io) → absolute Vercel URL
//   - Vercel / custom host → same-origin relative "/api/generate-note"
//   - empty / unknown host → same-origin relative
//   - VITE_AI_API_BASE_URL override (with or without /api/generate-note suffix)
//   - canonical Vercel URL exported for fork visibility

import {
  resolveAiApiUrl,
  DEFAULT_VERCEL_AI_API_URL,
} from "../client/src/lib/ai-generate";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

console.log("--- resolveAiApiUrl: GitHub Pages host → Vercel URL ---");
assert(
  resolveAiApiUrl({ hostname: "harryyan2001.github.io" }) === DEFAULT_VERCEL_AI_API_URL,
  `GitHub Pages host must resolve to the canonical Vercel URL, got ${resolveAiApiUrl({ hostname: "harryyan2001.github.io" })}`,
);
assert(
  resolveAiApiUrl({ hostname: "anything.github.io" }) === DEFAULT_VERCEL_AI_API_URL,
  "Any *.github.io host must resolve to the canonical Vercel URL",
);
assert(
  /^https:\/\/notestay\.vercel\.app\/api\/generate-note$/.test(DEFAULT_VERCEL_AI_API_URL),
  `DEFAULT_VERCEL_AI_API_URL must point at the Vercel deployment, got ${DEFAULT_VERCEL_AI_API_URL}`,
);

console.log("--- resolveAiApiUrl: Vercel / other host → relative ---");
assert(
  resolveAiApiUrl({ hostname: "notestay.vercel.app" }) === "/api/generate-note",
  "Vercel host must use same-origin relative path",
);
assert(
  resolveAiApiUrl({ hostname: "localhost" }) === "/api/generate-note",
  "localhost must use same-origin relative path",
);
assert(
  resolveAiApiUrl({}) === "/api/generate-note",
  "empty env must use same-origin relative path",
);

console.log("--- resolveAiApiUrl: VITE_AI_API_BASE_URL override ---");
assert(
  resolveAiApiUrl({
    hostname: "harryyan2001.github.io",
    buildOverride: "https://staging.example.com",
  }) === "https://staging.example.com/api/generate-note",
  "bare base override must append /api/generate-note",
);
assert(
  resolveAiApiUrl({
    hostname: "harryyan2001.github.io",
    buildOverride: "https://staging.example.com/api/generate-note",
  }) === "https://staging.example.com/api/generate-note",
  "override with full path must be preserved",
);
assert(
  resolveAiApiUrl({
    hostname: "harryyan2001.github.io",
    buildOverride: "https://staging.example.com/",
  }) === "https://staging.example.com/api/generate-note",
  "trailing-slash override must be normalised",
);
assert(
  resolveAiApiUrl({
    hostname: "harryyan2001.github.io",
    buildOverride: "   ",
  }) === DEFAULT_VERCEL_AI_API_URL,
  "blank override must fall through to GitHub Pages rule",
);

console.log("AI API URL resolver smoke OK");
