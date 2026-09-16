import { createApp } from 'vue'
import { createPinia } from 'pinia'

import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'

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
