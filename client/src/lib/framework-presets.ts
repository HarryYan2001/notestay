import type { FrameworkField } from "./types";

// Preset framework templates that users can apply as a starting point for the
// A · 框架化输入 panel. Each preset is a labelled list of dimensions; values
// start empty so the user fills them in. Users can still edit any label,
// add new fields, or remove fields after applying a preset.
export interface FrameworkPreset {
  key: string;
  name: string;
  description: string;
  fields: { label: string }[];
}

export const FRAMEWORK_PRESETS: FrameworkPreset[] = [
  {
    key: "classic",
    name: "经典测评 6 维度",
    description: "第一印象 / 房间 / 服务 / 早餐 / 周边 / 推荐理由",
    fields: [
      { label: "第一印象" },
      { label: "房间空间" },
      { label: "服务体验" },
      { label: "早餐 / 餐饮" },
      { label: "周边 / 地理位置" },
      { label: "推荐理由 / 不推荐之处" },
    ],
  },
  {
    key: "boutique",
    name: "精品民宿 5 维度",
    description: "氛围 / 设计 / 房型 / 主人服务 / 周边玩法",
    fields: [
      { label: "氛围感受" },
      { label: "设计与细节" },
      { label: "房型与床品" },
      { label: "主人 / 管家服务" },
      { label: "周边玩法" },
    ],
  },
  {
    key: "luxury",
    name: "奢华酒店 7 维度",
    description: "抵达 / 大堂 / 房间 / 餐饮 / SPA · 设施 / 服务 / 性价比",
    fields: [
      { label: "抵达与迎宾" },
      { label: "大堂氛围" },
      { label: "房间 / 套房" },
      { label: "餐饮体验" },
      { label: "SPA / 健身 / 设施" },
      { label: "服务细节" },
      { label: "整体价值感" },
    ],
  },
];

export function instantiatePreset(preset: FrameworkPreset): FrameworkField[] {
  const stamp = Date.now();
  return preset.fields.map((f, idx) => ({
    id: `f_${preset.key}_${stamp}_${idx}`,
    label: f.label,
    value: "",
  }));
}
