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

// Case 4: framework mode with a custom dimension label (露台) — should become
// its own emoji-headed section, not be folded into 记一笔.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "露台", value: "二楼带一个小露台，傍晚坐在那儿喝杯酒太舒服。" },
        { id: "f2", label: "房间", value: "床很大，灯光也调得刚好。" },
      ],
    }),
  );
  console.log("--- framework custom label 露台 ---");
  console.log(note.body);
  assert(note.body.includes("🌿 露台"), "should render custom-dimension 露台 with leaf emoji heading");
  assert(!note.body.includes("📝 记一笔"), "labeled custom dimension should not fall back to 记一笔");
  assert(note.body.includes("🛏️ 房间"), "labeled 房间 should still render as 🛏️ 房间");
  for (const p of BANNED) assert(!note.body.includes(p), `body must not contain banned phrase: ${p}`);
  assert(countCjk(note.body) <= 600, "body must be <= 600 CJK chars");
}

// Case 5: framework mode with a fully novel label ("宠物友好") that's not in
// the dimension bank and whose value contains no other dimension keywords —
// should become its own section using the user's label (with 📝 fallback
// emoji) instead of being merged into 记一笔.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "宠物友好", value: "可以带狗狗一起入住，还送了一个小礼包。" },
      ],
    }),
  );
  console.log("--- framework novel label 宠物友好 ---");
  console.log(note.body);
  assert(note.body.includes("📝 宠物友好"), "novel custom label should render as its own section heading");
  assert(!note.body.includes("📝 记一笔"), "novel custom label should not fall back to 记一笔");
}

// Case 6: free-text mode mentioning new dimension keywords (隔音 / 卫生) — they
// should cluster into their own emoji-headed sections via auto-detection.
{
  const note = generateNote(
    baseInput({
      inputMode: "freeform",
      framework: [],
      freeText:
        "酒店隔音真的可以，半夜窗外完全听不到车声。卫生也很在意，浴室缝隙都擦得很干净。早餐种类不多但现做鸡蛋香。",
    }),
  );
  console.log("--- freeform with 隔音/卫生 keywords ---");
  console.log(note.body);
  assert(note.body.includes("🤫 隔音"), "freeform: should auto-cluster '隔音' as its own section");
  assert(note.body.includes("🧼 卫生"), "freeform: should auto-cluster '卫生' as its own section");
  assert(note.body.includes("🍳 早餐"), "freeform: 早餐 should still render");
}

// Case 7: framework slot labeled with a generic word (笔记) and no dimension
// keyword in value — should fall back to 📝 记一笔 rather than promoting the
// generic label to a section heading.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "笔记", value: "整体感觉很放松，下次还想来一次。" },
      ],
    }),
  );
  console.log("--- framework generic label 笔记 ---");
  console.log(note.body);
  assert(note.body.includes("📝 记一笔"), "generic label should fall back to 📝 记一笔");
  assert(!note.body.includes("📝 笔记"), "generic label should not be promoted to its own heading");
}

// Case 8: 复核机制 — breakfast/coffee mistakenly filed under 服务 should be
// moved into 🍳 早餐 by the review pass.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "服务", value: "前台态度很好，会主动帮忙。早餐有现做鸡蛋和咖啡，水果也新鲜。" },
        { id: "f2", label: "房间", value: "床很大，灯光也调得刚好。" },
      ],
    }),
  );
  console.log("--- review pass: breakfast under 服务 ---");
  console.log(note.body);
  assert(note.body.includes("🍳 早餐"), "review: breakfast content under 服务 should be moved to 🍳 早餐");
  assert(note.body.includes("🛎️ 服务"), "review: 服务 section should remain for the front-desk sentence");
  // The 服务 section must not still contain the breakfast sentence.
  const servicePart = note.body.split("🛎️ 服务")[1]?.split(/\n\n/)[0] ?? "";
  assert(!servicePart.includes("早餐") && !servicePart.includes("咖啡"), "review: 服务 section must not retain breakfast/coffee");
  for (const p of BANNED) assert(!note.body.includes(p), `body must not contain banned phrase: ${p}`);
  assert(countCjk(note.body) <= 600, "body must be <= 600 CJK chars");
}

// Case 9: 复核机制 — hygiene content mistakenly placed under 房间 should be
// moved into 🧼 卫生.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "房间", value: "床品柔软，落地窗采光很好。浴室缝隙都擦得很干净，卫生做得很到位。" },
      ],
    }),
  );
  console.log("--- review pass: hygiene under 房间 ---");
  console.log(note.body);
  assert(note.body.includes("🧼 卫生"), "review: hygiene sentence under 房间 should be moved to 🧼 卫生");
  assert(note.body.includes("🛏️ 房间"), "review: 房间 section should remain for bed/window sentences");
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(!roomPart.includes("卫生") && !roomPart.includes("干净"), "review: 房间 section must not retain hygiene content");
}

// Case 10: 复核机制 — terrace sentence in generic 笔记 leftover should be
// promoted into 🌿 露台.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "笔记", value: "整体感觉很放松。二楼带一个小露台，傍晚在那儿喝杯酒太舒服。" },
      ],
    }),
  );
  console.log("--- review pass: terrace in generic 笔记 ---");
  console.log(note.body);
  assert(note.body.includes("🌿 露台"), "review: terrace sentence in generic 笔记 should be moved to 🌿 露台");
  const leftoverPart = note.body.split("📝 记一笔")[1]?.split(/\n\n/)[0] ?? "";
  assert(!leftoverPart.includes("露台"), "review: 记一笔 leftover must not retain terrace content");
}

// Case 11: 复核机制 — freeform mixed content should still split correctly,
// and the review pass must not corrupt content (idempotent on already-clean
// freeform routing).
{
  const note = generateNote(
    baseInput({
      inputMode: "freeform",
      framework: [],
      freeText:
        "前台态度很好，会主动帮忙。早餐有现做鸡蛋和咖啡。浴室缝隙擦得很干净，卫生做得很到位。二楼带一个小露台，傍晚坐那儿太舒服。",
    }),
  );
  console.log("--- review pass: freeform multi-dimension ---");
  console.log(note.body);
  assert(note.body.includes("🛎️ 服务"), "freeform review: 服务 section should exist");
  assert(note.body.includes("🍳 早餐"), "freeform review: 早餐 section should exist");
  assert(note.body.includes("🧼 卫生"), "freeform review: 卫生 section should exist");
  assert(note.body.includes("🌿 露台"), "freeform review: 露台 section should exist");
  for (const p of BANNED) assert(!note.body.includes(p), `body must not contain banned phrase: ${p}`);
  assert(countCjk(note.body) <= 600, "body must be <= 600 CJK chars");
}

console.log("\nOK: all copy smoke assertions passed.");
