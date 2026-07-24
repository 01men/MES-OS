<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const username = computed(() => auth.user?.username ?? '')
const roles = computed(() => (auth.user?.roles ?? []).join('、'))
</script>

<template>
  <div>
    <el-card>
      <h2 style="margin-top: 0">欢迎使用聚杰电器 MES 仓储管理模块</h2>
      <p>
        当前用户：<b>{{ username }}</b>
        <span v-if="roles">（{{ roles }}）</span>
      </p>
      <el-alert type="success" :closable="false" show-icon>
        <template #title>核心仓储业务页面已接入；左侧菜单会按当前账号权限自动过滤。</template>
      </el-alert>
    </el-card>

    <el-card style="margin-top: 16px">
      <template #header>演示账号说明</template>
      <p>后端接口：<code>POST /api/auth/login</code>，入参 <code>{ username, password }</code>。</p>
      <ul>
        <li>收料、仓管、质检、生产班组角色 → 登录后进入 PDA 端 <code>/pda/home</code></li>
        <li>其余角色 → 进入 PC 端 <code>/pc/dashboard</code></li>
        <li>角色与端的映射可在 <code>src/stores/auth.ts</code> 的 <code>PDA_DEFAULT_ROLES</code> 常量调整</li>
      </ul>
      <p style="color: #909399">具体账号密码以后端初始化数据为准。</p>
    </el-card>
  </div>
</template>
