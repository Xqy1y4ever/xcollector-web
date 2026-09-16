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

## 目录结构

```
xcollector-web/
├── index.html                  # 入口 HTML
├── vite.config.js              # Vite 配置（含 /api → 127.0.0.1:8000 代理、@ 别名）
├── package.json
├── .gitignore
├── README.md
└── src/
    ├── main.js                 # 应用入口：Element Plus 全量注册 + 全量图标注册 + 全局兜底错误处理
    ├── App.vue                 # 路由出口
    ├── router/
    │   └── index.js            # 两个路由：/（通知台）、/health（系统状态）
    ├── api/
    │   └── client.js           # axios 实例 + 全部接口封装 + 错误中文化
    ├── stores/
    │   ├── notifications.js    # 通知列表 / 详情 / 修正 / 已读 / 盲区数据
    │   └── health.js           # 系统状态 / 配置快照 / digest 预览与发送
    ├── utils/
    │   ├── time.js             # 所有时间格式化与相对时间（禁止在组件里裸写 new Date().toLocaleString()）
    │   └── evidence.js         # evidence 在原文中的定位与高亮切片
    ├── styles/
    │   └── global.css          # 全局样式（卡片、evidence 块、状态点、盲区面板等）
    ├── views/
    │   ├── NotificationBoard.vue   # 通知台 /
    │   └── HealthView.vue          # 系统状态 /health
    └── components/
        ├── AppHeader.vue           # 顶栏：标题 / 连接状态点 / 刷新 / 最后同步时间
        ├── NotificationCard.vue    # 通知卡片（左侧大号 DDL + 右侧正文 + evidence 原文）
        ├── NotificationDetail.vue  # 详情抽屉（左「解析结果」可编辑 / 右「原文证据」）
        └── BlindSpotPanel.vue      # 盲区面板
```

---

## 界面说明

### 通知台 `/`

- **分组**：按 `due_at` 升序，分成「已过期 / 今天 / 本周 / 更晚 / 无确定时间」；空组不显示。
- **卡片左侧一列**是格式化后的大号 DDL（如 `09-12 周五 23:59`），下面小字是原文时间表达（如「下周三前」）。
- **卡片上直接摊开 `evidence` 原文**（等宽字体 + 左侧蓝边框 + 灰底，悬浮显示全文）。
  这是本产品的核心价值，**不藏在详情里**。
- 标签：`DDL 冲突`（红）/ `已人工确认`（绿）/ 未读蓝点 / 附件回形针 + 数量。
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

- 三张卡片：OneBot 连接、LLM 配置、今日流水线。
- 群列表用 `el-table`，**静默小时数 > 2 标黄并提示「可能掉线」**。
- 缺口告警逐条用 `el-alert`（warning）列出。
- 「每日 digest」：预览（`GET /api/digest/preview`）+ 发送到 QQ（`POST /api/digest/send`，`dry_run:false`，发送前 `ElMessageBox.confirm` 二次确认）。

---

## 与后端的接口契约

全部接口前缀 `/api`，调用点集中在 `src/api/client.js`：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/notifications` | 列表（`since` / `status` / `q` 可选） |
| GET | `/api/notifications/{id}` | 单条详情 + `raw` 原文 |
| POST | `/api/notifications/{id}/corrections` | 人工修正（`field` ∈ `title`/`summary`/`due_at`/`due_text`/`status`） |
| POST | `/api/notifications/{id}/read` | 已读状态 |
| GET | `/api/health` | 系统状态 |
| GET | `/api/digest/preview` | digest 预览文本 |
| POST | `/api/digest/send` | 发送 digest（`dry_run`） |
| GET | `/api/config/meta` | 白名单 / digest 时间等元配置 |

时间戳统一为**毫秒 int**；`due_at` 为 `null` 表示未解析出确定时间。

---

## 设计约束（改代码前请先读）

1. **时间展示一律走 `src/utils/time.js`**，不要在组件里散落 `new Date().toLocaleString()`。
2. **`due_at` 为 `null` 时只能显示 `due_text` 原文 + 「待确认」**，不允许猜测时间。
3. **任何解析结果旁边必须有 `evidence`**；卡片上直接可见，不能只放在详情里。
4. 后端缺席时**不允许白屏或未捕获异常**：`main.js` 有全局兜底，store 把异常翻译成中文文案，
   页面显示 `el-empty` + 明确提示。
