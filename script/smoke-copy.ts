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

// Case 8: framework mode preserves user-provided structure. A slot labeled
// 服务 keeps its content (including any breakfast keywords) under 🛎️ 服务,
// and is rendered in the user's input order — A mode never re-routes
// content across sections.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "服务", value: "前台态度很好，会主动帮忙。早餐有现做鸡蛋和咖啡，水果也新鲜。" },
        { id: "f2", label: "房间", value: "床很大，灯光也调得刚好。" },
      ],
    }),
  );
  console.log("--- framework fidelity: 服务 stays as 服务 ---");
  console.log(note.body);
  assert(note.body.includes("🛎️ 服务"), "framework: 服务 section should exist with user's label");
  assert(note.body.includes("🛏️ 房间"), "framework: 房间 section should exist with user's label");
  const servicePart = note.body.split("🛎️ 服务")[1]?.split(/\n\n/)[0] ?? "";
  assert(servicePart.includes("早餐") || servicePart.includes("咖啡") || servicePart.includes("前台"),
    "framework: 服务 section must retain user content verbatim");
  assert(!note.body.includes("🍳 早餐"), "framework: must NOT auto-create a separate 早餐 section");
  assert(note.body.indexOf("🛎️ 服务") < note.body.indexOf("🛏️ 房间"),
    "framework: section order must match the user's input order");
  for (const p of BANNED) assert(!note.body.includes(p), `body must not contain banned phrase: ${p}`);
  assert(countCjk(note.body) <= 600, "body must be <= 600 CJK chars");
}

// Case 9: framework fidelity — content inside a 房间 slot stays whole even
// when individual sentences would otherwise match different dimensions.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "房间", value: "床品柔软，落地窗采光很好。浴室缝隙都擦得很干净，卫生做得很到位。" },
      ],
    }),
  );
  console.log("--- framework fidelity: hygiene stays inside 房间 slot ---");
  console.log(note.body);
  assert(note.body.includes("🛏️ 房间"), "framework: 房间 section should exist");
  assert(!note.body.includes("🧼 卫生"), "framework: must NOT auto-extract a 卫生 section from the user's 房间 slot");
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(roomPart.includes("床品") && roomPart.includes("干净"),
    "framework: 房间 section must contain all of the user's original content");
}

// Case 10: framework fidelity — generic 笔记 falls back to 📝 记一笔 and
// keeps the user's content intact (no auto-extraction of dimensions).
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "笔记", value: "整体感觉很放松。二楼带一个小露台，傍晚在那儿喝杯酒太舒服。" },
      ],
    }),
  );
  console.log("--- framework fidelity: generic 笔记 keeps content ---");
  console.log(note.body);
  assert(note.body.includes("📝 记一笔"), "framework: generic 笔记 label should fall back to 📝 记一笔");
  assert(!note.body.includes("🌿 露台"), "framework: must NOT auto-extract 露台 from a generic slot");
  const leftoverPart = note.body.split("📝 记一笔")[1]?.split(/\n\n/)[0] ?? "";
  assert(leftoverPart.includes("露台") || leftoverPart.includes("整体"),
    "framework: 记一笔 must retain the user's content");
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

// Case 12: framework fidelity — content for two user-named slots (房间 and
// 早餐) lands in their own sections in the user's order; 早餐 retains the
// user's breakfast sentence, 房间 retains the user's amenity sentence, and
// neither leaks into the other.
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
  console.log("--- framework fidelity: 房间 + 早餐 preserved ---");
  console.log(note.body);
  const breakfastPart = note.body.split("🍳 早餐")[1]?.split(/\n\n/)[0] ?? "";
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(roomPart.includes("电视") || roomPart.includes("冰箱") || roomPart.includes("茶包咖啡"),
    "framework: 房间 section must contain the user's amenity sentence");
  assert(breakfastPart.includes("一楼餐厅") || breakfastPart.includes("鸡蛋") || breakfastPart.includes("包子"),
    "framework: 早餐 section must contain the user's breakfast sentence");
  assert(!breakfastPart.includes("电视") && !breakfastPart.includes("冰箱"),
    "framework: 早餐 section must not absorb 房间's content");
  assert(note.body.indexOf("🛏️ 房间") < note.body.indexOf("🍳 早餐"),
    "framework: section order must match the user's input order");
}

// Case 13: framework fidelity — user's 卫生 slot is rendered as 🧼 卫生
// regardless of whether the inner text mentions 卫生间, because A mode
// preserves the user's chosen dimension label.
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
  console.log("--- framework fidelity: user's 卫生 label preserved ---");
  console.log(note.body);
  assert(note.body.includes("🧼 卫生"), "framework: user's 卫生 label must render as 🧼 卫生");
  assert(!note.body.includes("🚿 卫生间"), "framework: must not auto-create 卫生间 section from inside 卫生 slot");
  const part = note.body.split("🧼 卫生")[1]?.split(/\n\n/)[0] ?? "";
  assert(part.includes("干湿分离") || part.includes("花洒"),
    "framework: 卫生 section must retain the user's bathroom-facility content");
}

// Case 14: framework fidelity — a generic 笔记 label still falls back to
// 📝 记一笔 and keeps the user's content verbatim (no auto-extraction into
// dimension sections).
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "笔记", value: "房间打扫得一尘不染，床单和缝隙都很干净，没有异味。" },
      ],
    }),
  );
  console.log("--- framework fidelity: generic 笔记 keeps cleanliness content ---");
  console.log(note.body);
  assert(note.body.includes("📝 记一笔"), "framework: 笔记 should fall back to 📝 记一笔");
  assert(!note.body.includes("🧼 卫生"), "framework: must NOT auto-extract 卫生 section from 笔记 slot");
  const part = note.body.split("📝 记一笔")[1]?.split(/\n\n/)[0] ?? "";
  assert(part.includes("干净") || part.includes("一尘不染"),
    "framework: 记一笔 must retain the user's cleanliness content");
}

// Case 15: framework fidelity — user's 隔音 label is preserved as 🤫 隔音
// even when the content is really about bed comfort. A mode never moves
// content between the user's chosen slots.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "隔音", value: "床垫软硬适中，床品柔软，枕头也很舒服。" },
      ],
    }),
  );
  console.log("--- framework fidelity: 隔音 label kept ---");
  console.log(note.body);
  assert(note.body.includes("🤫 隔音"), "framework: user's 隔音 label must render as 🤫 隔音");
  assert(!note.body.includes("🛏️ 房间"), "framework: must NOT extract a 房间 section from 隔音 slot");
}

// Case 16: framework fidelity — when the user uses a generic 笔记 label
// with content about soundproofing, fallback is 📝 记一笔 (content is not
// re-routed to 🤫 隔音).
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "笔记", value: "隔音真的很好，半夜窗外完全听不到车声和走廊声。" },
      ],
    }),
  );
  console.log("--- framework fidelity: generic 笔记 keeps soundproofing content ---");
  console.log(note.body);
  assert(note.body.includes("📝 记一笔"), "framework: 笔记 should fall back to 📝 记一笔");
  assert(!note.body.includes("🤫 隔音"), "framework: must NOT auto-extract 隔音 from 笔记 slot");
}

// Case 17: framework fidelity — user's 房间 slot keeps mixed content
// (room + bathroom) together; A mode does not split across dimensions.
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
  console.log("--- framework fidelity: 房间 keeps bathroom sentence ---");
  console.log(note.body);
  assert(note.body.includes("🛏️ 房间"), "framework: 房间 section should exist");
  assert(!note.body.includes("🚿 卫生间"), "framework: must NOT auto-extract a 卫生间 section");
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(roomPart.includes("床") && (roomPart.includes("干湿分离") || roomPart.includes("花洒")),
    "framework: 房间 section must contain all user content (including bathroom mention)");
}

// Case 18: framework fidelity — mixed-dimension sentences inside the
// user's 房间 slot stay together under 🛏️ 房间.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "房间", value: "推开门是落地窗，床品柔软，洗手间干湿分离很舒服。" },
      ],
    }),
  );
  console.log("--- framework fidelity: mixed sentence stays in 房间 ---");
  console.log(note.body);
  assert(note.body.includes("🛏️ 房间"), "framework: 房间 section should exist");
  assert(!note.body.includes("🚿 卫生间"), "framework: must NOT split 房间 into a 卫生间 section");
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(roomPart.includes("落地窗") && roomPart.includes("洗手间"),
    "framework: 房间 section must retain the entire user sentence");
}

// Case 19: framework fidelity — a same-dimension sentence stays whole in
// the user's slot.
{
  const note = generateNote(
    baseInput({
      framework: [
        { id: "f1", label: "房间", value: "床很大，灯光也调得刚好，桌椅齐全。" },
      ],
    }),
  );
  console.log("--- framework fidelity: same-dim noun list stays whole ---");
  console.log(note.body);
  assert(note.body.includes("🛏️ 房间"), "framework: 房间 section should exist");
  const roomPart = note.body.split("🛏️ 房间")[1]?.split(/\n\n/)[0] ?? "";
  assert(roomPart.includes("床") && roomPart.includes("灯光") && roomPart.includes("桌椅"),
    "clause: same-dimension noun list must stay together in one section");
}

// Case 20: non-cover pages must be photo-only by default — no text layers,
// no auto-added stickers. The cover page is allowed to keep its design.
{
  const images = [
    { id: "img1", url: "blob:test-1", name: "room.jpg", category: "房间" },
    { id: "img2", url: "blob:test-2", name: "lobby.jpg", category: "大堂" },
    { id: "img3", url: "blob:test-3", name: "breakfast.jpg", category: "早餐" },
  ];
  const note = generateNote(baseInput({ images }));
  console.log("--- photo-only non-cover pages ---");
  // Inner pages (index !== 0) must have no text layers in their design.
  const innerPages = note.pageLayout.filter((p) => p.index !== 0);
  assert(innerPages.length > 0, "should have at least one inner page");
  for (const page of innerPages) {
    const design = note.pageDesigns[page.index];
    assert(design, `inner page ${page.index} must have a design`);
    const textLayers = design.layers.filter((l) => l.type === "text");
    assert(textLayers.length === 0,
      `inner page ${page.index} must have no auto-added text layers (got ${textLayers.length})`);
  }
  // Only stickers bound to the cover (pageIndex === 0) by default.
  const nonCoverStickers = note.stickers.filter((s) => s.pageIndex !== 0);
  assert(nonCoverStickers.length === 0,
    `inner pages must have no auto-added stickers (got ${nonCoverStickers.length})`);
  // Cover may still have its design layers — just sanity check it exists.
  assert(note.cover.layers.length > 0, "cover should still have design layers");
}

// Case 21: cover page must not auto-attach any stickers by default. The user
// can still add stickers (including presets) via the editor.
{
  const images = [
    { id: "img1", url: "blob:test-1", name: "room.jpg", category: "房间" },
  ];
  const note = generateNote(baseInput({ images }));
  console.log("--- no default stickers on cover ---");
  assert(note.stickers.length === 0,
    `cover must have no auto-added stickers (got ${note.stickers.length})`);
}

console.log("\nOK: all copy smoke assertions passed.");
