<template>
  <div class="xc-auth">
    <div class="xc-auth__box">
      <div class="xc-auth__brand">
        <el-icon class="xc-auth__logo"><Bell /></el-icon>
        <div>
          <div class="xc-auth__title">Xcollector · 注册 / 换取令牌</div>
          <div class="xc-auth__subtitle">
            用 QQ 号证明身份，拿到属于你自己的登录令牌
          </div>
        </div>
      </div>

      <!-- ① 还没拿到令牌：讲清楚「用户先找机器人」这件事，再给表单 -->
      <el-card v-if="!issuedToken" shadow="never" class="xc-auth__card">
        <div class="xc-auth__steps-title">怎么拿到验证码（三步）</div>
        <ol class="xc-auth__steps">
          <li>
            打开 QQ，找到这套系统的<strong>机器人</strong>（就是平时往通知群里发消息的那个），
            给它<strong>发一条私聊</strong>：
            <span class="xc-mono xc-auth__cmd">/注册</span>
          </li>
          <li>
            机器人会把一个<strong>6 位验证码</strong>回给你。
            <span class="xc-auth__note">
              必须是<strong>你</strong>先去发消息：机器人发不出陌生人的私聊，
              所以它没法主动把码推给你。
            </span>
          </li>
          <li>把 <strong>QQ 号</strong>、<strong>验证码</strong>、
            <strong>邀请码</strong>（管理员给你的，开放注册时可以不填）填在下面。</li>
        </ol>

        <el-alert
          v-if="errorText"
          type="error"
          :closable="false"
          show-icon
          :title="errorText"
          style="margin: 12px 0"
        />

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          @submit.prevent="submit"
        >
          <el-form-item prop="qq">
            <template #label><span class="xc-auth__label">QQ 号（必填）</span></template>
            <el-input
              v-model="form.qq"
              size="large"
              clearable
              placeholder="你用来给机器人发消息的那个 QQ 号"
              :disabled="submitting"
            />
          </el-form-item>

          <el-form-item prop="code">
            <template #label><span class="xc-auth__label">验证码（必填）</span></template>
            <el-input
              v-model="form.code"
              size="large"
              clearable
              maxlength="6"
              placeholder="机器人私聊回给你的 6 位数字"
              :disabled="submitting"
            />
            <div class="xc-auth__hint">
              验证码只能用一次，而且会过期。填错了回 QQ 里给机器人再发一次
              <span class="xc-mono">/注册</span> 重新要一个。
            </div>
          </el-form-item>

          <el-form-item prop="invite_code">
            <template #label><span class="xc-auth__label">邀请码（管理员发的）</span></template>
            <el-input
              v-model="form.invite_code"
              size="large"
              clearable
              placeholder="inv 开头的一串；开放注册时留空"
              :disabled="submitting"
            />
            <div class="xc-auth__hint">
              服务端开启邀请制时<strong>必须填</strong>，向给你这套系统的人索取。
              已经是老用户、只是来换令牌的话不用填。
            </div>
          </el-form-item>

          <el-form-item prop="display_name">
            <template #label><span class="xc-auth__label">显示名（可选）</span></template>
            <el-input
              v-model="form.display_name"
              size="large"
              clearable
              placeholder="只影响界面里怎么称呼你，随时可以改"
              :disabled="submitting"
            />
          </el-form-item>

          <el-button
            type="primary"
            size="large"
            style="width: 100%"
            native-type="submit"
            :loading="submitting"
            @click="submit"
          >
            {{ submitting ? '正在提交…' : '提交，领取令牌' }}
          </el-button>
        </el-form>

        <div class="xc-auth__switch">
          已经有令牌了？
          <router-link to="/login" class="xc-auth__link">回登录页</router-link>
        </div>
      </el-card>

      <!-- ② 拿到了令牌：只显示这一次，必须让用户复制走 -->
      <el-card v-else shadow="never" class="xc-auth__card">
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="这串令牌只会显示这一次，请立刻复制保存"
          style="margin-bottom: 14px"
        >
          <div style="font-size: 12.5px; line-height: 1.8">
            数据库里只存了它的摘要，<strong>关掉这一页就再也看不到它了</strong>。
            丢了不用慌：回 QQ 里给机器人再发一次
            <span class="xc-mono">/注册</span>，用同样的流程就能换一个新令牌
            （旧令牌会立刻失效）。
          </div>
        </el-alert>

        <div class="xc-auth__token-label">你的登录令牌</div>
        <div class="xc-auth__token" ref="tokenBoxRef">{{ issuedToken }}</div>

        <div class="xc-auth__token-actions">
          <el-button type="primary" @click="copyToken">
            <el-icon style="margin-right: 4px"><CopyDocument /></el-icon>
            复制令牌
          </el-button>
          <el-button @click="downloadToken">下载成 txt 文件</el-button>
        </div>

        <div class="xc-auth__welcome">
          <template v-if="issuedUser">
            账号已就绪：<strong>{{ issuedUser.display_name || `QQ ${issuedUser.qq}` }}</strong>
            <span class="xc-muted">（QQ {{ issuedUser.qq }}）</span>
            <template v-if="!issuedCreated">
              · 这是一次<strong>令牌轮换</strong>，你之前的令牌已经失效。
            </template>
          </template>
        </div>

        <el-button
          type="success"
          size="large"
          style="width: 100%; margin-top: 12px"
          @click="enterApp"
        >
          我已经保存好了，进入应用
        </el-button>

        <div class="xc-auth__footer">
          <p>
            令牌同时是你的<strong>登录凭证</strong>和<strong>调用凭证</strong>：
            以后在这台浏览器上访问后端，用的都是它。换台电脑就把它粘到登录页。
          </p>
          <p>
            它是明文保存在浏览器 storage 里的，
            <strong>任何能在这台浏览器上执行 JS 的东西都能读到它</strong>，
            所以别在公共电脑上勾「记住我」。
          </p>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Bell, CopyDocument } from '@element-plus/icons-vue'

import { registerUser } from '../api/user'
import { readErrorDetail } from '../api/errors'
import { useAuthStore } from '../stores/auth'

/**
 * 注册页（同时兼「令牌丢了来换一个」）。
 *
 * 关键约束（都来自后端契约）：
 *   1. 验证码**前端申请不了** —— `POST /api/verify/request` 只认服务端令牌（bot），
 *      否则任何人知道别人的 QQ 号就能一直刷新他的验证码。所以流程只能是
 *      「用户先在 QQ 里给机器人发 /注册，机器人把码回给他」。
 *   2. `POST /api/register` 是公开接口，不带 Authorization。
 *   3. 返回的 `token` 是明文、**只出现这一次**（库里只存 sha256），
 *      所以拿到之后必须停留在这一页，让用户复制走再进应用。
 *   4. 同一个 QQ 再注册一次 = **轮换令牌**，不是报错（否则令牌一丢账号就废了）。
 */
const router = useRouter()
const authStore = useAuthStore()

const formRef = ref(null)
const tokenBoxRef = ref(null)
const submitting = ref(false)
const errorText = ref('')

/** 注册成功后的结果；非空即切换到「显示令牌」面板 */
const issuedToken = ref('')
const issuedUser = ref(null)
const issuedCreated = ref(false)

const form = ref({ qq: '', code: '', invite_code: '', display_name: '' })

const rules = {
  qq: [
    {
      validator: (_rule, value, callback) => {
        const v = typeof value === 'string' ? value.trim() : ''
        if (!v) return callback(new Error('请填写 QQ 号'))
        // 与后端 app/users.py 的 _QQ_RE 一致：5~12 位、不以 0 开头
        if (!/^[1-9]\d{4,11}$/.test(v)) {
          return callback(new Error('QQ 号看起来不对：应该是 5~12 位数字，且不以 0 开头'))
        }
        callback()
      },
      trigger: 'blur'
    }
  ],
  code: [
    {
      validator: (_rule, value, callback) => {
        const v = typeof value === 'string' ? value.trim() : ''
        if (!v) return callback(new Error('请填写机器人回给你的验证码'))
        if (!/^\d{6}$/.test(v)) return callback(new Error('验证码是 6 位数字'))
        callback()
      },
      trigger: 'blur'
    }
  ]
}

const qqNumber = computed(() => (issuedUser.value && issuedUser.value.qq) || '')

async function submit() {
  if (submitting.value) return
  errorText.value = ''

  const formEl = formRef.value
  if (formEl && typeof formEl.validate === 'function') {
    try {
      await formEl.validate()
    } catch (e) {
      // 表单校验没过：提示由 el-form-item 自己显示
      return
    }
  }

  submitting.value = true
  try {
    const data = await registerUser(form.value)
    if (!data || !data.token) {
      errorText.value = '后端没有返回令牌，请稍后重试或联系管理员'
      return
    }
    issuedToken.value = data.token
    issuedUser.value = data.user || null
    issuedCreated.value = !!data.created
    if (data.notice) ElMessage.warning(data.notice)
  } catch (err) {
    // 后端把 400/401/409/422 的 detail 都写成了给人看的中文，优先原样展示
    errorText.value = readErrorDetail(err, '注册失败')
  } finally {
    submitting.value = false
  }
}

async function copyToken() {
  const text = issuedToken.value || ''
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      ElMessage.success('已复制到剪贴板')
      return
    }
    throw new Error('no clipboard')
  } catch (e) {
    // 剪贴板 API 在 http 页面 / 旧浏览器上不可用：退回到「选中文本」
    const box = tokenBoxRef.value
    if (box && window.getSelection) {
      const range = document.createRange()
      range.selectNodeContents(box)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      ElMessage.warning('已选中令牌文本，请按 Ctrl+C 复制')
    } else {
      ElMessage.warning('当前浏览器不支持自动复制，请手动选中复制')
    }
  }
}

/** 兜底：有人就是不想用剪贴板，给一个文件下来 */
function downloadToken() {
  try {
    const text = `Xcollector 登录令牌\n\n${issuedToken.value}\n\n` +
      `QQ：${qqNumber.value}\n` +
      '这是你的登录凭证，请妥善保存。丢了可以用同样的注册流程换一个新的。\n'
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'xcollector-token.txt'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error('下载失败，请手动复制令牌')
  }
}

/**
 * 带着新令牌进应用。
 * 令牌是后端刚签发的，不需要再打一次 `/api/me`，所以走 adopt 直接写入登录态。
 */
function enterApp() {
  const ok = authStore.adopt(issuedToken.value, issuedUser.value, true)
  if (!ok) {
    errorText.value = '令牌为空，无法进入应用'
    return
  }
  ElMessage.success('令牌已保存，进入通知台')
  router.replace('/')
}
</script>

<style scoped>
.xc-auth {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: linear-gradient(180deg, #f7f9fc 0%, #eef2f7 100%);
}

.xc-auth__box {
  width: 100%;
  max-width: 520px;
}

.xc-auth__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 0 4px;
}

.xc-auth__logo {
  font-size: 26px;
  color: var(--xc-primary);
}

.xc-auth__title {
  font-size: 17px;
  font-weight: 700;
  line-height: 22px;
  color: var(--xc-text);
}

.xc-auth__subtitle {
  font-size: 12.5px;
  line-height: 18px;
  color: var(--xc-text-secondary);
}

.xc-auth__card {
  border-radius: 10px;
}

.xc-auth__steps-title {
  margin-bottom: 8px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--xc-text);
}

/* 三步说明：编号 + 宽松行距，这是本页最重要的内容 */
.xc-auth__steps {
  margin: 0 0 4px;
  padding-left: 20px;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--xc-text-regular);
}

.xc-auth__steps li {
  margin-bottom: 4px;
}

.xc-auth__cmd {
  display: inline-block;
  padding: 0 6px;
  border-radius: 4px;
  background: #eef0f3;
  border: 1px solid #e0e3e8;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--xc-text);
}

.xc-auth__note {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--xc-text-secondary);
}

.xc-auth__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--xc-text-regular);
}

.xc-auth__hint {
  width: 100%;
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--xc-text-secondary);
}

.xc-auth__switch {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--xc-text-secondary);
  text-align: center;
}

.xc-auth__link {
  color: var(--xc-primary);
  font-weight: 600;
  text-decoration: none;
}

.xc-auth__link:hover {
  text-decoration: underline;
}

.xc-auth__token-label {
  margin-bottom: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--xc-text-regular);
}

/* 令牌本体：等宽、可选中、浅黄底，视觉上就是「重要且易碎」 */
.xc-auth__token {
  padding: 12px 14px;
  border: 1px dashed #e6a23c;
  border-radius: 8px;
  background: #fffbf0;
  font-family: var(--xc-mono);
  font-size: 13.5px;
  line-height: 1.7;
  color: #7a4b00;
  word-break: break-all;
  user-select: all;
}

.xc-auth__token-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.xc-auth__welcome {
  margin-top: 14px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--xc-text-regular);
}

.xc-auth__footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--xc-border);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--xc-text-secondary);
}

.xc-auth__footer p {
  margin: 0 0 6px;
}

.xc-auth__footer p:last-child {
  margin-bottom: 0;
}

@media (max-width: 768px) {
  .xc-auth {
    align-items: flex-start;
    padding: 24px 12px calc(24px + env(safe-area-inset-bottom, 0px));
  }

  .xc-auth__box {
    max-width: none;
  }
}
</style>
