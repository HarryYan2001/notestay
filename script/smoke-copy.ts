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

// Case 12: regression — room amenity sentence that mentions 茶包/咖啡 must NOT
// be routed to 早餐. Reproduces a real screenshot where a 早餐 section
// incorrectly absorbed "房间里还有大屏电视、小冰箱、免费矿泉水和茶包咖啡，
// 办公区桌椅齐全，出差旅游都合适。" while the true breakfast sentence
// belongs alone under 🍳 早餐.
{
  const note = generateNote(
    baseInput({
      framework: [
        {
          id: "f1",
          label: "房间",
          value: "房间里还有大屏电视、小冰箱、免费矿泉水和茶包咖啡，办公区桌椅齐全，出差旅游都合适。",
        },
        { id: "f2", label: "早餐", value: "早餐在一楼餐厅，有现做的鸡蛋和包子，能吃饱。" },
      ],
    }),
  );
  console.log("--- regression: 茶包咖啡 must not route to 早餐 ---");
  console.log(note.body);
  const breakfastPart = note.body.split("🍳 早餐")[1]?.split(/\n\n/)[0] ?? "";
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(!breakfastPart.includes("电视") && !breakfastPart.includes("冰箱") && !breakfastPart.includes("茶包咖啡"),
    "regression: 早餐 section must not absorb room-amenity sentence with 茶包/咖啡");
  assert(breakfastPart.includes("一楼餐厅") || breakfastPart.includes("鸡蛋") || breakfastPart.includes("包子"),
    "regression: 早餐 section must contain the actual breakfast sentence");
  assert(roomPart.includes("电视") || roomPart.includes("冰箱") || roomPart.includes("茶包咖啡"),
    "regression: 房间 section must contain the room-amenity sentence");
}

// Case 13: regression — bathroom-facility sentence (干湿分离/热水/花洒/洗澡)
// must NOT route to 卫生 (cleanliness). It should route to a dedicated
// bathroom section (🚿 卫生间).
{
  const note = generateNote(
    baseInput({
      framework: [
        {
          id: "f1",
          label: "卫生",
          value: "卫生间是干湿分离设计，24小时热水供应充足，花洒出水强劲，洗澡很舒服。",
        },
      ],
    }),
  );
  console.log("--- regression: 卫生间/干湿分离 must not route to 卫生 ---");
  console.log(note.body);
  assert(note.body.includes("🚿 卫生间"), "regression: bathroom-facility text should route to 🚿 卫生间");
  assert(!note.body.includes("🧼 卫生"), "regression: bathroom-facility text must NOT create a 🧼 卫生 section");
}

// Case 14: regression — cleanliness sentence still routes to 卫生 (we did not
// break the clean case).
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "笔记", value: "房间打扫得一尘不染，床单和缝隙都很干净，没有异味。" },
      ],
    }),
  );
  console.log("--- regression: cleanliness still routes to 卫生 ---");
  console.log(note.body);
  assert(note.body.includes("🧼 卫生"), "regression: cleanliness sentence should still route to 🧼 卫生");
  assert(!note.body.includes("🚿 卫生间"), "regression: pure cleanliness text should not route to 卫生间");
}

// Case 15: regression — bed / mattress sentence must NOT be absorbed by 隔音.
// It should route to 🛏️ 房间.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "隔音", value: "床垫软硬适中，床品柔软，枕头也很舒服。" },
      ],
    }),
  );
  console.log("--- regression: 床垫/床品 must not route to 隔音 ---");
  console.log(note.body);
  assert(!note.body.includes("🤫 隔音"), "regression: bed-comfort text must not create a 🤫 隔音 section");
  assert(note.body.includes("🛏️ 房间"), "regression: bed-comfort text should route to 🛏️ 房间");
}

// Case 16: regression — true noise sentence still routes to 隔音.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "笔记", value: "隔音真的很好，半夜窗外完全听不到车声和走廊声。" },
      ],
    }),
  );
  console.log("--- regression: real 隔音 still routes ---");
  console.log(note.body);
  assert(note.body.includes("🤫 隔音"), "regression: real noise/soundproofing should still route to 🤫 隔音");
}

// Case 17: regression — review pass moves a bathroom-facility sentence out of
// a generic 房间 slot into 🚿 卫生间.
{
  const note = generateNote(
    baseInput({
      framework: [
        {
          id: "f1",
          label: "房间",
          value: "床很大，灯光也调得刚好。卫生间干湿分离，花洒水压很强。",
        },
      ],
    }),
  );
  console.log("--- review pass: bathroom sentence in 房间 ---");
  console.log(note.body);
  assert(note.body.includes("🚿 卫生间"), "review: bathroom sentence in 房间 should be moved to 🚿 卫生间");
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(!roomPart.includes("干湿分离") && !roomPart.includes("花洒"),
    "review: 房间 section must not retain bathroom-facility content");
}

// Case 18: clause-level splitting — a single sentence that mixes 房间 and
// 卫生间 dimensions ("推开门是落地窗，床品柔软，洗手间干湿分离很舒服。")
// must split on Chinese commas. 落地窗/床品 route to 🛏️ 房间; 洗手间干湿分离
// routes to 🚿 卫生间. Reproduces a real generator misclassification.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "房间", value: "推开门是落地窗，床品柔软，洗手间干湿分离很舒服。" },
      ],
    }),
  );
  console.log("--- clause-level: mixed 房间/卫生间 sentence ---");
  console.log(note.body);
  assert(note.body.includes("🛏️ 房间"), "clause: should have 🛏️ 房间 section");
  assert(note.body.includes("🚿 卫生间"), "clause: should have 🚿 卫生间 section");
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  const bathPart = note.body.split("🚿 卫生间")[1]?.split(/\n\n/)[0] ?? "";
  assert(roomPart.includes("落地窗") && roomPart.includes("床品"),
    "clause: 房间 section must contain 落地窗 and 床品 clauses");
  assert(!roomPart.includes("干湿分离"),
    "clause: 房间 section must NOT contain 干湿分离");
  assert(bathPart.includes("干湿分离") || bathPart.includes("洗手间"),
    "clause: 卫生间 section must contain the bathroom clause");
  assert(!bathPart.includes("落地窗") && !bathPart.includes("床品"),
    "clause: 卫生间 section must NOT absorb the room clauses");
}

// Case 19: clause-level splitting must NOT chop a single-dimension noun list.
// "床很大，灯光也调得刚好，桌椅齐全。" is all 房间; it should stay as one
// natural sentence in 🛏️ 房间.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "房间", value: "床很大，灯光也调得刚好，桌椅齐全。" },
      ],
    }),
  );
  console.log("--- clause-level: same-dimension noun list stays whole ---");
  console.log(note.body);
  assert(note.body.includes("🛏️ 房间"), "clause: single-dim sentence should still land in 🛏️ 房间");
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(roomPart.includes("床") && roomPart.includes("灯光") && roomPart.includes("桌椅"),
    "clause: same-dimension noun list must stay together in one section");
}

console.log("\nOK: all copy smoke assertions passed.");
