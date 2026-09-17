/**
 * 路由导航的**模块级持有者**——与 `src/api/token.js` 同样的破环手法。
 *
 * 为什么需要它：
 *   401 之后 `api/client.js` 要把用户送回 `/login`，但它不能静态 import `router/index.js`：
 *   那个文件会静态 import 三个 `.vue`，而 store → client → router → view → store 会成环。
 *   于是这里放一个「谁来都能用的 replace 句柄」：
 *     - `router/index.js` 建好 router 后**注册**进来（`registerRouter`）；
 *     - `api/client.js` 在 401 时直接调用 `replaceTo`，不做任何动态 import。
 *
 * 好处：错误处理路径上不再有动态 import（不会因为 chunk 加载失败而断掉退路），
 * 依赖方向也始终单向：`client.js → navigation.js ← router/index.js`。
 */

/** @type {{ replace: (to: any) => unknown } | null} */
let routerRef = null

/** 仅供断言使用的替身（见文件末尾的 setReplaceImplForTest / resetReplaceImplForTest） */
let testImpl = null

/** 由 `router/index.js` 在 createRouter 之后调用一次 */
export function registerRouter(router) {
  routerRef = router
}

/** router 还没注册好时（极早期）的兜底：整页跳转 */
function hardRedirect(path) {
  try {
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = path
    }
  } catch (e) {
    // 连 location 都写不了就只能作罢，调用方不该因为跳转失败而抛异常
  }
}

/**
 * 跳转到某个站内路径。
 * @param {any} to vue-router 的 location（字符串或对象）
 * @returns {boolean} 是否交给了 vue-router（false = 走了整页跳转兜底）
 */
export function replaceTo(to) {
  if (testImpl) {
    testImpl(to)
    return true
  }
  if (routerRef && typeof routerRef.replace === 'function') {
    routerRef.replace(to)
    return true
  }
  hardRedirect(typeof to === 'string' ? to : (to && to.path) || '/')
  return false
}

/** 测试用：判断 router 是否已注册 */
export function hasRouter() {
  return !!routerRef
}

/*
 * 下面两个只给断言脚本用。ESM 的模块命名空间是只读的，测试没法直接改写 replaceTo，
 * 所以留一个显式的替身入口，好过为测试改动生产代码结构。
 */
export function setReplaceImplForTest(fn) {
  testImpl = typeof fn === 'function' ? fn : null
}

export function resetReplaceImplForTest() {
  testImpl = null
}
