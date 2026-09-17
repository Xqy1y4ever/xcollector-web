<template>
  <div class="xc-login">
    <div class="xc-login__box">
      <div class="xc-login__brand">
        <el-icon class="xc-login__logo"><Bell /></el-icon>
        <div class="xc-login__brand-text">
          <div class="xc-login__title">Xcollector · 官方通知</div>
          <div class="xc-login__subtitle">输入访问令牌后进入通知台</div>
        </div>
      </div>

      <el-card shadow="never" class="xc-login__card">
        <!-- 校验失败（401/403）：令牌不对，不放行 -->
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
              <span class="xc-login__label">网页令牌</span>
            </template>
            <el-input
              v-model="form.token"
              type="password"
              size="large"
              show-password
              clearable
              autocomplete="current-password"
              placeholder="后端/ bot 的 WEB_API_TOKEN"
              :disabled="submitting"
            />
            <div class="xc-login__hint">
              后端与 bot 共用的 <span class="xc-mono">WEB_API_TOKEN</span>。
              它只能<strong>读取、提交人工修正、标记已读</strong> —— 改不了数据库、
              也不能发 QQ 消息。
            </div>
          </el-form-item>

          <el-form-item class="xc-login__item">
            <el-checkbox v-model="form.remember" :disabled="submitting">
              记住我（关掉浏览器也不用重新输）
            </el-checkbox>
            <div class="xc-login__hint">
              勾上＝存在 localStorage；不勾＝只存在本次标签页（关掉标签页即登出）
            </div>
          </el-form-item>

          <!-- 高级：管理员令牌。填了才解锁「发送到 QQ」这类会真的动手的操作 -->
          <el-form-item class="xc-login__item">
            <el-checkbox v-model="advanced" :disabled="submitting">
              高级：我是管理员，填管理令牌解锁写操作
            </el-checkbox>
          </el-form-item>

          <div v-if="advanced" class="xc-login__advanced">
            <el-form-item prop="botToken" class="xc-login__item">
              <template #label>
                <span class="xc-login__label">管理令牌（可选）</span>
              </template>
              <el-input
                v-model="form.botToken"
                type="password"
                show-password
                clearable
                placeholder="BOT_API_TOKEN 或 API_TOKEN"
                :disabled="submitting"
              />
              <div class="xc-login__hint">
                填 <span class="xc-mono">BOT_API_TOKEN</span>（bot 侧）或
                <span class="xc-mono">API_TOKEN</span>（写入令牌）。
                <strong>填了它，这个浏览器就有完整权限</strong>——包括以你的身份发 QQ 消息。
                它<strong>不会</strong>替代上面的网页令牌：读接口仍然用网页令牌。
              </div>
            </el-form-item>
          </div>

          <el-button
            type="primary"
            size="large"
            style="width: 100%"
            native-type="submit"
            :loading="submitting"
            @click="submit"
          >
            {{ submitting ? '正在验证令牌…' : '登录' }}
          </el-button>
        </el-form>

        <div class="xc-login__footer">
          <p>
            令牌是<strong>网页令牌</strong> <span class="xc-mono">WEB_API_TOKEN</span>，
            登录后存在这台浏览器的 storage 里。
            <strong>任何能在这台浏览器上执行 JS 的东西都能读到它</strong>，
            因此它只适合私有部署——<strong>不要把端口暴露到公网</strong>。
          </p>
          <p>
            它<strong>不能</strong>改数据库，也<strong>不能</strong>发 QQ 消息 ——
            入库和「发送到 QQ」只认管理令牌（bot 侧叫
            <span class="xc-mono">API_TOKEN</span>），那个只在服务器上。
            所以就算这个令牌泄露，别人也只能看，改不了、发不了。
          </p>
          <p>
            仍然<strong>不是按用户的账号体系</strong>：所有拿同一个网页令牌登录的人，
            看到的东西和能做的事完全一样。
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
 * 背景：后端所有 `/api` 都要求 `Authorization: Bearer <API_TOKEN>`。
 * 以前是 Docker 里的 nginx 无条件注入 token（任何能访问到 8080 端口的人都能进来），
 * 现在改成认证在前端做：nginx 原样转发浏览器带的 `Authorization`，所以必须由用户输入令牌。
 *
 * 校验失败（401/403）不放行；后端不可达或 5xx 时**仍然放行**——
 * 后端挂着的时候，用户最需要看的就是状态页（那里正显示「后端不可达」），
 * 把登录卡死反而让人没法诊断。
 */
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const formRef = ref(null)
const submitting = ref(false)
const errorText = ref('')
const warningText = ref('')

/** 默认勾上「记住我」：这是个自用控制台，天天输令牌很烦 */
const form = ref({ token: '', botToken: '', remember: true })
/** 高级区折叠状态：默认收起，避免让「只有一个密钥」这件事看起来更复杂 */
const advanced = ref(false)

const rules = {
  token: [
    {
      validator: (_rule, value, callback) => {
        // 两个都空才拦；只填 bot 令牌也允许（后端 API_TOKEN 留空的部署就是这样）
        const hasToken = typeof value === 'string' && value.trim() !== ''
        const hasBotToken = !!(form.value.botToken && form.value.botToken.trim())
        if (!hasToken && !hasBotToken) callback(new Error('请输入访问令牌'))
        else callback()
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
  // 回到 /login 自己会再被守卫弹回首页，不如直接给 '/'
  if (raw === '/login' || raw.startsWith('/login?')) return '/'
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
    const result = await authStore.login(form.value.token, form.value.botToken, form.value.remember)
    if (!result || !result.ok) {
      errorText.value = (result && result.error) || 'token 不正确'
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

.xc-login__advanced {
  padding: 10px 12px 0;
  margin-bottom: 12px;
  border: 1px dashed var(--xc-border);
  border-radius: 8px;
  background: var(--xc-bg-soft);
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
