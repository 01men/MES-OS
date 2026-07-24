<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

/** 功能磁贴：path 指向约定路由，页面未创建时提示开发中（由下游代理填充） */
const tiles = [
  { key: 'P01', title: '收料扫码', icon: '📥', path: '/pda/receiving', perm: 'receiving.operate' },
  { key: 'P04', title: '备料作业', icon: '📋', path: '/pda/prep', perm: 'prep.operate' },
  { key: 'P05', title: '物权交接', icon: '🤝', path: '/pda/handover', perm: 'prep.operate' },
  { key: 'P06', title: '余料登记', icon: '↩️', path: '/pda/surplus', perm: 'surplus.operate' },
  { key: 'P10', title: '盘点作业', icon: '🧮', path: '/pda/stocktake', perm: 'stocktake.operate' },
  { key: 'P14', title: '成品出库放行', icon: '🚚', path: '/pda/shipping', perm: 'shipping.operate' },
  { key: 'P21', title: '离线任务', icon: '☁️', path: '/pda/offline', perm: 'offline.sync' }
]

function open(path: string) {
  if (router.getRoutes().some((r) => r.path === path)) router.push(path)
  else ElMessage.info('该功能页面开发中')
}
</script>

<template>
  <div class="pda-home">
    <button
      v-for="t in tiles.filter((item) => auth.hasPerm(item.perm))"
      :key="t.key"
      class="pda-home-tile"
      @click="open(t.path)"
    >
      <span class="pda-home-icon">{{ t.icon }}</span>
      <span class="pda-home-title">{{ t.title }}</span>
      <span class="pda-home-key">{{ t.key }}</span>
    </button>
  </div>
</template>

<style scoped>
.pda-home {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;
}
.pda-home-tile {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; min-height: 120px; border: none; border-radius: 12px;
  background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06); cursor: pointer;
}
.pda-home-tile:active { background: #eaf3ff; }
.pda-home-icon { font-size: 34px; }
.pda-home-title { font-size: 18px; font-weight: 600; color: #303133; }
.pda-home-key { font-size: 12px; color: #a8abb2; }
</style>
