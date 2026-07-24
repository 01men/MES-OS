<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import ScanInput from '@/components/ScanInput.vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import { enqueue } from '@/api/offline'
import { fetchTasks, fetchTask, submitCount, submitRecount, type StocktakeLine, type StocktakeTask } from '@/api/stocktake'

type ViewMode = 'list' | 'task'
type CountMode = 'count' | 'recount'

const mode = ref<ViewMode>('list')
const countMode = ref<CountMode>('count')
const tasks = ref<StocktakeTask[]>([])
const task = ref<(StocktakeTask & { lines: StocktakeLine[] }) | null>(null)
const currentLine = ref<StocktakeLine | null>(null)
const qtyText = ref('')
const reasonText = ref('')
const loading = ref(false)
const submitting = ref(false)

const fb = ref<{ type: 'success' | 'error' | 'duplicate' | 'offline'; msg: string; detail?: string }>({
  type: 'success',
  msg: ''
})
function setFb(type: typeof fb.value.type, msg: string, detail = '') {
  fb.value = { type, msg, detail }
}

/* ---------- 任务列表 ---------- */
async function loadTasks() {
  loading.value = true
  try {
    const res = await fetchTasks()
    const all: StocktakeTask[] = res.data ?? []
    // 只展示待盘 / 进行中
    tasks.value = all.filter((t) => !t.status || ['PENDING', 'IN_PROGRESS', '待盘', '进行中'].includes(t.status))
  } finally {
    loading.value = false
  }
}

async function openTask(t: StocktakeTask) {
  loading.value = true
  try {
    const res = await fetchTask(t.id)
    task.value = { ...res.data, lines: res.data.lines ?? [] }
    mode.value = 'task'
    countMode.value = 'count'
    currentLine.value = null
    qtyText.value = ''
    reasonText.value = ''
    setFb('success', '')
  } finally {
    loading.value = false
  }
}

function backToList() {
  mode.value = 'list'
  task.value = null
  currentLine.value = null
  void loadTasks()
}

/* ---------- 行定位与提交 ---------- */
const pendingLines = computed(() => {
  const lines = task.value?.lines ?? []
  if (countMode.value === 'recount') return lines.filter((l) => l.needRecount)
  return lines.filter((l) => l.status !== 'DONE' && l.status !== '已盘' && l.actualQty === undefined)
})

function onScan(code: string) {
  if (!task.value) return
  const lines = task.value.lines ?? []
  // 扫库位码或物料码定位行
  const line = lines.find((l) => l.locationCode === code) ?? lines.find((l) => l.materialCode === code)
  if (!line) {
    setFb('error', `未匹配到盘点行：${code}`, '请扫描库位码或物料码')
    currentLine.value = null
    return
  }
  if (countMode.value === 'recount' && !line.needRecount) {
    setFb('error', '该行无需复盘', `行号 ${line.lineNo}`)
    return
  }
  currentLine.value = line
  qtyText.value = ''
  setFb('success', `已定位行 ${line.lineNo}`, `${line.materialCode}${line.batchNo ? ' / ' + line.batchNo : ''}`)
}

async function submit() {
  if (!task.value || !currentLine.value) return
  const qty = Number(qtyText.value)
  if (!Number.isFinite(qty) || qty < 0) {
    setFb('error', '请输入有效的实盘数量')
    return
  }
  if (countMode.value === 'recount' && !reasonText.value.trim()) {
    setFb('error', '复盘必须填写原因')
    return
  }
  submitting.value = true
  const t = task.value
  const line = currentLine.value
  try {
    if (countMode.value === 'count') {
      const res = await submitCount(t.id, {
        lineNo: line.lineNo,
        actualQty: qty,
        reason: reasonText.value.trim() || undefined
      })
      const needRecount = !!res.data?.needRecount
      line.actualQty = qty
      line.needRecount = needRecount
      line.status = 'DONE'
      if (needRecount) {
        setFb('duplicate', '需复盘（须第二人操作）', `行 ${line.lineNo} 差异超阈值，请切换复盘入口由第二人录入`)
      } else {
        setFb('success', `行 ${line.lineNo} 盘点成功`)
      }
    } else {
      await submitRecount(t.id, { lineNo: line.lineNo, actualQty: qty, reason: reasonText.value.trim() })
      line.actualQty = qty
      line.needRecount = false
      line.status = 'DONE'
      setFb('success', `行 ${line.lineNo} 复盘完成`)
    }
    currentLine.value = null
    qtyText.value = ''
    reasonText.value = ''
  } catch (err: any) {
    if (!err?.response) {
      // 断网：采集类入离线队列，online 后自动重放
      enqueue({
        url: `/stocktake/tasks/${t.id}/${countMode.value}`,
        method: 'post',
        data: { lineNo: line.lineNo, actualQty: qty, reason: reasonText.value.trim() || undefined }
      })
      line.actualQty = qty
      setFb('offline', '已离线暂存，联网后自动同步', `行 ${line.lineNo} / 数量 ${qty}`)
      currentLine.value = null
      qtyText.value = ''
      reasonText.value = ''
    } else {
      // 后端业务错误（如复盘第二人校验、阈值原因必填）原样展示
      const msg = err.response.data?.message
      setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '提交失败'))
    }
  } finally {
    submitting.value = false
  }
}

/* ---------- 底部主操作 ---------- */
watchEffect(() => {
  if (mode.value === 'list') {
    setPdaActions([{ label: loading.value ? '加载中…' : '刷新任务', type: 'primary', disabled: loading.value, onClick: loadTasks }])
  } else {
    const isCount = countMode.value === 'count'
    setPdaActions([
      {
        label: isCount ? '复盘入口（第二人）' : '返回初盘',
        type: 'warning',
        onClick: () => {
          countMode.value = isCount ? 'recount' : 'count'
          currentLine.value = null
          qtyText.value = ''
          reasonText.value = ''
          setFb('success', '')
        }
      },
      {
        label: submitting.value ? '提交中…' : isCount ? '提交实盘数' : '提交复盘数',
        type: 'primary',
        disabled: !currentLine.value || submitting.value,
        onClick: submit
      }
    ])
  }
})

onMounted(loadTasks)
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.msg" :detail="fb.detail" />

    <!-- 任务列表 -->
    <template v-if="mode === 'list'">
      <div v-if="!tasks.length && !loading" class="pda-card empty">暂无待盘 / 进行中任务</div>
      <button v-for="t in tasks" :key="t.id" class="pda-card task-item" @click="openTask(t)">
        <div class="task-no">
          {{ t.taskNo }}
          <span v-if="t.blind" class="blind-badge">盲盘</span>
        </div>
        <div class="task-status">{{ t.status || '待盘' }}</div>
      </button>
    </template>

    <!-- 盘点明细 -->
    <template v-else-if="task">
      <div class="pda-card task-head">
        <div class="task-no">
          {{ task.taskNo }}
          <span v-if="task.blind" class="blind-badge">盲盘</span>
        </div>
        <div class="mode-tip">{{ countMode === 'count' ? '初盘模式：扫库位/物料定位行' : '复盘模式（须第二人操作）' }}</div>
      </div>

      <div class="pda-card">
        <ScanInput placeholder="扫描库位码 / 物料码" @scan="onScan" />
      </div>

      <!-- 当前定位行录入 -->
      <div v-if="currentLine" class="pda-card current-line">
        <div class="line-title">行 {{ currentLine.lineNo }}：{{ currentLine.materialCode }}</div>
        <div class="line-sub">
          库位 {{ currentLine.locationCode }}
          <template v-if="currentLine.batchNo"> / 批次 {{ currentLine.batchNo }}</template>
          <!-- 盲盘不显示账面数 -->
          <template v-if="!task.blind && currentLine.bookQty !== undefined"> / 账面 {{ currentLine.bookQty }}</template>
        </div>
        <input
          v-model="qtyText"
          class="pda-input qty-input"
          type="number"
          inputmode="decimal"
          :placeholder="countMode === 'count' ? '实盘数量' : '复盘数量'"
        />
        <input
          v-if="countMode === 'recount'"
          v-model="reasonText"
          class="pda-input reason-input"
          type="text"
          placeholder="复盘原因（必填）"
        />
      </div>

      <!-- 待盘行列表 -->
      <div class="pda-card">
        <div class="lines-title">{{ countMode === 'count' ? '待盘行' : '待复盘行' }}（{{ pendingLines.length }}）</div>
        <div v-for="l in pendingLines" :key="l.lineNo" class="line-row" :class="{ active: currentLine?.lineNo === l.lineNo }">
          <span>{{ l.lineNo }} · {{ l.materialCode }}</span>
          <span class="line-loc">{{ l.locationCode }}</span>
        </div>
        <div v-if="!pendingLines.length" class="empty">全部完成</div>
      </div>

      <button class="pda-btn pda-btn--info back-btn" @click="backToList">返回任务列表</button>
    </template>
  </div>
</template>

<style scoped>
.empty { text-align: center; color: #909399; }
.task-item { display: block; width: 100%; text-align: left; border: none; cursor: pointer; }
.task-no { font-size: 19px; font-weight: 700; color: #303133; }
.task-status { margin-top: 4px; font-size: 15px; color: #909399; }
.blind-badge {
  margin-left: 8px; padding: 2px 8px; border-radius: 6px;
  background: #e6a100; color: #fff; font-size: 13px; font-weight: 600; vertical-align: middle;
}
.task-head .mode-tip { margin-top: 6px; font-size: 15px; color: #1f6fd6; font-weight: 600; }
.current-line .line-title { font-size: 18px; font-weight: 700; }
.current-line .line-sub { margin: 6px 0 10px; font-size: 15px; color: #606266; }
.qty-input, .reason-input { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; margin-bottom: 10px; }
.lines-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.line-row {
  display: flex; justify-content: space-between; padding: 10px 8px; border-radius: 6px;
  font-size: 16px; border-bottom: 1px solid #f0f0f0;
}
.line-row.active { background: #eaf3ff; }
.line-loc { color: #909399; }
.back-btn { width: 100%; }
</style>
