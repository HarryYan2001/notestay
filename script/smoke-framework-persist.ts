// Smoke test for framework URL persistence.
// Verifies round-trip encode/decode and rejection of corrupt payloads for
// both the active framework and saved custom templates.
import {
  encodeFrameworkToParam,
  decodeFrameworkFromParam,
  encodeTemplatesToParam,
  decodeTemplatesFromParam,
  instantiateTemplate,
  type SavedFrameworkTemplate,
} from "../client/src/lib/framework-persist";
import type { FrameworkField } from "../client/src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function eq(a: FrameworkField[], b: FrameworkField[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].label !== b[i].label) return false;
    if (a[i].value !== b[i].value) return false;
  }
  return true;
}

// Case 1: round-trip with default-shaped framework (CJK labels + values).
{
  const fields: FrameworkField[] = [
    { id: "f1", label: "第一印象", value: "一进门觉得很温馨。" },
    { id: "f2", label: "房间空间", value: "落地窗景观不错。" },
    { id: "f3", label: "服务体验", value: "" },
  ];
  const encoded = encodeFrameworkToParam(fields);
  const decoded = decodeFrameworkFromParam(encoded);
  assert(decoded !== null, "decode should succeed for valid payload");
  assert(eq(fields, decoded!), "round-trip should preserve ids, labels, values");
  // URL-safe characters only — no +/= in the payload.
  assert(!/[+/=]/.test(encoded), "encoded payload must be URL-safe (no + / =)");
}

// Case 2: round-trip with a custom label the user edited.
{
  const fields: FrameworkField[] = [
    { id: "fcustom", label: "宠物友好", value: "可以带狗狗一起入住。" },
  ];
  const decoded = decodeFrameworkFromParam(encodeFrameworkToParam(fields));
  assert(decoded !== null && decoded.length === 1, "single custom field must round-trip");
  assert(decoded![0].label === "宠物友好", "user-edited label must persist");
}

// Case 3: corrupt input is rejected gracefully (returns null, never throws).
{
  assert(decodeFrameworkFromParam("not-base64!!!") === null, "garbage input should decode to null");
  assert(decodeFrameworkFromParam("") === null, "empty input should decode to null");
  // valid base64 but not our shape.
  const wrongShape = btoa('{"hello":"world"}');
  assert(decodeFrameworkFromParam(wrongShape) === null, "wrong-shape JSON should decode to null");
}

// Case 4: saved template round-trip — single template with CJK name.
{
  const templates: SavedFrameworkTemplate[] = [
    {
      id: "tpl_1",
      name: "精品民宿 5 维度",
      fields: [
        { label: "氛围感受", value: "" },
        { label: "设计与细节", value: "前台贴心地准备了欢迎果盘。" },
        { label: "房型与床品", value: "" },
        { label: "主人 / 管家服务", value: "" },
        { label: "周边玩法", value: "" },
      ],
    },
  ];
  const encoded = encodeTemplatesToParam(templates);
  const decoded = decodeTemplatesFromParam(encoded);
  assert(decoded !== null, "templates decode should succeed");
  assert(decoded!.length === 1, "should round-trip exactly one template");
  assert(decoded![0].name === "精品民宿 5 维度", "template name must persist");
  assert(decoded![0].fields.length === 5, "template field count must persist");
  assert(decoded![0].fields[1].value === "前台贴心地准备了欢迎果盘。",
    "template field value must persist");
  assert(!/[+/=]/.test(encoded), "templates payload must be URL-safe");
}

// Case 5: multiple templates round-trip preserving order.
{
  const templates: SavedFrameworkTemplate[] = [
    {
      id: "tpl_a",
      name: "经典测评",
      fields: [
        { label: "第一印象", value: "" },
        { label: "推荐理由", value: "" },
      ],
    },
    {
      id: "tpl_b",
      name: "奢华酒店",
      fields: [
        { label: "抵达体验", value: "" },
        { label: "餐饮", value: "" },
        { label: "服务", value: "" },
      ],
    },
  ];
  const decoded = decodeTemplatesFromParam(encodeTemplatesToParam(templates));
  assert(decoded !== null && decoded.length === 2, "two templates must round-trip");
  assert(decoded![0].id === "tpl_a" && decoded![1].id === "tpl_b",
    "template order must be preserved");
  assert(decoded![0].fields.length === 2 && decoded![1].fields.length === 3,
    "per-template field counts must be preserved");
}

// Case 6: empty templates list round-trips to an empty array (not null).
{
  const decoded = decodeTemplatesFromParam(encodeTemplatesToParam([]));
  assert(decoded !== null && decoded.length === 0,
    "empty template list should round-trip to []");
}

// Case 7: corrupt template input is rejected gracefully.
{
  assert(decodeTemplatesFromParam("not-base64!!!") === null,
    "garbage template input should decode to null");
  assert(decodeTemplatesFromParam("") === null,
    "empty template input should decode to null");
  const wrongShape = btoa('{"hello":"world"}');
  assert(decodeTemplatesFromParam(wrongShape) === null,
    "wrong-shape template JSON should decode to null");
}

// Case 8: instantiateTemplate produces fresh ids and copies labels + values.
{
  const tpl: SavedFrameworkTemplate = {
    id: "tpl_x",
    name: "测试模板",
    fields: [
      { label: "一", value: "A" },
      { label: "二", value: "" },
      { label: "三", value: "C" },
    ],
  };
  const fields = instantiateTemplate(tpl);
  assert(fields.length === 3, "instantiation should produce 3 fields");
  assert(fields[0].label === "一" && fields[0].value === "A",
    "instantiation should copy labels and values");
  assert(new Set(fields.map((f) => f.id)).size === fields.length,
    "instantiated field ids must be unique");
  for (const f of fields) {
    assert(f.id.startsWith("f_tpl_"), "instantiated ids should carry a template prefix");
  }
}

console.log("OK: framework persistence + template smoke tests passed.");
