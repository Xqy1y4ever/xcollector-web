# Xcollector Web · 官方通知控制台

把 QQ 官方通知群里的消息，以「**含截止时间的任务条目**」的形式展示出来，
让群里的通知不会因为刷屏而被漏掉。每条解析结果旁边都能对照它依据的**原文**。

- 技术栈：Vue 3（Composition API）· Vite · Element Plus · Pinia · axios
- 产物：**纯静态站点**（`dist/`）。这个仓库**不产出可运行的镜像、也不带 nginx** ——
  由你自己的 web server 托管，并加一条 `/api` 反代
- 五条路由：`/login`、`/register`、`/`（通知台）、`/subscriptions`、`/health`（运营者视图）

通知台上值得一提的两件事：

- **列表每 60 秒自动增量刷新**：只向服务端要"上次之后变更过的条目"（`since` = 已见过的
  最大 `updated_at`，往回重叠 2 秒防同毫秒漏条），然后**按 id 合并**进现有列表 ——
  不整体替换。整体替换会让页面上的任务在每次自动刷新后"消失"（手动刷新又回来），
  这类 bug 由 `npm test`（`tests/store-check.mjs`）守着。
- **多选与批量操作**：工具栏上的「多选」进入勾选模式，选中若干条之后可以
  **标记已读 / 标记未读 / 标记完成 / 归档**。批量操作会如实报"成功几条、失败几条"，
  失败的条目留在选中状态里方便重试。

## 自检

```bash
npm ci
npm test        # store：增量合并、多选、批量操作（进程内跑真代码，不需要后端）
```

`npm test` 不替代 `npm run build`，但它是**唯一**能抓住"增量刷新丢条目"这类
眼睛看不见的错的地方（要等一轮自动刷新才显形）。CI（`.github/workflows/dist.yml`）
在构建之前先跑它，跑不动就不出包。

前端只跟**两个**服务说话：

```
                    ┌─ /api/* ──▶ xcollector-backend  （登录、注册、通知、订阅、附件）
浏览器 ──▶ dist ────┤
                    └─ /bot/* ──▶ xcollector-bot      （系统状态 · **仅运营者，别反代到公网**）
```

> 整套系统怎么部署见
> [`xcollector-deploy`](https://github.com/Xqy1y4ever/xcollector-deploy) 的 README。
> 本文只讲前端自己怎么构建与托管。

## 部署

### 1. 拿到 dist

**方式一：Release 附件**（部署机上不需要装 Node）

```bash
curl -L https://github.com/Xqy1y4ever/xcollector-web/releases/download/latest/dist.tar.gz \
  | tar xz -C /var/www/xcollector
# → /var/www/xcollector/dist/
```

**方式二：GHCR 的文件镜像**（已经在用 Docker 的话）

```bash
docker pull ghcr.io/xqy1y4ever/xcollector-web:latest
docker create --name xcw ghcr.io/xqy1y4ever/xcollector-web:latest
docker cp xcw:/dist/. /var/www/xcollector/dist/
docker rm xcw
```

> 这个镜像是 `FROM scratch` 的**文件袋**，里面没有 shell / 运行时 / nginx，
> **不能 `docker run`**，只能 `docker cp` 把 `dist/` 拿出来。

**方式三：自己构建**

```bash
npm ci
npm run build          # 产物在 dist/
```

想固定版本就把 URL 里的 `latest` 换成 `v1.2.3` 那样的 tag。

### 2. 配置（可选）

前端**没有必须配的项**：默认请求同源的 `/api` 与 `/bot`（见
[`src/api/client.js`](src/api/client.js)）。完整说明见 [`.env.example`](.env.example)。

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_API_BASE` | `/api` | 后端接口前缀。只有「前后端不同源、又确实要直连」时才改（那时还得自己处理 CORS） |
| `VITE_BOT_BASE` | `/bot` | bot 接口前缀（只用在那一个运营者状态页上） |
| `XCOLLECTOR_BACKEND` | `http://127.0.0.1:8000` | **只影响 `npm run dev` 的代理**；要用真实环境变量设，写进 `.env` 里不生效 |
| `XCOLLECTOR_BOT` | `http://127.0.0.1:8082` | 同上 |

⚠️ `VITE_*` 是**构建期**内联进产物的，改了必须重新 `npm run build`。
**不要**往构建产物里塞任何令牌（历史上那两项 `VITE_API_TOKEN` 已经删除）——
那等于把「读写所有人的数据」明文发给每个能打开页面的人。用户身份只有一个来源：
登录页粘贴、或注册时拿到的 `UserToken`。

### 3. 托管 dist

产物是纯静态站点，关键是两条规则：

| 路径 | 动作 |
|---|---|
| `/` | 静态文件；找不到就回 `index.html`（SPA 路由） |
| `/api/` | 反代到 `127.0.0.1:8000`，**前缀保留**，**原样转发 `Authorization`** |

> **不要加 `/bot/` 反代**：那是 bot 的管理接口，只认管理令牌，拿到它就等于拿到
> 「以 bot 身份读写所有人的数据 + 直接往 QQ 发消息」的能力。要在浏览器里看那一页，
> 就只在**本机**跑 `npm run dev`（dev 代理保留了 `/bot`）。

> **不要限制成只允许 GET**：注册（`POST /api/register`，且**不带令牌**）、订阅增删改、
> 人工修正、标记已读都是写操作，权限由后端的 UserToken 判定。

#### nginx

```nginx
server {
    listen 80;
    server_name _;
    root /path/to/xcollector-web/dist;
    index index.html;
    client_max_body_size 8m;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    location / {
        try_files $uri $uri/ /index.html;      # SPA fallback
    }
    location /api/ {
        proxy_pass http://127.0.0.1:8000;       # 结尾不带 /，前缀保留
        proxy_set_header Host $host;
        # 每个用户自己的 UserToken 就在这个头里，必须原样转发
        proxy_set_header Authorization $http_authorization;
    }
}
```

#### Caddy

```caddy
:80 {
    root * /path/to/xcollector-web/dist
    encode gzip
    handle /api/* {
        reverse_proxy 127.0.0.1:8000
    }
    handle {
        try_files {path} /index.html
        file_server
    }
}
```

Caddy 默认就会转发 `Authorization`，不用额外配置。

### 4. 本机 / 局域网看

```bash
npm ci
npm run dev            # http://127.0.0.1:5173，已内置 /api 与 /bot 代理
```

配合 Tailscale 之类的内网工具就能从手机访问。

### 确认在跑

打开页面 → 用 QQ 给机器人发 `/注册` 拿验证码 → 在 `/register` 上完成注册
（需要邀请码时，由运营者用 `API_TOKEN` 调 `POST /api/invites` 签发）。
注册成功后会自动登录到通知台。

## 许可

MIT
