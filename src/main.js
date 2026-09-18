import { createApp } from 'vue'
import { createPinia } from 'pinia'

import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

import './styles/global.css'

const app = createApp(App)

// Element Plus 全量引入（不做按需引入）
app.use(ElementPlus, { locale: zhCn })

// 全量注册图标组件，模板里可直接用 <Refresh /> <Paperclip /> 等
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.use(createPinia())
app.use(router)

// 挂载前先恢复登录态：令牌存在 sessionStorage / localStorage 里，刷新页面时
// Pinia state 还是空的。不先恢复的话，路由守卫会把已登录的人当成未登录踢去 /login。
// 这一步同时把令牌同步给请求层（src/api/token.js 的模块级持有者）。
// 注意：必须在 app.use(createPinia()) 之后调用，否则没有 active pinia。
const authStore = useAuthStore()
authStore.restore()

// 有令牌就**真的去问一次后端「我是谁」**（GET /api/me）。
// 这是「粘贴一个坏令牌 / 令牌已被轮换」的唯一发现时机：401 时请求层会清掉登录态
// 并跳回登录页；只是后端不可达的话不做任何处理（否则后端一挂，所有人都被踢出去）。
// 不 await：让首屏立刻出来，校验结果异步生效。
// 路由守卫会在首屏再触发一次同样的校验，store 里把并发调用收敛成同一个请求。
if (authStore.isAuthenticated) {
  authStore.verifySession().catch(() => {
    // 校验链路自己已经处理了 401；这里只是不让它变成未处理的 Promise 拒绝
  })
}

// 兜底：任何未捕获异常都不允许把页面打成白屏
app.config.errorHandler = (err, _vm, info) => {
  // eslint-disable-next-line no-console
  console.error('[xcollector] 未捕获的组件异常:', err, info)
}

window.addEventListener('unhandledrejection', (event) => {
  // eslint-disable-next-line no-console
  console.error('[xcollector] 未处理的 Promise 拒绝:', event.reason)
})

app.mount('#app')
