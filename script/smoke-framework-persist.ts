// Smoke test for framework URL persistence.
// Verifies round-trip encode/decode and rejection of corrupt payloads.
import {
  encodeFrameworkToParam,
  decodeFrameworkFromParam,
} from "../client/src/lib/framework-persist";
import { FRAMEWORK_PRESETS, instantiatePreset } from "../client/src/lib/framework-presets";
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

// Case 4: presets instantiate with stable shapes.
{
  assert(FRAMEWORK_PRESETS.length >= 3, "should provide at least 3 framework presets");
  for (const p of FRAMEWORK_PRESETS) {
    assert(p.fields.length > 0, `preset ${p.key} should have at least one field`);
    const inst = instantiatePreset(p);
    assert(inst.length === p.fields.length, `preset ${p.key} instantiation length must match`);
    assert(inst.every((f) => f.value === ""), `preset ${p.key} values must start empty`);
    assert(new Set(inst.map((f) => f.id)).size === inst.length,
      `preset ${p.key} field ids must be unique`);
  }
}

console.log("OK: framework persistence + preset smoke tests passed.");
