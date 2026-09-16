# Xcollector Web · 官方通知控制台

把 QQ 官方通知群的消息，用 LLM 抽取成「**含 DDL 的任务条目**」并展示给人看的前端。

> **第一原则：任何解析结果旁边都必须能一眼看到它依据的原文（`evidence`）。**
> 因为核心诉求不是"总结得好看"，而是 **DDL 不会错、不会漏**。

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 3. 生产构建 / 本地预览构建产物
npm run build
npm run preview
```

> 前端**强依赖后端**才能显示数据。后端还没跑起来时页面**不会白屏**：
> 列表区会显示「后端未连接，请确认 FastAPI 已在 127.0.0.1:8000 运行」，
> 顶栏的连接状态点是**红色**，并提供「重试」按钮。

### 后端怎么配合

开发时前端只请求同源的 `/api/*`，由 Vite dev 代理转发到后端，**因此不需要处理 CORS**。

先把后端跑在 `127.0.0.1:8000`：

```bash
# 示例（具体命令以 xcollector-backend 仓库为准）
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

然后 `npm run dev`，打开 http://localhost:5173 即可。

---

## 后端地址在哪改

有两个地方，按需要选一个：

1. **推荐：改 `vite.config.js` 里的目标地址**（只在开发环境生效）

   ```js
   const BACKEND_TARGET = process.env.XCOLLECTOR_BACKEND || 'http://127.0.0.1:8000'
   ```

   可以直接改默认值，也可以临时用环境变量覆盖：

   ```bash
   # PowerShell
   $env:XCOLLECTOR_BACKEND = "http://192.168.1.10:8000"; npm run dev
   ```

2. **前后端不同源部署时：根目录新建 `.env.local`**（该文件已被 `.gitignore` 忽略）

   ```
   VITE_API_BASE=http://your-backend-host:8000/api
   ```

   `src/api/client.js` 会读这个变量作为 axios 的 `baseURL`；不设置时默认走 `/api` 代理。

---

## 认证（API_TOKEN）：先读这一段

契约要求所有请求带 `Authorization: Bearer <API_TOKEN>`（token 为空则后端 / bot 不校验）。
前端在两个 axios 实例上各挂了一个请求拦截器，**只在配置了 token 时才加这个头**：

| 变量 | 作用对象 | 不配置时 |
|---|---|---|
| `VITE_API_TOKEN` | 后端 `/api/*` | 不发 `Authorization` 头 |
| `VITE_BOT_API_TOKEN` | bot `/bot/api/*` | 不发 `Authorization` 头 |

本地开发什么都不用配（两边 `API_TOKEN` 留空即可）。需要打开校验时，在根目录 `.env.local` 里写：

```
VITE_API_TOKEN=<与后端 API_TOKEN 相同的值>
VITE_BOT_API_TOKEN=<与 bot API_TOKEN 相同的值>
```

改完必须**重启 `npm run dev` / 重新 `npm run build`**——`import.meta.env.VITE_*` 是构建期内联的，不是运行时读取。

### ⚠️ 这个做法**不是安全边界**，别把它当成安全措施

- Vite 会把 `VITE_API_TOKEN` / `VITE_BOT_API_TOKEN` 的值**内联进打包产物**。
  也就是说，token 以**明文**躺在 `dist/assets/*.js` 里，
  **任何能打开这个页面的人都能读到它**（浏览器开发者工具看请求头，或者直接搜 bundle 都行）。
- 所以它**只能挡住「随手访问接口」**——比如搜索引擎爬虫、局域网里乱扫端口的人、
  或者不小心点开一个 API URL 的同事。它挡不住任何一个有心人。
- **真正的边界是：不要把后端和 bot 直接暴露到公网。**
  两者都应该只监听 `127.0.0.1`，或者只在内网 / 容器网络里可达。
- **如果要对外提供服务，必须套一层带认证的反向代理**（Nginx / Caddy / 网关等），
  由它来做真实的鉴权、TLS 和访问控制，并把 `/api` 与 `/bot` 转发到内网的两个服务。
- 一句话：**配了 `VITE_API_TOKEN` ≠ 安全了**。它只是把「完全敞开」变成「需要先看一眼 bundle」。
  任何写进前端的秘密都不是秘密；不要往这里放真正的凭据。

---

## 生产部署需要什么

`npm run build` 产出的是一个**纯静态站点**，它自己**不带任何代理**——
`vite.config.js` 里的 `/api` 和 `/bot` 代理**只在开发服务器上生效**。

所以部署方必须在反向代理上提供两条同源转发，前端才能工作：

```nginx
location /api/  { proxy_pass http://127.0.0.1:8000/api/; }   # → 后端（纯数据层）
location /bot/  { proxy_pass http://127.0.0.1:8082/;      }   # → bot，注意摘掉 /bot 前缀
```

要点：

- `/bot` 前缀要**去掉**再转发（bot 自己的路径就是 `/api/status`、`/api/digest/*`），
  与 `vite.config.js` 里 dev 代理的 `rewrite` 行为一致。
- 反向代理是唯一能做真实鉴权的地方（见上一节）。
- 如果前端与两个服务不同源，改用 `VITE_API_BASE` / `VITE_BOT_BASE` 指定绝对地址，
  并自行处理 CORS。

---

## 目录结构

```
xcollector-web/
├── index.html                  # 入口 HTML
├── vite.config.js              # Vite 配置（dev 代理 /api → 后端、/bot → bot，@ 别名）
├── package.json
├── .gitignore
├── README.md
└── src/
    ├── main.js                 # 应用入口：Element Plus 全量注册 + 全量图标注册 + 全局兜底错误处理
    ├── App.vue                 # 路由出口
    ├── router/
    │   └── index.js            # 两个路由：/（通知台）、/health（系统状态）
    ├── api/
    │   ├── client.js           # 后端 axios 实例（/api）+ 通知接口 + Authorization 拦截器
    │   ├── bot.js              # bot axios 实例（/bot）+ status/digest 接口 + Authorization 拦截器
    │   └── errors.js           # 异常 → 中文文案（两个实例共用，含 401 指引）
    ├── stores/
    │   ├── notifications.js    # 通知列表 / 详情 / 修正 / 已读（数据来自后端）
    │   └── health.js           # bot 系统状态 + 后端可达性探针 + digest 预览与发送
    ├── utils/
    │   ├── time.js             # 所有时间格式化与相对时间（禁止在组件里裸写 new Date().toLocaleString()）
    │   ├── healthStatus.js     # bot /api/status 的纯映射（无 Vue 依赖，可直接跑断言）
    │   └── evidence.js         # evidence 在原文中的定位与高亮切片
    ├── styles/
    │   └── global.css          # 全局样式（卡片、evidence 块、状态点、盲区面板等）
    ├── views/
    │   ├── NotificationBoard.vue   # 通知台 /
    │   └── HealthView.vue          # 系统状态 /health
    └── components/
        ├── AppHeader.vue               # 顶栏：标题 / 连接状态点 / 盲区角标 / 刷新 / 最后同步时间
        ├── NotificationCard.vue        # 通知卡片（左侧大号 DDL + 右侧正文 + 标签）
        ├── NotificationDetail.vue      # 详情抽屉（左「解析结果」可编辑 / 右「原文证据」）
        ├── NotificationFormPanel.vue   # 详情里的修正表单
        └── NotificationEvidencePanel.vue # 原文证据块 + 附件 + 原始 JSON
```

---

## 界面说明

### 通知台 `/`

- **分组**：按 `due_at` 升序，分成「已过期 / 今天 / 几天内 / 更晚 / 无确定时间 / 已完成」；
  空组不显示，「已完成」默认收起（标题上仍显示条数，点击展开）。
- **卡片左侧一列**是格式化后的大号 DDL（如 `09-12 周五 23:59`），下面小字是原文时间表达（如「下周三前」）。
- `evidence` 与附件**收在详情抽屉里**（点卡片打开），代价是「一眼看到依据」变成「点开看到」，
  所以 `DDL 冲突` / `待确认` 这类风险标签必须留在卡片上保持醒目。
- 标签：`DDL 冲突`（红）/ `已人工确认`（绿）/ `待确认`（灰）/ 未读蓝点。
- 操作：已读未读切换、`这不是通知`（写 `status=archived`）。
- 每 60 秒自动增量刷新（`since=<上次 server_time>`），右上角显示「最后同步 X 秒前」。

### DDL 置信度的展示规则

| `due_confidence` | 卡片表现 |
|---|---|
| `>= 0.9` | 正常显示时间 |
| `0.6 ~ 0.9` | 时间前加 `~` 前缀 |
| `< 0.6` | 时间整体灰色 + 「待确认」标签 |
| `due_at === null` | 时间位置显示 **「待确认」**，`due_text` 原文照常显示（**绝不显示为空或当前时间**） |

### 详情抽屉

- **左右并排对照**：左「解析结果」（`title` / `summary` / `due_at` / `due_text` / `status` 可编辑，底部「保存修正」），右「原文证据」。
- 右栏把 `evidence` 显示在 `el-alert` 里，并在 `raw.content` 全文中**高亮**出来；
  同时展示发布者、群名、发送时间、附件（图片 `el-image` 可预览，文件给下载链接），
  以及可折叠的「原始 JSON」。
- `conflict: true` 时抽屉顶部是红色 `el-alert`，逐条列出 `candidates` 里每个模型的
  `due_at` / `due_text`，每条后面一个「采用」按钮，点击即提交为人工修正。

### 系统状态 `/health`

**这一页的数据来自 bot，不是后端**（后端退化成纯数据层之后的契约，见 `xcollector-backend/docs/api.md` 第 9 节）：

- 卡片：OneBot 连接、LLM 配置、今日流水线、**后端可达性**、每日 digest 配置、配置快照（白名单）。
- 「后端可达性」是这一页最重要的运维信号：**bot 活着但后端挂了，消息就存不进去**。
  不可达时整卡变橙 + 红色标签 + 一句「消息收得到却存不进去」的说明。
- 盲区区块：未解析 / DDL 冲突 / 低置信度 / 消息缺口 / 今日是否降级（来自 `status.blindspots` + `status.gap_alerts`）。
- 群列表用 `el-table`，**静默小时数 > 2 标黄并提示「可能掉线」**。
- 缺口告警逐条用 `el-alert`（warning）列出。
- 「每日 digest」：预览（bot `GET /bot/api/digest/preview`）+ 发送到 QQ
  （bot `POST /bot/api/digest/send`，`dry_run:false`，发送前 `ElMessageBox.confirm` 二次确认）。
- bot 不可达时页面顶部给明确提示「bot 未运行或不可达」，卡片显示默认值而不是白屏或空表格。

---

## 与后端的接口契约

前端跟**两个**服务说话，由 `vite.config.js` 的两条代理区分（dev 时）：

| 页面 / 用途 | 调谁 | 调用点 |
|---|---|---|
| 通知台 `/` | 后端 `/api/*` | `src/api/client.js` |
| 系统状态 `/health` | bot `/bot/api/*` | `src/api/bot.js` |

后端（纯数据层，前缀 `/api`）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/notifications` | 列表（`since` / `status` / `q` 可选） |
| GET | `/api/notifications/{id}` | 单条详情 + `raw` 原文 |
| POST | `/api/notifications/{id}/corrections` | 人工修正（`field` ∈ `title`/`summary`/`location`/`due_at`/`due_text`/`status`） |
| POST | `/api/notifications/{id}/read` | 已读状态 |
| GET | `/api/health` | **仅**用于系统状态页的「后端可达性」探针（存储自身健康） |
| GET | `/api/attachments/{id}` | 附件二进制（前端直接用 `attachments[].url` 这个相对路径） |

bot（前缀 `/bot`，代理层会摘掉 `/bot`）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/status` | OneBot / LLM / 白名单 / 流水线 / 盲区 / 群 / 缺口 / 后端可达性 / digest |
| GET | `/api/digest/preview` | digest 预览文本 |
| POST | `/api/digest/send` | 发送 digest（`dry_run`） |

已下线的接口（不要再用）：`GET /api/config/meta`、`/api/digest/*`（后端侧的）、
`POST /api/ingest/messages`、`POST /api/tasks/manual`；`/api/notifications` 响应里的
`blindspots` 字段也已删除（盲区改由 bot 的 `/api/status` 提供）。

时间戳统一为**毫秒 int**；`due_at` 为 `null` 表示未解析出确定时间。
所有请求带 `Authorization: Bearer <API_TOKEN>`——见上文「认证（API_TOKEN）」。

---

## 设计约束（改代码前请先读）

1. **时间展示一律走 `src/utils/time.js`**，不要在组件里散落 `new Date().toLocaleString()`。
2. **`due_at` 为 `null` 时只能显示 `due_text` 原文 + 「待确认」**，不允许猜测时间。
3. **任何解析结果旁边必须有 `evidence`**；卡片上直接可见，不能只放在详情里。
4. 后端缺席时**不允许白屏或未捕获异常**：`main.js` 有全局兜底，store 把异常翻译成中文文案，
   页面显示 `el-empty` + 明确提示。
