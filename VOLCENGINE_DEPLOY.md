# 火山引擎（Volcengine）部署指南 · 国内域名后端

> 适用场景：GitHub Pages 上的静态前端从中国大陆访问 Vercel 失败（`Failed to fetch`、握手超时）。本指南把同一份 Node/Express 后端部署到国内云主机（火山引擎 ECS / 轻量服务器 / FaaS-VM），让前端通过国内可访问的域名调用 `/api/generate-note` → 智谱 GLM。

本指南不依赖任何 Vercel 专属 API。`server/routes.ts` 与 `api/generate-note.ts` 共享同一份提示词、解析器、智谱调用与 CORS 白名单，前端只需把 `VITE_AI_API_BASE_URL` 指向国内后端即可，其它代码无需改动。

---

## 0. 安全提示（先看）

- **密钥务必只放在服务器环境变量里**。任何泄露到前端打包产物或 Git 历史的智谱 API Key 都应立即在 [https://open.bigmodel.cn](https://open.bigmodel.cn) 控制台 **吊销并重新生成**。
- 如果你曾在聊天 / Issue / 截图里把 Key 贴出来过，**现在就去吊销**，不要再用同一把 Key 部署。
- 本仓库的 `.gitignore` 不会自动忽略你写在本地的 `.env`，请确认 `.env` 文件未提交。

---

## 1. 准备工作

1. **智谱 API Key**：在 [https://open.bigmodel.cn](https://open.bigmodel.cn) 注册并申请。
2. **火山引擎账号 + 一台 ECS / 轻量服务器**：
   - 建议规格：1 vCPU + 2 GB 内存起步即可（Express + 一次性外调智谱）。
   - 镜像：Ubuntu 22.04 LTS 或 Debian 12。
   - 安全组放行端口：`22` (SSH)、`80` (HTTP)、`443` (HTTPS)。后端进程监听 `5000`，**不要直接暴露 5000 到公网**，全部走 Nginx 反代。
3. **域名 + ICP 备案**（公网 HTTPS 必备）：在国内提供 HTTPS 服务必须完成 ICP 备案，火山引擎控制台可在线提交。备案完成后再申请 SSL 证书（火山引擎免费证书或 Let's Encrypt）。
4. **Node.js 20.x LTS**：客户端代码与构建工具基于 Node 20。

---

## 2. 在服务器上拉取并构建

```bash
# 安装 Node 20（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx

# 克隆仓库
git clone https://github.com/HarryYan2001/notestay.git
cd notestay

# 安装依赖并构建（前端 + 服务端 bundle）
npm ci
npm run build
```

构建产物：

- `dist/public/`：前端静态资源（在 Vercel / GitHub Pages 用；服务器上一般不需要，因为静态由 GitHub Pages 提供）。
- `dist/index.cjs`：Express 服务端 bundle，`npm start` 直接运行。

---

## 3. 配置环境变量

在仓库根目录创建 `/etc/notestay.env`（或 `~/notestay.env`，权限 600）：

```ini
# 必填：智谱 API Key（仅服务端使用，不会进入前端打包）
ZHIPU_API_KEY=你刚刚重新生成过的_API_Key

# 可选：模型名，默认 glm-4.5
ZHIPU_MODEL=glm-4.5

# 可选：放行 GitHub Pages / 测试环境的 CORS 来源，逗号分隔
# 默认已经放行 https://harryyan2001.github.io 与 https://notestay.vercel.app
AI_CORS_ALLOWED_ORIGINS=https://harryyan2001.github.io,https://your-custom-domain.example

# Express 监听端口；Nginx 反代到这里
PORT=5000
NODE_ENV=production
```

```bash
chmod 600 /etc/notestay.env
```

> ⚠️ **绝不要** 把 `ZHIPU_API_KEY` 通过 `VITE_*` 环境变量传入前端构建，那样会把密钥打进 JS bundle。`ZHIPU_API_KEY` 永远只在服务器进程里读取。

---

## 4. 用 PM2 守护进程（推荐）

```bash
sudo npm install -g pm2

# 把 env 文件传给 PM2 启动的进程
pm2 start "node dist/index.cjs" \
  --name notestay-api \
  --update-env \
  --cwd /home/ubuntu/notestay \
  -- \
  # 见下方说明：PM2 不直接读 env 文件，需要用 `env-cmd` 或 systemd EnvironmentFile
  # 这里我们用 systemd（见 §5），PM2 只做开发期备选。
```

或更直接，**用 systemd**（生产推荐）：

```ini
# /etc/systemd/system/notestay.service
[Unit]
Description=NoteStay API (Express)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/notestay
EnvironmentFile=/etc/notestay.env
ExecStart=/usr/bin/node dist/index.cjs
Restart=on-failure
RestartSec=3
# 不要在日志里打印环境
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now notestay
sudo systemctl status notestay
# 健康检查
curl -sS http://127.0.0.1:5000/api/health
```

`/api/health` 应该返回类似：

```json
{
  "status": "ok",
  "service": "notestay-api",
  "zhipuConfigured": true,
  "model": "glm-4.5",
  "time": "2026-05-13T..."
}
```

`zhipuConfigured: false` 表示 `ZHIPU_API_KEY` 没读到，先检查 EnvironmentFile。

---

## 5. Nginx 反向代理 + HTTPS

```nginx
# /etc/nginx/sites-available/notestay
server {
    listen 80;
    server_name api.your-domain.cn;
    # 强制 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.your-domain.cn;

    ssl_certificate     /etc/letsencrypt/live/api.your-domain.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.your-domain.cn/privkey.pem;

    # 让 Express 自己处理 CORS（与 Vercel 行为一致），Nginx 不要再覆盖
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 智谱调用最长可达 55 秒，给 Nginx 留足超时
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # 健康检查（可选）
    location = /healthz {
        proxy_pass http://127.0.0.1:5000/api/health;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/notestay /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Let's Encrypt 证书
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.your-domain.cn
```

> 在国内云上签 Let's Encrypt 需要 80 端口可达。若 80 不可达，也可以使用火山引擎免费证书或 DNS 验证。

---

## 6. CORS 与前端构建

前端解析器 `client/src/lib/ai-generate.ts:resolveAiApiUrl` 已支持 `VITE_AI_API_BASE_URL` 覆盖。**只要给 GitHub Pages 构建注入这个变量**，前端就会去访问国内后端，而不是 Vercel。

```bash
# GitHub Pages 构建命令示例（在 GH Actions 或本地）：
VITE_AI_API_BASE_URL=https://api.your-domain.cn npm run build
```

构建出的 `dist/public/` 目录中 JS bundle 里的 `/api/generate-note` 请求会自动指向 `https://api.your-domain.cn/api/generate-note`。`/`、`/api/generate-note` 后缀都支持：

- `https://api.your-domain.cn` → 自动追加 `/api/generate-note`
- `https://api.your-domain.cn/` → 末尾斜杠会被规范化
- `https://api.your-domain.cn/api/generate-note` → 原样使用

允许 GitHub Pages 跨域：默认白名单已含 `https://harryyan2001.github.io`。如果你是其它 Pages 路径（fork 后用户名不一样），通过 `AI_CORS_ALLOWED_ORIGINS` 追加：

```ini
AI_CORS_ALLOWED_ORIGINS=https://your-username.github.io
```

`server/routes.ts` 会自动 echo 回匹配的 Origin（不会广播 `*`），同时设置 `Vary: Origin`，与 Vercel 函数行为一致。

---

## 7. 部署后端到端验证

1. **健康检查**：
   ```bash
   curl -sS https://api.your-domain.cn/api/health
   ```
2. **CORS 预检**（应返回 204 + `Access-Control-Allow-Origin: https://harryyan2001.github.io`）：
   ```bash
   curl -sSI -X OPTIONS https://api.your-domain.cn/api/generate-note \
     -H "Origin: https://harryyan2001.github.io" \
     -H "Access-Control-Request-Method: POST"
   ```
3. **GitHub Pages 前端**：用 `VITE_AI_API_BASE_URL=https://api.your-domain.cn npm run build` 重新构建并发布，再在浏览器从大陆网络访问 `https://harryyan2001.github.io/notestay/`，点「生成笔记」。

---

## 8. 常见问题

- **`Failed to fetch`（依然）**：浏览器看 Network 面板，确认请求 URL 是 `api.your-domain.cn` 而非 `notestay.vercel.app`。如果还指向 Vercel，说明 GitHub Pages 用的旧 bundle，没带 `VITE_AI_API_BASE_URL` 重新构建。
- **`403 / CORS error`**：Origin 不在白名单。把 Pages 域名加进 `AI_CORS_ALLOWED_ORIGINS`，systemctl restart notestay。
- **`503 AI 生成服务未配置`**：服务器进程没读到 `ZHIPU_API_KEY`，检查 `systemctl show notestay | grep Env` 或 `pm2 env <id>`。
- **`502 调用智谱 AI 失败：fetch failed`**：服务器到 `open.bigmodel.cn` 不通。火山引擎默认放行国内外网络，但若开了严格安全组要检查 HTTPS 出站。
- **`504 AI 模型响应超时`**：单次生成超过 55 秒。给 Nginx `proxy_read_timeout` 调到 120s，或缩短用户输入。
- **Key 泄露应急**：登录智谱控制台吊销旧 Key，生成新 Key，更新 `/etc/notestay.env`，`sudo systemctl restart notestay`。前端无需重新部署。

---

## 9. 与 Vercel / GitHub Pages 三方共存

- Vercel 部署 (`api/generate-note.ts`) 与本指南**互不冲突**，前端在 Vercel 域名下仍走 same-origin。
- 同一前端可以在三个地方运行：
  - Vercel：自带 `/api/generate-note`，无需配置。
  - GitHub Pages + Vercel 后端：默认行为，海外可用。
  - **GitHub Pages + 国内 Volcengine 后端**：`VITE_AI_API_BASE_URL=https://api.your-domain.cn` 重新构建。
- 切换只是一次构建参数 + 一次 Pages 发布。

部署完成后请把 `https://api.your-domain.cn` 告诉本仓库维护者，配合 GitHub Pages workflow 注入 `VITE_AI_API_BASE_URL` 即可发布国内可访问的版本。
