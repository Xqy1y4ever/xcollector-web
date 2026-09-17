# 前端：构建成静态站点，由 nginx 提供，并代理 /api 与 /bot
#
# 注意这个镜像同时承担了「静态服务」和「反向代理」两个角色 —— 因为生产环境
# 必须有人把 /api 转到后端、把 /bot 转到 bot（vite 的 dev 代理只在开发时生效）。

FROM node:20-alpine AS build
WORKDIR /app

# 先装依赖，改源码不会让这层失效
COPY package*.json ./
RUN npm ci

COPY . .

# 这两个 ARG 是「预置令牌」的降级路径（不想用登录页时的开发/CI 场景）。
#
# Docker 部署下**保持留空**：认证由登录页承担，用户输入的 token 存在浏览器里，
# nginx 在代理时**原样转发**浏览器带的 Authorization 头（见 nginx.conf.template），
# 所以 token 不必进 bundle。
#
# ⚠️ 一旦填了，构建后 token 会**明文躺在 dist/assets/*.js 里** ——
#    任何能打开页面的人都能读到。它不是安全边界。
ARG VITE_API_TOKEN=""
ARG VITE_BOT_API_TOKEN=""
ENV VITE_API_TOKEN=${VITE_API_TOKEN} \
    VITE_BOT_API_TOKEN=${VITE_BOT_API_TOKEN}

RUN npm run build

FROM nginx:1.27-alpine

# 官方 nginx 镜像的 entrypoint 会把 /etc/nginx/templates/*.template 用 envsubst
# 渲染到 /etc/nginx/conf.d/。它只替换**环境里真实存在**的变量，
# 所以 nginx 自己的 $host / $uri / $remote_addr 不会被误伤。
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD \
  wget -q -O /dev/null http://127.0.0.1/ || exit 1
