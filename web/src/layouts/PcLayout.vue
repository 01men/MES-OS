<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

/** 左侧菜单：从路由表自动生成，按 meta.perm 过滤（perm 为空默认可见） */
const menuItems = computed(() =>
  router.options.routes
    .filter((r) => r.path.startsWith('/pc') && r.meta?.title && auth.hasPerm(r.meta?.perm))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((r) => ({ path: r.path, title: r.meta?.title as string }))
)

const username = computed(() => auth.user?.username ?? '-')
const rolesText = computed(() => (auth.user?.roles ?? []).join(' / '))

async function onLogout() {
  await ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' })
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <el-container class="pc-layout">
    <el-aside width="220px" class="pc-aside">
      <div class="pc-logo">聚杰电器 MES<span>仓储管理</span></div>
      <el-menu :default-active="route.path" router class="pc-menu">
        <el-menu-item v-for="m in menuItems" :key="m.path" :index="m.path">
          <span>{{ m.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="pc-header">
        <div class="pc-header-title">{{ route.meta.title ?? '' }}</div>
        <el-dropdown @command="onLogout">
          <span class="pc-user">
            {{ username }}<em v-if="rolesText">（{{ rolesText }}）</em>
            <el-icon><svg viewBox="0 0 1024 1024" width="14" height="14"><path fill="currentColor" d="M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728 30.592 30.592 0 0 0-42.752 0z"/></svg></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="pc-main">
        <slot />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.pc-layout { height: 100vh; }
.pc-aside { background: #001529; display: flex; flex-direction: column; }
.pc-logo {
  color: #fff; font-size: 17px; font-weight: 600; padding: 18px 16px; line-height: 1.4;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.pc-logo span { display: block; font-size: 12px; font-weight: 400; opacity: 0.7; }
.pc-menu { border-right: none; flex: 1; background: transparent; }
.pc-menu :deep(.el-menu-item) { color: rgba(255, 255, 255, 0.75); }
.pc-menu :deep(.el-menu-item.is-active) { color: #fff; background: #1890ff; }
.pc-menu :deep(.el-menu-item:hover) { background: rgba(255, 255, 255, 0.08); }
.pc-header {
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #e4e7ed; background: #fff;
}
.pc-header-title { font-size: 16px; font-weight: 600; }
.pc-user { cursor: pointer; display: flex; align-items: center; gap: 4px; }
.pc-user em { font-style: normal; color: #909399; font-size: 12px; }
.pc-main { background: #f0f2f5; }
</style>
