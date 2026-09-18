/**
 * 只补扩展名的 resolve hook（配合 tests/extension-loader.mjs 使用）。
 *
 * 与 `src/` 里的代码无关：这是**测试**要的东西（node 的 ESM 解析要求写全扩展名，
 * 而仓库源码是写给 vite 的）。找不到才补，找到原样返回。
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CANDIDATES = ['.js', '.mjs', '/index.js']

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    if (!relative || !err || err.code !== 'ERR_MODULE_NOT_FOUND') throw err
    const base = new URL(specifier, context.parentURL)
    for (const suffix of CANDIDATES) {
      const candidate = new URL(base.href + suffix)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true }
      }
    }
    throw err
  }
}
