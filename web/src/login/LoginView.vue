<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import http from '@/api/http'
import { getAuthConfig, getDingTalkLoginUrl } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const form = reactive({ username: '', password: '' })
const loading = ref(false)
const dingtalkLoading = ref(false)
const dingtalkEnabled = ref(false)

onMounted(async () => {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  const token = hash.get('dingtalk_token')
  const rawUser = hash.get('dingtalk_user')
  if (token && rawUser) {
    try {
      auth.setAuth(token, JSON.parse(rawUser))
      history.replaceState(null, '', '/login')
      await router.replace(auth.isPdaUser ? '/pda/home' : '/pc/dashboard')
      ElMessage.success('钉钉授权登录成功')
      return
    } catch {
      ElMessage.error('钉钉登录响应解析失败，请重新登录')
    }
  }
  const dingtalkError = route.query.dingtalk_error
  if (dingtalkError) ElMessage.error(String(dingtalkError))
  try {
    dingtalkEnabled.value = (await getAuthConfig()).data.dingtalkEnabled
  } catch {
    dingtalkEnabled.value = false
  }
})

async function onSubmit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入账号和密码')
    return
  }
  loading.value = true
  try {
    const res = await http.post('/auth/login', {
      username: form.username,
      password: form.password
    })
    const data: any = res.data
    auth.setAuth(data.token, data.user)
    const redirect = (route.query.redirect as string) || ''
    router.push(redirect || (auth.isPdaUser ? '/pda/home' : '/pc/dashboard'))
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    loading.value = false
  }
}

async function onDingTalkLogin() {
  dingtalkLoading.value = true
  try {
    const { data } = await getDingTalkLoginUrl()
    location.assign(data.url)
  } finally {
    dingtalkLoading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <el-card class="login-card">
      <div class="login-title">
        <h2>聚杰电器 MES</h2>
        <p>仓储管理模块（WMS）</p>
      </div>
      <el-form @submit.prevent="onSubmit">
        <el-form-item>
          <el-input v-model="form.username" size="large" placeholder="账号" autocomplete="username" />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="form.password"
            size="large"
            type="password"
            placeholder="密码"
            show-password
            autocomplete="current-password"
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="onSubmit">
          登 录
        </el-button>
      </el-form>
      <template v-if="dingtalkEnabled">
        <div class="login-separator"><span>或</span></div>
        <el-button
          size="large"
          class="login-btn dingtalk-btn"
          :loading="dingtalkLoading"
          @click="onDingTalkLogin"
        >
          钉钉授权登录
        </el-button>
      </template>
      <p class="login-tip">PDA 角色（收料/仓管/备料/盘点）登录后进入移动端，其余进入 PC 端</p>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  height: 100vh; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #1f6fd6 0%, #123a75 100%);
}
.login-card { width: 380px; }
.login-title { text-align: center; margin-bottom: 24px; }
.login-title h2 { margin: 0 0 6px; color: #1f6fd6; }
.login-title p { margin: 0; color: #909399; font-size: 13px; }
.login-btn { width: 100%; }
.login-separator {
  display: flex; align-items: center; gap: 10px; margin: 16px 0; color: #a8abb2; font-size: 12px;
}
.login-separator::before, .login-separator::after { content: ''; height: 1px; flex: 1; background: #e4e7ed; }
.dingtalk-btn { color: #fff; border-color: #1677ff; background: #1677ff; }
.dingtalk-btn:hover { color: #fff; border-color: #4096ff; background: #4096ff; }
.login-tip { text-align: center; color: #c0c4cc; font-size: 12px; margin: 16px 0 0; }
</style>
