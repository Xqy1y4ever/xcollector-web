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
useAuthStore().restore()

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
