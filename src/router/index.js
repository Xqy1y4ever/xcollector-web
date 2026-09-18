import { createRouter, createWebHistory } from 'vue-router'

import { authGuard } from './authGuard'
import { registerRouter } from './navigation'
import NotificationBoard from '../views/NotificationBoard.vue'
import HealthView from '../views/HealthView.vue'
import LoginView from '../views/LoginView.vue'
import RegisterView from '../views/RegisterView.vue'
import SubscriptionsView from '../views/SubscriptionsView.vue'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: LoginView,
    // public: true = 无需认证即可访问；AppHeader 也靠它做「公开页不渲染顶栏」的兜底
    meta: { title: '登录', public: true }
  },
  {
    path: '/register',
    name: 'register',
    component: RegisterView,
    // 注册也是公开页：注册的前提就是「还没有令牌」
    meta: { title: '注册', public: true }
  },
  {
    path: '/',
    name: 'board',
    component: NotificationBoard,
    meta: { title: '通知台' }
  },
  {
    path: '/subscriptions',
    name: 'subscriptions',
    component: SubscriptionsView,
    meta: { title: '订阅管理' }
  },
  {
    path: '/health',
    name: 'health',
    component: HealthView,
    meta: { title: '系统状态' }
  },
  {
    // 兜底：未知路径回通知台，避免出现空白路由。
    // 未登录时 / 会被守卫再拦到 /login，所以这里只写 redirect 就够了。
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 守卫实现单独放在 ./authGuard.js（纯函数，不依赖 vue-router 的运行时），
// 这样它可以在不启动构建的前提下直接被断言覆盖。
router.beforeEach(authGuard)

// 把 router 注册给 api 层的「导航持有者」：401 时 client.js 需要跳 /login，
// 但它不能 import 本文件（会成环）。详见 ./navigation.js 的注释。
registerRouter(router)

router.afterEach((to) => {
  const title = to.meta && to.meta.title ? to.meta.title : ''
  document.title = title ? `${title} · Xcollector` : 'Xcollector'
})

export default router
