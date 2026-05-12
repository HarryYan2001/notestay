// Smoke test for client/src/lib/generate.ts copy generation.
// Runs without a browser via tsx. Exits non-zero on assertion failure.
import { generateNote } from "../client/src/lib/generate";
import type { AppInputState } from "../client/src/lib/types";

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
    ...overrides,
  };
}

const BANNED = ["不得不说", "总体而言", "综合来说", "性价比之选", "性价比天花板", "宝藏酒店"];
const FIXED_REMOVED = ["🤍 总结一句话", "📸 这篇笔记的图片均为本人入住实拍"];

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function countCjk(text: string): number {
  let n = 0;
  for (const ch of text) if (/[一-鿿]/.test(ch)) n++;
  return n;
}

// Case 1: price provided — should render emoji-headed 💰 价格 section, NOT bracketed line.
{
  const note = generateNote(baseInput());
  console.log("--- with price ---");
  console.log(note.body);
  console.log("(cjk chars:", countCjk(note.body), ")");

  assert(!note.body.includes("【价格"), "should not contain old bracketed price line");
  assert(note.body.includes("💰 价格"), "should contain '💰 价格' emoji heading");
  assert(note.body.includes("888/晚"), "should contain user-supplied price value");
  for (const p of BANNED) assert(!note.body.includes(p), `body must not contain banned phrase: ${p}`);
  for (const p of FIXED_REMOVED) assert(!note.body.includes(p), `body must not contain removed fixed line: ${p}`);
  assert(countCjk(note.body) <= 600, "body must be <= 600 CJK chars");
  assert(note.tags.length >= 3 && note.tags.length <= 5, "should have 3-5 hashtags");
}

// Case 2: no price — should NOT include a price section at all.
{
  const input = baseInput();
  input.hotel.price = "";
  const note = generateNote(input);
  console.log("--- without price ---");
  console.log(note.body);
  console.log("(cjk chars:", countCjk(note.body), ")");

  assert(!note.body.includes("💰"), "without price, body must not include 💰");
  assert(!note.body.includes("价格"), "without price, body must not include '价格' heading");
  assert(!note.body.includes("【价格"), "without price, body must not include old bracketed price line");
  for (const p of BANNED) assert(!note.body.includes(p), `body must not contain banned phrase: ${p}`);
  assert(countCjk(note.body) <= 600, "body must be <= 600 CJK chars");
}

// Case 3: freeform mode with price.
{
  const note = generateNote(
    baseInput({
      inputMode: "freeform",
      framework: [],
      freeText:
        "酒店离地铁很近。房间很安静，床品柔软。早餐有现做鸡蛋和咖啡，水果也新鲜。前台态度很好。",
    }),
  );
  console.log("--- freeform with price ---");
  console.log(note.body);
  assert(note.body.includes("💰 价格"), "freeform: should contain '💰 价格' heading");
  assert(!note.body.includes("【价格"), "freeform: must not contain old bracketed price line");
}

console.log("\nOK: all copy smoke assertions passed.");
