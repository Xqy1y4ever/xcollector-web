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

# 这两个 ARG 是给「不用 docker、直接 npm run build」的场景留的。
# 在 Docker 部署下**不需要填**：nginx 会在代理时注入 Authorization 头，
# token 因此不必进 bundle（比塞进前端安全得多）。
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
