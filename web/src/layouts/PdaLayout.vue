<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { pdaActionBar, clearPdaActions } from './pdaActions'

const props = defineProps<{
  /** 覆盖标题（默认取 route.meta.title） */
  title?: string
  /** 是否显示返回按钮（默认非首页显示） */
  showBack?: boolean
}>()

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const title = computed(() => props.title || (route.meta.title as string) || '')
const showBack = computed(() => props.showBack ?? route.path !== '/pda/home')

// 路由切换时清空上一页注册的主操作按钮
watch(
  () => route.fullPath,
  () => clearPdaActions()
)

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/pda/home')
}
</script>

<template>
  <div class="pda-layout">
    <header class="pda-header">
      <button v-if="showBack" class="pda-header-back" @click="goBack">‹ 返回</button>
      <span v-else class="pda-header-back pda-header-back--placeholder"></span>
      <h1 class="pda-header-title">{{ title }}</h1>
      <span class="pda-header-user">{{ auth.user?.username ?? '' }}</span>
    </header>

    <main class="pda-content" :class="{ 'pda-content--with-actions': pdaActionBar.items.length }">
      <slot />
    </main>

    <footer v-if="pdaActionBar.items.length" class="pda-action-bar">
      <!-- 具名插槽兜底：页面若直接使用本布局组件可自行填充 -->
      <slot name="actions">
        <button
          v-for="(a, i) in pdaActionBar.items"
          :key="i"
          class="pda-btn"
          :class="`pda-btn--${a.type ?? 'primary'}`"
          :disabled="a.disabled"
          @click="a.onClick"
        >
          {{ a.label }}
        </button>
      </slot>
    </footer>
  </div>
</template>

<style scoped>
.pda-layout {
  height: 100vh; display: flex; flex-direction: column; background: #f5f6f8;
  font-size: var(--pda-font-size, 18px);
}
.pda-header {
  display: flex; align-items: center; gap: 8px;
  height: 52px; padding: 0 12px; background: #1f6fd6; color: #fff; flex-shrink: 0;
}
.pda-header-back {
  background: none; border: none; color: #fff; font-size: 18px; padding: 4px 8px;
  min-width: 64px; text-align: left; cursor: pointer;
}
.pda-header-back--placeholder { visibility: hidden; }
.pda-header-title {
  flex: 1; margin: 0; font-size: 19px; font-weight: 600; text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pda-header-user { min-width: 64px; text-align: right; font-size: 14px; opacity: 0.9; }
.pda-content { flex: 1; overflow-y: auto; padding: 12px; -webkit-overflow-scrolling: touch; }
.pda-content--with-actions { padding-bottom: 84px; }
.pda-action-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  display: flex; gap: 10px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  background: #fff; box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.08);
}
</style>
