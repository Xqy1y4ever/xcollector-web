<template>
  <div class="xc-app">
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
  </div>
</template>

<script setup>
// 布局与顶栏放在各自的 view 里，因为通知台和系统状态页的顶栏操作不同。
// 这里只负责渲染路由出口。
</script>

<style scoped>
.xc-app {
  min-height: 100%;
}
</style>
