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
                    ┌─ /api/*  ──▶ xcollector-backend   （登录、注册、通知、订阅、信息源目录、附件）
浏览器 ──▶ dist ────┤
                    └─ /bot/*  ──▶ xcollector-bot       （系统状态、摘要预览 · **仅运营者**）
```

- **通知台**与**订阅管理**的数据全部来自后端，用你**自己的 UserToken**。
- **系统状态页**的数据来自 bot，用**运营者令牌**（`API_TOKEN`）。两者是两套凭据：
  bot 根本不认识 UserToken，而这一页里有所有人的盲区计数、白名单、OneBot 连接状态，
  本来就不该让普通用户看到。所以这一页要你把令牌填进去（只存本次标签页），
  没填时它显示「为什么看不到」而不是「bot 不可达」。
- 生产部署**只需要反代 `/api`**，`/bot` 不要暴露到公网（见「生产：托管 dist」）。

五条路由：

| 路由 | 是否要登录 | 内容 |
|---|---|---|
| `/login` | 否 | 粘贴登录令牌 |
| `/register` | 否 | 用 QQ 验证码注册 / 换取新令牌 |
| `/` | 是 | 通知台 |
| `/subscriptions` | 是 | 订阅管理 |
| `/health` | 是（另需运营者令牌） | 系统状态（运营者视图） |

未登录访问受保护路由会跳到登录页，并在 `?redirect=` 里记住原目标。

## 认证（多用户）

### 一句话：令牌就是账号

**没有单独的登录接口，UserToken 本身就是会话。** 整条链路是：

```
QQ 里给机器人发 /注册
        │  （机器人私聊回你一个 6 位验证码）
        ▼
/register 提交 QQ号 + 验证码 + 邀请码
        │  后端验证码校验通过 → 签发 UserToken（`xc_...`）
        ▼
  把令牌复制走（只显示这一次）
        │
        ▼
以后每次访问：登录页粘贴令牌 → GET /api/me 校验 → 进应用
```

| 令牌 | 谁持有 | 能做什么 |
|---|---|---|
| **UserToken（`xc_...`）** | 每个用户自己 | 读自己的通知、提交人工修正、标记已读、管理自己的订阅 |
| ServiceToken（`API_TOKEN`） | **只有 bot** | 全部（含入库、改机器字段、删除、签发验证码与邀请码） |

- 前端的**所有** `/api/*` 请求都带 `Authorization: Bearer <UserToken>`，
  由 `src/api/client.js` 的请求拦截器统一加头。
- 令牌同时是登录凭证和调用凭证，后端从它定出 `user_id`，数据按 `user_id` 隔离。
- ⚠️ **ServiceToken 永远不该出现在前端**。登录时如果 `/api/me` 回的是
  `"scope":"service"`，登录页会直接拒绝并说明原因。旧版本那两个用于跳过登录页的
  预置令牌（`VITE_API_TOKEN` / `VITE_BOT_API_TOKEN`）已经**删掉**，不要加回来：
  多用户之后能填的只有服务令牌，那等于把「读写所有人的数据」明文烧进 JS bundle。

### 注册（这一页为什么这么写）

- **验证码不能由前端申请**：`POST /api/verify/request` 只认服务令牌，
  否则任何人知道别人的 QQ 号就能一直刷新他的验证码（拒绝服务 + 拉长猜测窗口）。
  所以流程只能是「**用户先找机器人**」—— 机器人也发不出陌生人的私聊。
  注册页把这三步写在了最显眼的位置。
- 返回的 `token` 是明文、**只显示这一次**（库里只存 sha256）。注册页会停在原地，
  逼用户复制走，并说明「丢了就再走一遍同样的流程换一个新的」。
- 同一个 QQ 再注册一次 = **轮换令牌**（不是报错）。旧令牌立刻失效。
  服务端关掉轮换时返回 409，注册页会把后端的原话显示出来。
- `invite_code` 只在服务端开启邀请制时必填（`SIGNUP_MODE=invite`）。
  前端不做「该不该要」的判断，留空就不发这个字段。

### 令牌丢了 / 换设备

回 QQ 给机器人发一次 `/注册` 拿新验证码，再走一遍 `/register` 即可。
没有邮箱、没有密保 —— 能证明身份的还是那个 QQ 号。

### 令牌存在哪、有多安全

勾「记住我」→ `localStorage`；不勾 → `sessionStorage`（关掉标签页即登出）。
**它是明文存在浏览器里的，任何能在这台浏览器上执行 JS 的东西都能读到它**，
XSS 会泄露它。所以：

- 别在公共电脑上勾「记住我」；
- 这是自用/小圈子部署的东西，**不要把后端直接暴露到公网**；
  对外提供服务请上 HTTPS，并在前面套一层真正的认证（带登录的反向代理 / VPN / Tailscale）。

登录态失效有两条路径，都会把人送回登录页并保留原目标：
启动时（`main.js`）与路由守卫各校验一次 `GET /api/me`，以及任意请求返回 **401**。
**403 不登出**：那表示「令牌有效但没这个权限」（用户令牌碰上 bot 专属接口），
把人踢去重输一遍还是 403，只会让人更糊涂。

后端不可达 / 5xx 时**不清理登录态**，也允许进入应用 —— 那时候用户最需要看的
就是系统状态页（正显示「后端不可达」），把登录卡死反而没法诊断。登录页会明确提醒
「这次没能校验令牌」。

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
- **原样转发 `Authorization` 头**。反代里**不要**无条件注入服务端令牌 ——
  那会让每个能打开页面的人都变成 bot，登录页也就形同虚设。

完整的 nginx 与 Caddy 配置见
[`xcollector-deploy`](https://github.com/Xqy1y4ever/xcollector-deploy#托管-dist) 的「托管 dist」一节。

## 页面

| 页面 | 内容 |
|---|---|
| `/login` | 粘贴登录令牌，可勾选「记住我」；带注册入口 |
| `/register` | 三步说明 + QQ号/验证码/邀请码/显示名 → 显示令牌（只显示一次） |
| `/` 通知台 | 按截止时间分组的任务卡片、详情抽屉、人工修正、已读切换 |
| `/subscriptions` 订阅管理 | 我的订阅列表、启用开关、删除、从信息源目录里挑着新增 |
| `/health` 系统状态 | OneBot 连接、流水线计数、后端可达性、盲区与缺口、摘要预览 |

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

**订阅管理**的订阅最小单位是 **(群, 发送者)**：

- **没有「订整个群」这个选项**，界面上也不提供 —— 后端会返回 400
  （三层堵死：表结构 `sender_id NOT NULL`、拒绝 `*` / `全部` 这类通配符、群号与 QQ 号形状校验）。
  订了「整个群」等于把群里所有人的闲聊都拉进来，误报和 LLM 消耗会一起失控。
- 「从信息源目录里挑」调 `GET /api/sources`：这套部署**见过**的 (群, 发送者) 组合。
  新用户注册完手上什么都没有、也不知道群号，没有这份目录就无从订阅。
  代价说清楚：只有 bot 实际处理过的来源才会出现在这里。
- 群号 / 发送者 QQ 号前端也做一次形状校验（与后端口径一致）。
  订阅写错**不会报错，只会安静地什么都收不到** —— 那是最难发现的一类故障，
  所以在入口就拦。

## 配置

| 变量 | 说明 |
|---|---|
| `XCOLLECTOR_BACKEND` | 开发时代理的后端地址，默认 `http://127.0.0.1:8000` |
| `XCOLLECTOR_BOT` | 开发时代理的 bot 地址，默认 `http://127.0.0.1:8082` |
| `VITE_API_BASE` | 后端请求前缀，默认同源 `/api`（前后端不同源部署时才需要改） |
| `VITE_BOT_BASE` | bot 请求前缀，默认同源 `/bot` |

前两个是 `vite.config.js` 用 `process.env` 读的，**写进 `.env.local` 不会生效** ——
Vite 只注入 `VITE_` 前缀的变量，要用得设成真实的环境变量。`VITE_*` 是**构建期内联**的，
改完必须重新构建，热更新不会生效。

**没有预置令牌这一项了。** 旧版本的 `VITE_API_TOKEN` / `VITE_BOT_API_TOKEN` 已经删除，
不要再加回来（理由见上面的「认证」一节）。需要脚本化访问时用某个用户令牌直接调后端 API。

`.env.example` 里有每一项的详细说明。

## 接口

| 后端 `/api/*` | 用途 |
|---|---|
| `GET /api/me` | 登录检查 + 「我是谁」（**唯一**能区分用户令牌与服务令牌的接口） |
| `POST /api/register` | 注册 / 轮换令牌（**公开，不带 Authorization**） |
| `GET /api/notifications` | 通知列表 |
| `GET /api/notifications/{id}` | 详情 + 原文 |
| `POST /api/notifications/{id}/corrections` | 提交人工修正 |
| `POST /api/notifications/{id}/read` | 已读 / 未读 |
| `GET /api/subscriptions` | 我的订阅（`include_disabled=false` 只看启用的） |
| `POST /api/subscriptions` | 新增订阅（`group_id` + `sender_id` 都必填） |
| `PATCH /api/subscriptions/{id}` | 改 `enabled` / `note` / 名字 |
| `DELETE /api/subscriptions/{id}` | 删除订阅 |
| `GET /api/sources` | 信息源目录（可订的 (群, 发送者)） |
| `GET /api/health` | 后端可达性探针，`counts` 按当前用户算 |
| `GET /api/attachments/{id}` | 附件（图片与下载，走短时效签名 URL） |

| bot `/bot/api/*` | 用途 |
|---|---|
| `GET /api/status` | 系统状态页的数据 |
| `GET /api/digest/preview` | 预览摘要文本 |

> 网页上**不再提供**「立即发送摘要到 QQ」：那个操作只认服务令牌，
> 而服务令牌不该出现在浏览器里。需要补发请在服务器上用 bot 的接口。

时间戳统一是**毫秒整数**，`due_at` 为 `null` 表示没解析出确定时间。
完整的请求/响应约定见
[`xcollector-backend/docs/api.md`](https://github.com/Xqy1y4ever/xcollector-backend/blob/main/docs/api.md)。
