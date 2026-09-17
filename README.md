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

### 不想自己构建？直接拿 CI 的产物

推到 GitHub 后，`.github/workflows/dist.yml` 会构建一次，然后以**两种形式**发布
（部署机上因此**不需要装 Node**）：

**方式一：Release 附件**

```bash
curl -L https://github.com/Xqy1y4ever/xcollector-web/releases/latest/download/dist.tar.gz \
  | tar xz -C /var/www/xcollector
# → /var/www/xcollector/dist/

# 想校验完整性（可选）
curl -L .../dist.tar.gz.sha256 -o dist.tar.gz.sha256 && sha256sum -c dist.tar.gz.sha256
```

**方式二：GHCR 纯文件镜像**

```bash
docker pull ghcr.io/xqy1y4ever/xcollector-web:latest
docker create --name xcw ghcr.io/xqy1y4ever/xcollector-web:latest
docker cp xcw:/dist/. ./dist
docker rm xcw
```

> 这个镜像用 `FROM scratch`，里面**没有运行时、没有服务、没有 nginx**，
> 只是个能被 `pull`、能被 `cp` 的文件袋 —— 所以**不能 `docker run`**。
> 它存在的唯一理由是让已经在用 Docker 的人少装一个 Node。

两种形式发的是同一份产物，选顺手的即可。

**版本策略**：推 `main` 会滚动更新一个叫 `latest` 的预发布版本；
推 `v1.2.3` 这样的 tag 会出一个正式 Release。

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

## 认证：令牌存在浏览器里，先读这一段

后端所有 `/api` 都要求 `Authorization: Bearer <API_TOKEN>`（token 为空则后端不校验）。
**认证现在在前端做**：用户在登录页 `/login` 输入令牌，浏览器之后每次请求都带上它，
反向代理**原样转发**这个头。

> 这个仓库**不产出镜像、也不带 nginx**。它只负责 `npm ci && npm run build` 出 `dist/`，
> 由**你自己的 web server** 托管，并在那里加上 `/api` 与 `/bot` 两条反代
> （配置见下面「生产部署需要什么」）。认证就是在这个前提下由登录页承担的。

### 登录页怎么工作

- 用户输入的就是**后端的 `API_TOKEN`**（环境变量里的那一个）。
- 点「登录」时会**真的去校验**：调 `GET /api/health`（该接口要求认证）并带上这个令牌。
  - **200** → 登录成功。
  - **401 / 403** → 提示「token 不正确」，**不写入任何 storage**。
  - **网络错误 / 5xx** → **允许进入**，但给一条黄色警告（「后端不可达，无法验证 token」）。
    理由：后端挂着的时候，用户最需要看的就是系统状态页（那里正显示「后端不可达」）；
    把登录卡死反而让人没法诊断。
- 登录后令牌存在浏览器里：

  | 「记住我」 | 存在哪 | 效果 |
  |---|---|---|
  | 勾上（默认） | `localStorage` | 关掉浏览器也不用重新输 |
  | 不勾 | `sessionStorage` | 关掉标签页即登出 |

  两边用同一组 key（`xc.auth.token` / `xc.auth.botToken` / `xc.auth.remember`）。
  `restore()` 先看 `sessionStorage` 再看 `localStorage`，并且**切换「记住我」时会清掉另一边的残留**，
  避免「上次记住了、这次不记」却仍然自动登录。
- **同一个 token 同时用于 `/api` 和 `/bot`**：契约约定整套系统只有**一个共享密钥**，
  bot 在 `BOT_API_TOKEN` 为空时会回退用 `API_TOKEN` 校验。
  登录页「高级」里有一个可选的 bot 令牌输入框，**留空即与上面相同**；
  只有 bot 单独配了不同的 `BOT_API_TOKEN` 时才需要填。
- 任何请求收到 **401/403** 都会清空登录态（内存 + 两侧 storage）并跳回 `/login`，
  同时把原目标放进 `?redirect=`，登录成功后跳回原页面。

### 预置令牌（开发 / CI 降级路径）

`VITE_API_TOKEN` / `VITE_BOT_API_TOKEN` 仍然保留，作为**预置令牌**的降级路径：

| 变量 | 作用对象 | 何时生效 |
|---|---|---|
| `VITE_API_TOKEN` | 后端 `/api/*` | auth store 里没有令牌时用它 |
| `VITE_BOT_API_TOKEN` | bot `/bot/api/*` | store 里没有 bot 令牌时用它（一般留空即可） |

也就是说，在 `.env.local` 里写死 token 后**可以跳过登录页**（适合开发、CI、E2E）：

```
VITE_API_TOKEN=<与后端 API_TOKEN 相同的值>
```

注意 `import.meta.env.VITE_*` 是**构建期内联**的，改完必须重启 `npm run dev` / 重新 `npm run build`。
登录页写入的令牌优先于它。

### ⚠️ 这不是完整的鉴权，别把它当成安全措施

- **令牌存在浏览器 storage 里（明文）**。
  **任何能在这台浏览器上执行 JS 的东西都能读到它** —— XSS、恶意浏览器扩展、共用电脑上的下一个人。
  页面里如果有任何 XSS 注入点，令牌就会泄露，之后攻击者拿着它就能直接打后端和 bot。
- **这不是账号体系**：它是**一个共享密钥**，不是按用户的登录。
  **所有登录的人权限完全一样**，没有角色、没有审计、没法单独吊销某个人
  （要换密钥只能改后端 `API_TOKEN`，所有人一起重输）。
- **真正的边界仍然是：不要把后端和 bot 直接暴露到公网。**
  两者都应该只监听 `127.0.0.1`，或者只在内网 / 容器网络里可达。登录页只是把
  「端口一开谁都能进」变成「需要先知道密钥」。
- **要对外提供服务，必须再套一层真正的认证**（带登录态的 Nginx / Caddy / 网关 / SSO 等），
  由它做真实的鉴权、TLS 和访问控制，并把 `/api` 与 `/bot` 转发到内网的两个服务。

### 两种部署形态下，登录页的实际效力

| 部署形态 | `Authorization` 怎么处理 | 登录页 |
|---|---|---|
| `npm run dev`（vite dev 代理） | 代理原样转发浏览器带的头 | **生效** |
| 生产（你自己的 web server 反代） | `proxy_set_header Authorization $http_authorization;` 原样转发 | **生效** |
| 反代改成「注入服务端 token」 | `proxy_set_header Authorization "Bearer <token>";` 无条件覆盖 | **形同虚设**：不带 token 的请求也会被补上正确令牌，等于端口一开谁都能进 |

最后一种只在「完全可信的内网、不想每次输 token」时才有意义，那时应该把登录页
理解成一个摆设，而不是安全措施。

---

## 生产部署需要什么

`npm run build` 产出的是一个**纯静态站点**，它自己**不带任何代理**——
`vite.config.js` 里的 `/api` 和 `/bot` 代理**只在开发服务器上生效**。

所以你必须在一个 web server 上同时做三件事，而且它们**必须同源**
（同一个 host:port，否则浏览器会跨域）：

```nginx
root /path/to/dist;

location /     { try_files $uri $uri/ /index.html; }        # 静态文件 + SPA fallback
location /api/ { proxy_pass http://127.0.0.1:8000;  }       # → 后端，前缀保留
location /bot/ { proxy_pass http://127.0.0.1:8082/; }       # → bot，注意**摘掉** /bot 前缀
```

要点：

- **`/api` 的 `proxy_pass` 结尾不要带路径**。写成 `http://127.0.0.1:8000/api/`
  会把 `/api/notifications` 变成 `/api/api/notifications`，全线 404。
- **`/bot` 前缀要去掉**再转发（bot 自己的路径就是 `/api/status`、`/api/digest/*`），
  与 `vite.config.js` 里 dev 代理的 `rewrite` 行为一致。结尾的 `/` 就是干这个的。
- **原样转发 `Authorization` 头**（`proxy_set_header Authorization $http_authorization;`），
  否则登录页拿到的 token 会被丢掉。
- 反向代理是唯一能做**真实**鉴权的地方（见上一节）。
- 完整的 nginx 与 Caddy 配置片段见
  [`xcollector-deploy/README.md`](../xcollector-deploy/README.md) 的「托管 dist」一节。
- 如果前端与两个服务不同源，得改 `src/api/` 下的 baseURL 并自行处理 CORS ——
  **不推荐**，同源反代是更省事的做法。

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
    ├── main.js                 # 应用入口：Element Plus 全量注册 + 全量图标注册 + 全局兜底错误处理 + 挂载前恢复登录态
    ├── App.vue                 # 路由出口（登录页不渲染顶栏，见「认证」一节）
    ├── router/
    │   └── index.js            # 路由：/login（公开）、/（通知台）、/health（系统状态）+ 认证守卫
    ├── api/
    │   ├── client.js           # 后端 axios 实例（/api）+ 通知接口 + Authorization 拦截器 + 401 处理
    │   ├── bot.js              # bot axios 实例（/bot）+ status/digest 接口 + Authorization 拦截器
    │   ├── token.js            # 当前令牌的模块级持有者（store 写、拦截器读，用来打破循环依赖）
    │   └── errors.js           # 异常 → 中文文案（两个实例共用，含 401 指引）
    ├── stores/
    │   ├── auth.js             # 登录态：令牌 / 记住我 / restore / login（真校验）/ logout
    │   ├── notifications.js    # 通知列表 / 详情 / 修正 / 已读（数据来自后端）
    │   └── health.js           # bot 系统状态 + 后端可达性探针 + digest 预览与发送
    ├── utils/
    │   ├── time.js             # 所有时间格式化与相对时间（禁止在组件里裸写 new Date().toLocaleString()）
    │   ├── healthStatus.js     # bot /api/status 的纯映射（无 Vue 依赖，可直接跑断言）
    │   └── evidence.js         # evidence 在原文中的定位与高亮切片
    ├── styles/
    │   └── global.css          # 全局样式（卡片、evidence 块、状态点、盲区面板等）
    ├── views/
    │   ├── LoginView.vue           # 登录 /login（公开路由，输入后端 API_TOKEN）
    │   ├── NotificationBoard.vue   # 通知台 /
    │   └── HealthView.vue          # 系统状态 /health
    └── components/
        ├── AppHeader.vue               # 顶栏：标题 / 连接状态点 / 盲区角标 / 刷新 / 退出登录 / 最后同步时间
        ├── NotificationCard.vue        # 通知卡片（左侧大号 DDL + 右侧正文 + 标签）
        ├── NotificationDetail.vue      # 详情抽屉（左「解析结果」可编辑 / 右「原文证据」）
        ├── NotificationFormPanel.vue   # 详情里的修正表单
        └── NotificationEvidencePanel.vue # 原文证据块 + 附件 + 原始 JSON
```

---

## 界面说明

### 登录 `/login`

- 居中卡片，移动端占满可用宽度；「访问令牌」`type=password` + `show-password`，**回车即提交**。
- 可折叠的「高级」区：可选的 **bot 令牌**（留空则与上面相同）。
- 「记住我」默认勾上，标签写明「关掉浏览器也不用重新输」。
- 校验失败用红色 `el-alert`；后端不可达 / 5xx 用黄色 `el-alert` 提示但**仍然进入**。
- 底部小字说明「令牌存在浏览器里，只适合私有部署，别把端口暴露到公网」。
- 未登录访问任何受保护路由都会被守卫送到这里，并在 `?redirect=` 里记住原目标。

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
所有请求带 `Authorization: Bearer <API_TOKEN>`——见上文「认证：令牌存在浏览器里」。

---

## 设计约束（改代码前请先读）

1. **时间展示一律走 `src/utils/time.js`**，不要在组件里散落 `new Date().toLocaleString()`。
2. **`due_at` 为 `null` 时只能显示 `due_text` 原文 + 「待确认」**，不允许猜测时间。
3. **任何解析结果旁边必须有 `evidence`**；卡片上直接可见，不能只放在详情里。
4. 后端缺席时**不允许白屏或未捕获异常**：`main.js` 有全局兜底，store 把异常翻译成中文文案，
   页面显示 `el-empty` + 明确提示。
5. **令牌只在 `src/api/token.js` 这一个模块里持有**，由 `stores/auth.js` 写入。
   不要在组件或 api 模块里再 import auth store（那会形成循环依赖，见 `src/api/token.js` 的注释）。
