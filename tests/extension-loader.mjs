/**
 * 让 node 能解析**不带扩展名的相对导入**（`from '../api/client'`）。
 *
 * 仓库里的源码是写给 vite 的：vite 自己会把 `'../api/client'` 补成 `.js`。
 * 而 node 的 ESM 解析要求写全扩展名，于是 `tests/store-check.mjs` 直接跑不起来。
 * 这个 hook 只补扩展名，不改任何语义 —— 它**只给仓库自检用**，不参与构建、
 * 也不进 dist。
 *
 * 用法（见 package.json 的 test:store）：
 *
 *     node --import ./tests/extension-loader.mjs tests/store-check.mjs
 */

import { register } from 'node:module'

register('./extension-resolver.mjs', import.meta.url)
