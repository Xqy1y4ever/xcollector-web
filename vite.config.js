import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 两个上游服务：开发时通过 dev 代理转发，前端只请求同源的 /api 与 /bot，无 CORS 问题。
// 后端换地址只改这里（或改 src/api/client.js 里的 baseURL）。
// 契约见 xcollector-backend/docs/api.md 第 9 节：
//   /api  → 后端（纯数据层：通知、附件、群、缺口、统计）
//   /bot  → bot（OneBot 连接、LLM 配置、盲区、digest），前缀在代理层 rewrite 掉
//
// ⚠️ 这里的两条代理**只在 `npm run dev` 的开发服务器上生效**。
// 生产构建（`npm run build` 产出的 dist/）是一个纯静态站点，不带任何代理：
// 部署方必须由自己的反向代理（Nginx / Caddy / 网关等）提供 /api 与 /bot 两条转发，
// 分别指向后端与 bot，且 /bot 同样要**摘掉 `/bot` 前缀**（bot 自己的路径就是 /api/status、/api/digest/*）。
// 反向代理要**原样转发**浏览器带的 Authorization 头（认证在前端登录页做，见 README「认证」一节）；
// 不要在代理里无条件注入服务端 token，否则前端登录就形同虚设。
// 反代同时是唯一能做「真正的鉴权 / TLS / 访问控制」的地方。
const BACKEND_TARGET = process.env.XCOLLECTOR_BACKEND || 'http://127.0.0.1:8000'
const BOT_TARGET = process.env.XCOLLECTOR_BOT || 'http://127.0.0.1:8082'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true
      },
      // bot 自己的接口路径是 /api/status、/api/digest/*，所以要把 /bot 前缀摘掉
      '/bot': {
        target: BOT_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/bot/, '')
      }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  }
})
