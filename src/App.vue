<template>
  <div class="xc-app">
    <!--
      布局与顶栏放在各自的 view 里，因为通知台和系统状态页的顶栏操作不同。
      这里只负责渲染路由出口。

      「/login 不显示 AppHeader」是靠**不引用**它实现的：公开页只有一个 LoginView，
      它自己不渲染 AppHeader；两个受保护页面各自 import 了 AppHeader。
      另外 AppHeader 内部也会对 `route.meta.public` 做一次兜底（见该组件），
      这样以后把公开页拆进别的布局也不会漏出顶栏。
    -->
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
  </div>
</template>

<script setup>
// 只需要一个路由出口，没有别的逻辑。
</script>

<style scoped>
.xc-app {
  min-height: 100%;
}
</style>
