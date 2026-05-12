# Vercel 部署指南 · AI 生成笔记

NoteStay 的「生成笔记 / 重新生成」按钮通过 `/api/generate-note` 调用智谱（BigModel）GLM 大模型生成正文。该 API 路由仅在 Vercel（或同等 Node 后端环境）下可用，必须把 `ZHIPU_API_KEY` 配置为服务器端环境变量。

> ⚠️ GitHub Pages 等纯静态托管无法运行该 API。若仅在 Pages 上部署，前端会调用失败并提示「AI 生成服务未配置」，请改用 Vercel。

## 1. 准备工作

1. 在 [https://open.bigmodel.cn](https://open.bigmodel.cn) 注册账号并申请 API Key。
2. Fork / 克隆本仓库到你的 GitHub 账户。

## 2. 在 Vercel 创建项目

1. 登录 [vercel.com](https://vercel.com)，点击 **Add New → Project**。
2. Import 你的 NoteStay 仓库。
3. **Framework Preset**：保留 `Other`（项目根目录已提供 `vercel.json`）。
4. **Build & Output Settings**：使用默认值，`vercel.json` 已设置：
   - `buildCommand`: `vite build`
   - `outputDirectory`: `dist/public`
   - 函数 `api/generate-note.ts` 超时上限 60 秒。

## 3. 配置环境变量

在 Vercel 项目的 **Settings → Environment Variables** 添加：

| 变量名           | 是否必填 | 说明                                                                 |
| ---------------- | -------- | -------------------------------------------------------------------- |
| `ZHIPU_API_KEY`  | **必填** | 你的智谱 API Key。仅在服务器端使用，不会进入前端打包产物。              |
| `ZHIPU_MODEL`    | 选填     | 默认使用 `glm-4.5`。如需切换至更高质量或更便宜的模型，可在此覆盖。      |

> 保存后，新的环境变量必须重新部署才能生效（点击 Deployments 页右上角 Redeploy）。

## 4. 部署后验证

1. 进入站点 `/create` 页面，填写酒店信息与心得，点击「生成笔记」。
2. 顶部应出现「正在调用 AI 生成笔记」覆盖层；若顶部出现红色错误条 `AI 生成失败：…`，常见原因：
   - 未配置 `ZHIPU_API_KEY` → 文案为「AI 生成服务未配置…」。
   - 模型返回非 JSON → 文案为「AI 返回内容不是合法 JSON」。
   - 配额耗尽 / Key 无效 → 文案为「Zhipu API 401/403/429…」。

## 5. 本地开发（可选）

本仓库的 Express 开发服务器在 `server/routes.ts` 中暴露相同的 `/api/generate-note` 路由。若想在本地直接体验 AI 生成：

```bash
export ZHIPU_API_KEY=你的_API_Key
npm install
npm run dev
```

不设置 `ZHIPU_API_KEY` 时，路由会返回 503 与中文说明，前端会以错误条形式提示，不会回退到模板生成。

## 6. 数据流与安全

- 前端只发送文字字段（用户心得、酒店事实、OCR 风格摘要、图片张数/分类计数）。**不会上传图片二进制。**
- API Key 仅存在于服务器 / Vercel 函数环境，不会出现在前端打包产物或网络响应中。
- 模型 prompt 中明确禁止：
  - 编造未提供的价格、品牌、城市、设施、早餐内容；
  - 复制参考截图 OCR 文字中的任何具体名称、品牌、价格或原句（只学习节奏与口吻）。
