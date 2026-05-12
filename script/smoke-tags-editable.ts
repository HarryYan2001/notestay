// Smoke test for editable topic-tags block on the result page.
// Asserts:
//   1) generate.ts defaults to exactly 3 hashtags
//   2) result.tsx wires an input, add button, and per-tag delete buttons
//      via the documented data-testid contract and updates app state on edit
//   3) phone-preview.tsx still renders from note.tags (live-sync path)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateNote } from "../client/src/lib/generate";
import type { AppInputState } from "../client/src/lib/types";

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
    ...overrides,
  };
}

// 1) Default tag count is exactly 3, all formatted with leading '#'.
{
  const note = generateNote(baseInput());
  assert(note.tags.length === 3, `expected exactly 3 default tags, got ${note.tags.length}: ${JSON.stringify(note.tags)}`);
  for (const t of note.tags) {
    assert(typeof t === "string" && t.startsWith("#"), `tag '${t}' must start with '#'`);
    assert(t.length > 1, `tag '${t}' must have content after '#'`);
  }
  // No duplicates.
  assert(new Set(note.tags).size === note.tags.length, "tags must be unique");
}

// 2) Even with no city / no hotel name, still produces exactly 3 tags from
//    the static fallback set.
{
  const note = generateNote(
    baseInput({
      hotel: { name: "", brand: "", city: "", price: "", roomType: "", stayDate: "" },
    }),
  );
  assert(note.tags.length === 3, `bare input should still yield 3 tags, got ${note.tags.length}`);
  for (const t of note.tags) assert(t.startsWith("#"), `tag '${t}' must start with '#'`);
}

// 3) result.tsx wires the editable tag UI.
const resultPath = join(import.meta.dirname, "..", "client", "src", "pages", "result.tsx");
const resultSrc = readFileSync(resultPath, "utf-8");

assert(
  resultSrc.includes('data-testid="input-add-tag"'),
  "result.tsx must expose data-testid='input-add-tag' for the new-tag input",
);
assert(
  resultSrc.includes('data-testid="button-add-tag"'),
  "result.tsx must expose data-testid='button-add-tag' for the add button",
);
assert(
  resultSrc.includes('data-testid={`button-delete-tag-${t}`}'),
  "result.tsx must render a per-tag delete button with data-testid='button-delete-tag-<tag>'",
);
assert(
  resultSrc.includes('data-testid={`tag-chip-${t}`}'),
  "result.tsx must render a per-tag chip with data-testid='tag-chip-<tag>'",
);
// Wiring: add/remove helpers must call updateNote with the tags patch so app
// state (and therefore the phone preview) updates live.
assert(
  /function\s+addTag\s*\(/.test(resultSrc) && /function\s+removeTag\s*\(/.test(resultSrc),
  "result.tsx must define addTag and removeTag handlers",
);
assert(
  /updateNote\(\{\s*tags:/.test(resultSrc),
  "tag handlers must update state via updateNote({ tags: ... }) to drive the phone preview",
);
// Tag input should not depend on localStorage / sessionStorage / cookies.
assert(
  !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(resultSrc),
  "result.tsx must not introduce browser-storage usage for tag editing",
);

// 4) phone-preview still reads from note.tags so edits propagate live.
const previewPath = join(import.meta.dirname, "..", "client", "src", "components", "phone-preview.tsx");
const previewSrc = readFileSync(previewPath, "utf-8");
assert(
  /note\.tags\.map/.test(previewSrc),
  "phone-preview.tsx must render note.tags so edits live-sync to the phone view",
);

console.log("OK: editable topic-tags smoke assertions passed.");
