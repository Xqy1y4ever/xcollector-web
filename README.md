# Xcollector Web · 官方通知控制台

把 QQ 官方通知群里的消息，以「**含截止时间的任务条目**」的形式展示出来，
让群里的通知不会因为刷屏而被漏掉。

每条解析结果旁边都必须能一眼看到它依据的**原文** —— 因为这套东西的核心诉求
不是「总结得好看」，而是**截止时间不会错、不会漏**。

> **项目主页与部署入口在
> [`xcollector-deploy`](https://github.com/Xqy1y4ever/xcollector-deploy)**
> —— 想看这套系统整体怎么跑、怎么装，从那里开始。

## 技术栈

| | |
|---|---|
| 框架 | Vue 3（Composition API） |
| 构建 | Vite |
| UI | Element Plus |
| 状态 | Pinia |
| 请求 | axios |
| 产物 | 纯静态站点（`dist/`） |

## 架构

前端跟**两个**服务说话：

```
                    ┌─ /api/*  ──▶ xcollector-backend   （通知列表、详情、人工修正、附件）
浏览器 ──▶ dist ────┤
                    └─ /bot/*  ──▶ xcollector-bot       （系统状态、摘要预览与发送）
```

- **通知台**的数据全部来自后端。
- **系统状态页**的数据全部来自 bot（OneBot 连接、流水线计数、盲区、缺口）。

三条路由：`/login`（登录）、`/`（通知台）、`/health`（系统状态）。
未登录访问受保护路由会跳到登录页，并在 `?redirect=` 里记住原目标。

## 部署

### 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
```

开发服务器会把 `/api` 代理到后端、`/bot` 代理到 bot，所以**不需要处理跨域**。
后端地址在 `vite.config.js` 里，也可以用环境变量临时覆盖：

```bash
$env:XCOLLECTOR_BACKEND = "http://192.168.1.10:8000"; npm run dev
```

后端没跑起来时页面不会白屏，会明确显示「后端未连接」并给出重试按钮。

### 生产：拿到 dist

**方式一：自己构建**

```bash
npm ci && npm run build      # 产出 dist/
```

**方式二：直接用 CI 的产物**（部署机上不需要装 Node）

```bash
# Release 附件
curl -L https://github.com/Xqy1y4ever/xcollector-web/releases/latest/download/dist.tar.gz \
  | tar xz -C /var/www/xcollector
# → /var/www/xcollector/dist/

# 或者从 GHCR 的纯文件镜像里取（这个镜像不能 docker run，它只是个文件袋）
docker pull ghcr.io/xqy1y4ever/xcollector-web:latest
docker create --name xcw ghcr.io/xqy1y4ever/xcollector-web:latest
docker cp xcw:/dist/. ./dist && docker rm xcw
```

推 `main` 会滚动更新 `latest` 预发布版本，推 `v1.2.3` 这样的 tag 会出正式 Release。

### 生产：托管 dist

`dist/` 是**纯静态站点**，自己不带任何代理。你需要在 web server 上同时做三件事，
而且它们**必须同源**（同一个 host:port），否则浏览器会跨域：

```nginx
root /path/to/dist;

location /     { try_files $uri $uri/ /index.html; }        # 静态文件 + SPA 路由回退
location /api/ { proxy_pass http://127.0.0.1:8000;  }       # → 后端，前缀保留
location /bot/ { proxy_pass http://127.0.0.1:8082/; }       # → bot，注意**摘掉** /bot 前缀
```

三个容易写错的点：

- **`/api` 的 `proxy_pass` 结尾不要带路径**。写成 `http://127.0.0.1:8000/api/`
  会变成 `/api/api/notifications`，全线 404。
- **`/bot` 前缀要去掉**再转发（bot 自己的路径就是 `/api/status`），结尾那个 `/` 就是干这个的。
- **原样转发 `Authorization` 头**，否则登录时输入的令牌会被丢掉。

完整的 nginx 与 Caddy 配置见
[`xcollector-deploy`](https://github.com/Xqy1y4ever/xcollector-deploy#托管-dist) 的「托管 dist」一节。

## 认证

登录页输入的是**网页令牌** `WEB_API_TOKEN`，它由后端和 bot 共同校验。

| 令牌 | 能做什么 |
|---|---|
| `WEB_API_TOKEN`（登录页输入） | 读通知、提交人工修正、标记已读 |
| `API_TOKEN` / `BOT_API_TOKEN`（管理令牌） | 额外解锁「发送摘要到 QQ」等操作 |

登录页的「高级」区可以填管理令牌。**填了它，这个浏览器就有完整权限**，
包括以你的账号发 QQ 消息，所以只在自己机器上这么用。

令牌保存在浏览器 storage 里，**任何能在这台浏览器上执行 JS 的东西都能读到它**。
所以这套前端只适合私有部署：**不要把端口暴露到公网**，对外提供服务请上 HTTPS，
并在前面套一层真正的认证（带登录的反向代理 / VPN / Tailscale）。

如果前端与两个服务不同源，需要改 `src/api/` 下的 baseURL 并自行处理 CORS ——
不推荐，同源反代是更省事的做法。

## 页面

| 页面 | 内容 |
|---|---|
| `/login` | 输入令牌登录，可勾选「记住我」 |
| `/` 通知台 | 按截止时间分组的任务卡片、详情抽屉、人工修正、已读切换 |
| `/health` 系统状态 | OneBot 连接、流水线计数、后端可达性、盲区与缺口、摘要预览与发送 |

**通知台**按截止时间升序分组（已过期 / 今天 / 几天内 / 更晚 / 无确定时间 / 已完成），
每 60 秒自动增量刷新。卡片左侧是大号的截止时间，下面附原文里的时间表达。

截止时间的置信度直接体现在界面上：

| 置信度 | 表现 |
|---|---|
| ≥ 0.9 | 正常显示 |
| 0.6 ~ 0.9 | 时间前加 `~` |
| < 0.6 | 时间变灰 + 「待确认」标签 |
| 无法解析 | 显示「待确认」+ 原文表达，**绝不猜一个时间出来** |

点开卡片可以看到**原文证据**：高亮截取的原文、发布者、群名、发送时间、附件，
以及两个模型给出不同时间时的逐条对照（可以一键采用其中一个）。

## 配置

| 变量 | 说明 |
|---|---|
| `XCOLLECTOR_BACKEND` | 开发时代理的后端地址，默认 `http://127.0.0.1:8000` |
| `XCOLLECTOR_BOT` | 开发时代理的 bot 地址，默认 `http://127.0.0.1:8082` |
| `VITE_API_BASE` | 后端请求前缀，默认同源 `/api`（前后端不同源部署时才需要改） |
| `VITE_BOT_BASE` | bot 请求前缀，默认同源 `/bot` |
| `VITE_API_TOKEN` / `VITE_BOT_API_TOKEN` | 预置令牌，用于跳过登录页（开发 / CI） |

前两个是 `vite.config.js` 用 `process.env` 读的，**写进 `.env.local` 不会生效** ——
Vite 只注入 `VITE_` 前缀的变量，要用得设成真实的环境变量。`VITE_*` 是**构建期内联**的，
改完必须重新构建，热更新不会生效。

`.env.example` 里有每一项的详细说明。

## 接口

| 后端 `/api/*` | 用途 |
|---|---|
| `GET /api/notifications` | 通知列表 |
| `GET /api/notifications/{id}` | 详情 + 原文 |
| `POST /api/notifications/{id}/corrections` | 提交人工修正 |
| `POST /api/notifications/{id}/read` | 已读 / 未读 |
| `GET /api/health` | 后端可达性探针 |
| `GET /api/attachments/{id}` | 附件（图片与下载） |

| bot `/bot/api/*` | 用途 |
|---|---|
| `GET /api/status` | 系统状态页的全部数据 |
| `GET /api/digest/preview` | 预览摘要文本 |
| `POST /api/digest/send` | 立即发送摘要（需要管理令牌） |

时间戳统一是**毫秒整数**，`due_at` 为 `null` 表示没解析出确定时间。
完整的请求/响应约定见
[`xcollector-backend/docs/api.md`](https://github.com/Xqy1y4ever/xcollector-backend/blob/main/docs/api.md)。
