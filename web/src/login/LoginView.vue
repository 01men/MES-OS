<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import http from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const form = reactive({ username: '', password: '' })
const loading = ref(false)

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
.login-tip { text-align: center; color: #c0c4cc; font-size: 12px; margin: 16px 0 0; }
</style>
