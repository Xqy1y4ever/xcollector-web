import { createRouter, createWebHistory } from 'vue-router'

import NotificationBoard from '../views/NotificationBoard.vue'
import HealthView from '../views/HealthView.vue'

const routes = [
  {
    path: '/',
    name: 'board',
    component: NotificationBoard,
    meta: { title: '通知台' }
  },
  {
    path: '/health',
    name: 'health',
    component: HealthView,
    meta: { title: '系统状态' }
  },
  {
    // 兜底：未知路径回通知台，避免出现空白路由
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.afterEach((to) => {
  const title = to.meta && to.meta.title ? to.meta.title : ''
  document.title = title ? `${title} · Xcollector` : 'Xcollector'
})

export default router
