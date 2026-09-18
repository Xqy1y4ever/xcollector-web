<template>
  <div class="xc-login">
    <div class="xc-login__box">
      <div class="xc-login__brand">
        <el-icon class="xc-login__logo"><Bell /></el-icon>
        <div class="xc-login__brand-text">
          <div class="xc-login__title">Xcollector · 官方通知</div>
          <div class="xc-login__subtitle">粘贴你的登录令牌后进入通知台</div>
        </div>
      </div>

      <el-card shadow="never" class="xc-login__card">
        <!-- 令牌不对 / 是服务令牌 / 后端出错：都不放行 -->
        <el-alert
          v-if="errorText"
          type="error"
          :closable="false"
          show-icon
          :title="errorText"
          style="margin-bottom: 14px"
        />

        <!-- 后端不可达 / 5xx：给黄色提示，但**仍然进入**（后端挂着时状态页正是要看的） -->
        <el-alert
          v-if="warningText"
          type="warning"
          :closable="false"
          show-icon
          :title="warningText"
          style="margin-bottom: 14px"
        />

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          @submit.prevent="submit"
        >
          <!-- 回车即提交：el-input 的 native form submit 会被 @submit.prevent 接住 -->
          <el-form-item prop="token" class="xc-login__item">
            <template #label>
              <span class="xc-login__label">登录令牌</span>
            </template>
            <el-input
              v-model="form.token"
              type="password"
              size="large"
              show-password
              clearable
              autocomplete="current-password"
              placeholder="xc_ 开头的那串令牌"
              :disabled="submitting"
            />
            <div class="xc-login__hint">
              就是你<strong>注册时拿到的那串</strong> <span class="xc-mono">xc_...</span> 令牌。
              它既是登录凭证，也是这台浏览器访问后端的凭证。
            </div>
          </el-form-item>

          <el-form-item class="xc-login__item">
            <el-checkbox v-model="form.remember" :disabled="submitting">
              记住我（关掉浏览器也不用重新粘）
            </el-checkbox>
            <div class="xc-login__hint">
              勾上＝存在 localStorage；不勾＝只存在本次标签页（关掉标签页即登出）
            </div>
          </el-form-item>

          <el-button
            type="primary"
            size="large"
            style="width: 100%"
            native-type="submit"
            :loading="submitting"
            @click="submit"
          >
            {{ submitting ? '正在校验令牌…' : '登录' }}
          </el-button>
        </el-form>

        <div class="xc-login__switch">
          还没有令牌？
          <router-link to="/register" class="xc-login__link">去注册 / 换一个新令牌</router-link>
        </div>

        <div class="xc-login__footer">
          <p>
            <strong>令牌丢了怎么办</strong>：没有邮箱、也没有密保，能证明身份的还是那个 QQ 号。
            所以在 QQ 上给机器人发一次 <span class="xc-mono">/注册</span> 拿到新验证码，
            再走一遍注册页，就会<strong>给你换一个新令牌</strong>（旧的立刻失效）。
          </p>
          <p>
            令牌是明文存在这台浏览器的 storage 里的，
            <strong>任何能在这台浏览器上执行 JS 的东西都能读到它</strong>，
            所以别在公共电脑上勾「记住我」。
          </p>
          <p>
            <strong>不要把服务端令牌（<span class="xc-mono">API_TOKEN</span>）填在这里</strong>：
            那是 bot 专用的，能读写所有人的数据，前端会直接拒绝它。
          </p>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Bell } from '@element-plus/icons-vue'

import { useAuthStore } from '../stores/auth'

/**
 * 登录页。
 *
 * 没有单独的登录接口：**UserToken 本身就是会话**。所以这里是
 * 「粘贴令牌 → `GET /api/me` 校验 → 通过就进应用」。
 *
 * 三种失败要分开处理：
 *   - 401（令牌无效/已过期）→ 不放行，提示重新获取；
 *   - 200 但 `scope=service`（粘了服务端令牌）→ 不放行，说清楚这是 bot 的令牌；
 *   - 后端不可达 / 5xx → **仍然放行**。后端挂着的时候用户最需要看的就是状态页
 *     （那里正显示「后端不可达」），把登录卡死反而让人没法诊断。
 */
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const formRef = ref(null)
const submitting = ref(false)
const errorText = ref('')
const warningText = ref('')

/** 默认勾上「记住我」：这是个自用控制台，天天粘令牌很烦 */
const form = ref({ token: '', remember: true })

const rules = {
  token: [
    {
      validator: (_rule, value, callback) => {
        if (typeof value === 'string' && value.trim()) callback()
        else callback(new Error('请输入登录令牌'))
      },
      trigger: 'blur'
    }
  ]
}

/**
 * 登录成功后的落地页：只接受站内相对路径。
 * `?redirect=//evil.com` 会被浏览器当成协议相对地址，直接 push 出去就是开放重定向。
 */
const redirectTarget = computed(() => {
  const raw = route.query && route.query.redirect ? String(route.query.redirect) : ''
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  // 回到 /login 或 /register 会再被守卫弹回首页，不如直接给 '/'
  if (raw === '/login' || raw.startsWith('/login?') || raw === '/register') return '/'
  return raw
})

async function submit() {
  if (submitting.value) return
  errorText.value = ''
  warningText.value = ''

  const formEl = formRef.value
  if (formEl && typeof formEl.validate === 'function') {
    try {
      await formEl.validate()
    } catch (e) {
      // 表单校验没过的提示由 el-form-item 自己显示，这里不再重复弹窗
      return
    }
  }

  submitting.value = true
  try {
    const result = await authStore.login(form.value.token, form.value.remember)
    if (!result || !result.ok) {
      errorText.value = (result && result.error) || '令牌校验失败'
      return
    }
    if (result.warning) {
      // 允许进入，但必须让用户知道「令牌没被验证过」
      warningText.value = result.warning
      ElMessage.warning(result.warning)
    }
    router.replace(redirectTarget.value)
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  // 直接打开 /login（而不是被守卫踢过来）时，state 可能还没恢复。
  // 这里恢复一次，让「已登录却手动访问 /login」也能被守卫正确处理。
  if (!authStore.restored) authStore.restore()
})
</script>

<style scoped>
.xc-login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: linear-gradient(180deg, #f7f9fc 0%, #eef2f7 100%);
}

/* 卡片在桌面端最多 420px，移动端占满可用宽度 */
.xc-login__box {
  width: 100%;
  max-width: 420px;
}

.xc-login__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 0 4px;
}

.xc-login__logo {
  font-size: 26px;
  color: var(--xc-primary);
}

.xc-login__title {
  font-size: 17px;
  font-weight: 700;
  line-height: 22px;
  color: var(--xc-text);
}

.xc-login__subtitle {
  font-size: 12.5px;
  line-height: 18px;
  color: var(--xc-text-secondary);
}

.xc-login__card {
  border-radius: 10px;
}

.xc-login__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--xc-text-regular);
}

.xc-login__hint {
  width: 100%;
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--xc-text-secondary);
}

/* 表单最后一项（登录按钮）不要留底部间距 */
.xc-login__item {
  margin-bottom: 14px;
}

.xc-login__switch {
  margin-top: 14px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--xc-text-secondary);
  text-align: center;
}

.xc-login__link {
  color: var(--xc-primary);
  font-weight: 600;
  text-decoration: none;
}

.xc-login__link:hover {
  text-decoration: underline;
}

/* 底部安全提示：小字、灰，但必须能看清 */
.xc-login__footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--xc-border);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--xc-text-secondary);
}

.xc-login__footer p {
  margin: 0 0 6px;
}

.xc-login__footer p:last-child {
  margin-bottom: 0;
}

@media (max-width: 768px) {
  .xc-login {
    /* 移动端软键盘弹出时不要把卡片顶出可视区 */
    align-items: flex-start;
    padding: 28px 12px calc(24px + env(safe-area-inset-bottom, 0px));
  }

  .xc-login__box {
    max-width: none;
  }
}
</style>
