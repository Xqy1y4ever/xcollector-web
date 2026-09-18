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
// 部署方只需要由自己的反向代理提供 **/api 一条**转发（指向后端）。
//
// ⚠️ **不要把 /bot 反代到公网。** 那是 bot 的管理接口，只认管理令牌（API_TOKEN），
// 拿到它等于拿到「以 bot 身份读写所有人的数据 + 直接往 QQ 发消息」的能力；
// 而它唯一的用途是给运营者看「系统状态」页 —— 运营者在本机直接看即可。
// 下面的 /bot 代理因此**只为本机调试运营者视图**而留：`npm run dev` 起来之后，
// 在状态页的「运营者访问」框里填管理令牌就能看到那一页。详见 .env.example 第 3 节。
//
// 反代 /api 要**原样转发**浏览器带的 Authorization 头（认证在前端登录页做，见 README「认证」）；
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
      // 只为本机调试运营者视图：bot 自己的路径是 /api/status、/api/digest/*，
      // 所以要把 /bot 前缀摘掉。**不要**把这条搬进生产反代。
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
