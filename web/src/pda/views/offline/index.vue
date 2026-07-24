<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import http from '@/api/http'
import { listPending, replay, type OfflineTask } from '@/api/offline'

/** 服务端离线任务（GET /offline/tasks） */
interface ServerTask {
  id: number
  taskNo: string
  deviceId?: string
  payload?: string
  status?: string
  message?: string
  createdAt?: string
}

const localQueue = ref<OfflineTask[]>([])
const serverTasks = ref<ServerTask[]>([])
const syncing = ref(false)

const fb = ref<{ type: 'success' | 'error' | 'duplicate' | 'offline'; msg: string; detail?: string }>({
  type: 'success',
  msg: ''
})
function setFb(type: typeof fb.value.type, msg: string, detail = '') {
  fb.value = { type, msg, detail }
}

/** 状态归一化：待同步 / 同步中 / 失败 / 冲突 */
function statusOf(t: ServerTask): 'PENDING' | 'SYNCING' | 'FAILED' | 'CONFLICT' {
  const s = (t.status ?? '').toUpperCase()
  if (s.includes('CONFLICT') || s.includes('冲突')) return 'CONFLICT'
  if (s.includes('FAIL') || s.includes('失败')) return 'FAILED'
  if (s.includes('SYNC') && !s.includes('PEND')) return 'SYNCING'
  return 'PENDING'
}
const STATUS_TEXT: Record<string, string> = { PENDING: '待同步', SYNCING: '同步中', FAILED: '失败', CONFLICT: '冲突' }

function refreshLocal() {
  localQueue.value = listPending()
}

async function loadServerTasks() {
  try {
    const res = await http.get('/offline/tasks', { silent: true } as never)
    serverTasks.value = res.data ?? []
  } catch {
    serverTasks.value = []
  }
}

async function reload() {
  refreshLocal()
  await loadServerTasks()
}

/** 重新同步本机队列：每条请求以稳定 X-Task-No 作为幂等键重放。 */
async function resyncAll() {
  syncing.value = true
  try {
    const { ok, fail } = await replay()
    await reload()
    if (fail) setFb('error', `部分同步失败：本地仍有 ${fail} 条`)
    else if (ok) setFb('success', `同步完成，成功 ${ok} 条`)
    else setFb('success', '本地队列已是最新')
  } finally {
    syncing.value = false
  }
}

/** 冲突处理：保留本地 = 以本地数据重放；采用服务器 = 通知后端放弃本地版本 */
async function resolveConflict(t: ServerTask, choice: 'KEEP_LOCAL' | 'USE_SERVER') {
  syncing.value = true
  try {
    await http.post(
      `/offline/tasks/${t.id}/resolve`,
      { choice },
      { silent: true } as never
    )
    setFb('success', choice === 'KEEP_LOCAL' ? '已保留本地版本，等待重放' : '已采用服务器版本')
    await reload()
  } catch (err: any) {
    const msg = err?.response?.data?.message
    setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '冲突处理失败'))
  } finally {
    syncing.value = false
  }
}

function fmtTime(ts?: number | string) {
  return ts ? new Date(ts).toLocaleString() : '-'
}

const totalPending = computed(() => localQueue.value.length + serverTasks.value.filter((t) => statusOf(t) !== 'SYNCING').length)

watchEffect(() => {
  setPdaActions([
    {
      label: syncing.value ? '同步中…' : `重新同步（${totalPending.value}）`,
      type: 'primary',
      disabled: syncing.value,
      onClick: resyncAll
    },
    { label: '刷新', type: 'info', disabled: syncing.value, onClick: reload }
  ])
})

onMounted(reload)
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.msg" :detail="fb.detail" />

    <!-- 本地离线队列 -->
    <div class="pda-card">
      <div class="section-title">本地离线队列（{{ localQueue.length }}）</div>
      <div v-if="!localQueue.length" class="empty">无待同步数据</div>
      <div v-for="t in localQueue" :key="t.taskNo" class="task-row">
        <div class="task-main">
          <span class="task-no">{{ t.taskNo }}</span>
          <span class="tag tag-pending">待同步</span>
        </div>
        <div class="task-sub">{{ t.method.toUpperCase() }} {{ t.url }} · {{ fmtTime(t.createdAt) }}</div>
      </div>
      <!-- 约定：不提供删除未同步数据入口，避免误丢采集数据 -->
    </div>

    <!-- 服务端任务 -->
    <div class="pda-card">
      <div class="section-title">服务端任务（{{ serverTasks.length }}）</div>
      <div v-if="!serverTasks.length" class="empty">无服务端离线任务</div>
      <div v-for="t in serverTasks" :key="t.taskNo" class="task-row">
        <div class="task-main">
          <span class="task-no">{{ t.taskNo }}</span>
          <span class="tag" :class="`tag-${statusOf(t).toLowerCase()}`">{{ STATUS_TEXT[statusOf(t)] }}</span>
        </div>
        <div class="task-sub">
          设备 {{ t.deviceId ?? '-' }} · {{ fmtTime(t.createdAt) }}
        </div>
        <div v-if="t.message" class="task-msg">{{ t.message }}</div>
        <div v-if="statusOf(t) === 'CONFLICT'" class="conflict-actions">
          <button class="pda-btn pda-btn--warning" :disabled="syncing" @click="resolveConflict(t, 'KEEP_LOCAL')">保留本地</button>
          <button class="pda-btn pda-btn--info" :disabled="syncing" @click="resolveConflict(t, 'USE_SERVER')">采用服务器</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.empty { text-align: center; color: #909399; padding: 8px 0; }
.task-row { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
.task-row:last-child { border-bottom: none; }
.task-main { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.task-no { font-size: 16px; font-weight: 700; color: #303133; word-break: break-all; }
.task-sub { margin-top: 4px; font-size: 14px; color: #909399; word-break: break-all; }
.task-msg { margin-top: 4px; font-size: 14px; color: #d93026; }
.tag { flex-shrink: 0; padding: 2px 10px; border-radius: 6px; font-size: 13px; font-weight: 700; color: #fff; }
.tag-pending { background: #1f6fd6; }
.tag-syncing { background: #e8720c; }
.tag-failed { background: #d93026; }
.tag-conflict { background: #e6a100; }
.conflict-actions { display: flex; gap: 10px; margin-top: 10px; }
</style>
