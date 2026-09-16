import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 全项目统一的移动端断点（与 CSS 里所有 `@media (max-width: 768px)` 保持一致）。
 *
 * 只做一件事：把 `window.matchMedia('(max-width: 768px)')` 变成一个响应式的
 * `ref<boolean>`，并且在组件卸载时**必定**移除监听，避免热更新/路由切换后
 * 累积一堆悬空 listener。
 *
 * 刻意不引入任何第三方响应式库：这个需求一个 matchMedia 就够了。
 *
 * @param {string} [query] 默认 768px 断点
 * @returns {import('vue').Ref<boolean>}
 */
export function useIsMobile(query = '(max-width: 768px)') {
  const hasWindow = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const mql = hasWindow ? window.matchMedia(query) : null
  const isMobile = ref(mql ? mql.matches : false)

  /** 兜底：极老的浏览器没有 addEventListener，只有 addListener */
  const supportsModernApi = !!(mql && typeof mql.addEventListener === 'function')

  function onChange(event) {
    isMobile.value = !!event.matches
  }

  onMounted(() => {
    if (!mql) return
    // 挂载时再对齐一次：SSR / 首屏竞态下初始值可能与当前不一致
    isMobile.value = !!mql.matches
    if (supportsModernApi) mql.addEventListener('change', onChange)
    else if (typeof mql.addListener === 'function') mql.addListener(onChange)
  })

  onBeforeUnmount(() => {
    if (!mql) return
    if (supportsModernApi) mql.removeEventListener('change', onChange)
    else if (typeof mql.removeListener === 'function') mql.removeListener(onChange)
  })

  return isMobile
}

export default useIsMobile
