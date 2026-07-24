<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import ScanInput from '@/components/ScanInput.vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import { useAuthStore } from '@/stores/auth'
import {
  getKittingBoard,
  getKitting,
  createPrepTask,
  getPrepTask,
  scanPackage,
  suspendTask,
  completeTask,
  type BoardItem,
  type KittingResult,
  type PrepTask
} from '@/api/prep'

const auth = useAuthStore()

type FbType = 'success' | 'error' | 'duplicate' | 'offline'
const fb = reactive<{ type: FbType; message: string; detail: string }>({
  type: 'success',
  message: '',
  detail: ''
})
function showFb(type: FbType, message: string, detail = '') {
  fb.type = type
  fb.detail = detail
  fb.message = message
}
function errMsg(e: any): string {
  const m = e?.response?.data?.message
  if (m) return Array.isArray(m) ? String(m[0]) : String(m)
  return '网络异常，请检查网络后重试'
}

/* ---------- 工单看板 ---------- */
const board = ref<BoardItem[]>([])
const boardLoading = ref(false)

function isKitting(item: BoardItem): boolean {
  return item.kitting === true || item.status === 'KITTED' || item.status === '齐套'
}

async function loadBoard() {
  boardLoading.value = true
  try {
    const res = await getKittingBoard()
    board.value = Array.isArray(res.data) ? res.data : []
  } catch (e: any) {
    showFb('error', '工单看板加载失败', errMsg(e))
  } finally {
    boardLoading.value = false
  }
}

/* ---------- 选工单 + 齐套检查 ---------- */
const selectedWo = ref('')
const kitting = ref<KittingResult | null>(null)
const expandedWo = ref('')

async function selectWorkOrder(workOrderId: string) {
  selectedWo.value = workOrderId
  kitting.value = null
  try {
    const res = await getKitting(workOrderId)
    kitting.value = res.data
  } catch (e: any) {
    showFb('error', '齐套检查失败', errMsg(e))
  }
}

/** 备料清单按推荐储位排序 */
const sortedLines = computed(() => {
  const lines = kitting.value?.lines ?? []
  return [...lines].sort((a, b) =>
    String(a.recommendedLocation ?? a.locationCode ?? '').localeCompare(
      String(b.recommendedLocation ?? b.locationCode ?? '')
    )
  )
})

/* ---------- 创建备料任务（含紧急生产强制创建） ---------- */
const task = ref<PrepTask | null>(null)
const shortageMsg = ref('')
const emergencyReason = ref('')
const creating = ref(false)

async function createTask(force = false) {
  if (!selectedWo.value || creating.value) return
  if (force && !emergencyReason.value.trim()) {
    showFb('error', '请填写紧急生产原因')
    return
  }
  creating.value = true
  try {
    const res = await createPrepTask(selectedWo.value, force ? emergencyReason.value.trim() : undefined)
    task.value = res.data
    shortageMsg.value = ''
    showFb('success', `备料任务已创建：${task.value.prepDocNo ?? task.value.id}`)
    await refreshTask()
  } catch (e: any) {
    const code = e?.response?.data?.code ?? e?.response?.data?.errorCode
    const msg = errMsg(e)
    if (e?.response?.status === 400 && (code === 'KITTING_SHORTAGE' || msg.includes('缺料'))) {
      shortageMsg.value = msg
      showFb('error', '未齐套，无法直接创建任务', '可填写紧急生产原因强制创建')
    } else {
      showFb('error', '创建备料任务失败', msg)
    }
  } finally {
    creating.value = false
  }
}

async function refreshTask() {
  if (!task.value) return
  try {
    const res = await getPrepTask(task.value.id)
    task.value = res.data
  } catch {
    /* 刷新失败保留本地状态 */
  }
}

/* ---------- 扫包装码累计 ---------- */
const scanningPkg = ref(false)
const lastScans = ref<Record<string, { time: string; user: string }>>({})

async function onScanPackage(packageNo: string) {
  if (!task.value || scanningPkg.value) return
  scanningPkg.value = true
  try {
    const res = await scanPackage(task.value.id, { packageNo })
    const data = res.data
    if (data?.duplicated) {
      const first = lastScans.value[packageNo]
      const detail = data.firstScanTime
        ? `首次：${data.firstScanTime}${data.firstScanUser ? ' / ' + data.firstScanUser : ''}`
        : first
          ? `首次：${first.time} / ${first.user}`
          : '该包装码已扫描过'
      showFb('duplicate', `重复扫码：${packageNo}`, detail)
    } else {
      lastScans.value[packageNo] = {
        time: new Date().toLocaleString(),
        user: auth.user?.username ?? ''
      }
      showFb('success', `已扫描：${packageNo}`)
    }
    await refreshTask()
  } catch (e: any) {
    showFb('error', `扫码失败：${packageNo}`, errMsg(e))
  } finally {
    scanningPkg.value = false
  }
}

/* ---------- 进度 ---------- */
const taskLines = computed(() => task.value?.lines ?? [])
const totalRequired = computed(() => taskLines.value.reduce((s, l) => s + (l.requiredQty ?? 0), 0))
const totalScanned = computed(() => taskLines.value.reduce((s, l) => s + (l.scannedQty ?? 0), 0))
const progressPct = computed(() =>
  totalRequired.value > 0 ? Math.min(100, Math.round((totalScanned.value / totalRequired.value) * 100)) : 0
)

/* ---------- 暂存 / 完成 ---------- */
async function onSuspend() {
  if (!task.value) return
  try {
    await suspendTask(task.value.id)
    showFb('success', '已暂存，可稍后继续备料')
  } catch (e: any) {
    showFb('error', '暂存失败', errMsg(e))
  }
}

async function onComplete() {
  if (!task.value) return
  try {
    const res = await completeTask(task.value.id)
    const docNo = res.data?.prepDocNo ?? task.value.prepDocNo ?? task.value.id
    showFb('success', `备料完成，备料单号：${docNo}`)
    task.value = res.data ?? task.value
  } catch (e: any) {
    showFb('error', '完成备料失败', errMsg(e))
  }
}

onMounted(() => {
  void loadBoard()
  setPdaActions([
    { label: '暂存', type: 'warning', onClick: () => void onSuspend() },
    { label: '完成备料', type: 'success', onClick: () => void onComplete() }
  ])
})
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.message" :detail="fb.detail" />

    <!-- 工单看板：齐套可选，未齐套展示缺料明细 -->
    <div class="pda-card">
      <div class="prep-card-title">
        选择工单{{ boardLoading ? '（加载中…）' : '' }}
        <button class="prep-reload" @click="loadBoard">刷新</button>
      </div>
      <div v-if="!board.length && !boardLoading" class="prep-empty">暂无可备料工单</div>
      <div
        v-for="w in board"
        :key="w.workOrderId"
        class="prep-wo"
        :class="{ 'prep-wo--active': selectedWo === w.workOrderId, 'prep-wo--short': !isKitting(w) }"
      >
        <div class="prep-wo-head" @click="isKitting(w) ? selectWorkOrder(w.workOrderId) : (expandedWo = expandedWo === w.workOrderId ? '' : w.workOrderId)">
          <b>{{ w.workOrderId }}</b>
          <span :class="isKitting(w) ? 'prep-tag--ok' : 'prep-tag--short'" class="prep-tag">
            {{ isKitting(w) ? '齐套' : '未齐套' }}
          </span>
        </div>
        <!-- 未齐套缺料明细 -->
        <div v-if="!isKitting(w) && expandedWo === w.workOrderId" class="prep-shortage">
          <div v-for="(l, i) in w.shortageLines ?? []" :key="i" class="prep-shortage-line">
            {{ l.materialCode }} 缺 {{ l.shortageQty }}（需求 {{ l.requiredQty }} / 可用 {{ l.available }}）
          </div>
          <div v-if="!(w.shortageLines ?? []).length" class="prep-empty">缺料明细待后端返回</div>
        </div>
      </div>
    </div>

    <!-- 齐套清单（按推荐储位排序） -->
    <div v-if="kitting" class="pda-card">
      <div class="prep-card-title">备料清单（按推荐储位排序）</div>
      <div v-for="(l, i) in sortedLines" :key="i" class="prep-line">
        <div class="prep-line-main">
          <b>{{ l.materialCode }}</b>
          <span class="prep-loc">{{ l.recommendedLocation ?? l.locationCode ?? '-' }}</span>
        </div>
        <div class="prep-line-sub">
          需求 {{ l.requiredQty }} / 可用 {{ l.available }}
          <template v-if="l.visibility">
            （合格 {{ l.visibility.qualified }} / 待检 {{ l.visibility.pendingInspection }} / 待发 {{ l.visibility.staging }}）
          </template>
        </div>
      </div>
      <div v-if="!sortedLines.length" class="prep-empty">无备料明细</div>
      <button
        v-if="!task"
        class="pda-btn pda-btn--primary prep-block-btn"
        :disabled="creating"
        @click="createTask(false)"
      >
        创建备料任务
      </button>
    </div>

    <!-- 缺料 + 紧急生产强制创建 -->
    <div v-if="shortageMsg" class="pda-card prep-shortage-card">
      <div class="prep-card-title">缺料明细</div>
      <div class="prep-shortage-msg">{{ shortageMsg }}</div>
      <label class="prep-label">紧急生产原因（强制创建必填）</label>
      <input v-model="emergencyReason" class="pda-input prep-input" type="text" placeholder="如：客户加急订单" />
      <button class="pda-btn pda-btn--danger prep-block-btn" :disabled="creating" @click="createTask(true)">
        紧急生产，强制创建任务
      </button>
    </div>

    <!-- 备料任务：扫包装码累计 -->
    <div v-if="task" class="pda-card">
      <div class="prep-card-title">备料任务：{{ task.prepDocNo ?? task.id }}</div>

      <!-- 应备/已备 进度条 -->
      <div class="prep-progress-text">应备 {{ totalRequired }} / 已备 {{ totalScanned }}（{{ progressPct }}%）</div>
      <div class="prep-progress">
        <div class="prep-progress-bar" :style="{ width: progressPct + '%' }"></div>
      </div>

      <div class="prep-lines-scan">
        <div v-for="(l, i) in taskLines" :key="i" class="prep-line">
          <div class="prep-line-main">
            <b>{{ l.materialCode }}</b>
            <span class="prep-loc">{{ l.recommendedLocation ?? l.locationCode ?? '-' }}</span>
          </div>
          <div class="prep-line-sub" :class="{ 'prep-line-sub--done': (l.scannedQty ?? 0) >= l.requiredQty }">
            已备 {{ l.scannedQty ?? 0 }} / {{ l.requiredQty }}
          </div>
        </div>
      </div>

      <ScanInput
        placeholder="扫描包装码"
        :disabled="scanningPkg"
        @scan="onScanPackage"
      />
    </div>
  </div>
</template>

<style scoped>
.prep-card-title { font-size: 17px; font-weight: 700; margin-bottom: 10px; color: #303133; display: flex; justify-content: space-between; align-items: center; }
.prep-reload { border: 1px solid #1f6fd6; color: #1f6fd6; background: #fff; border-radius: 6px; font-size: 14px; padding: 6px 14px; }
.prep-empty { color: #a8abb2; font-size: 15px; padding: 6px 0; }
.prep-wo { border: 1px solid #ebeef5; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.prep-wo--active { border-color: #1f6fd6; background: #eaf3ff; }
.prep-wo--short { background: #fdf6ec; }
.prep-wo-head { display: flex; justify-content: space-between; align-items: center; font-size: 17px; }
.prep-tag { font-size: 13px; font-weight: 600; border-radius: 4px; padding: 2px 8px; }
.prep-tag--ok { color: #22a355; background: #e8f7ee; }
.prep-tag--short { color: #d93026; background: #fdecea; }
.prep-shortage { margin-top: 8px; font-size: 14px; }
.prep-shortage-line { color: #d93026; padding: 3px 0; }
.prep-shortage-card { border: 1px solid #f5c2c0; }
.prep-shortage-msg { color: #d93026; font-size: 14px; word-break: break-all; margin-bottom: 8px; }
.prep-label { display: block; font-size: 15px; color: #606266; margin: 10px 0 4px; }
.prep-input { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; }
.prep-block-btn { width: 100%; margin-top: 12px; }
.prep-line { border-top: 1px solid #ebeef5; padding: 8px 0; }
.prep-line:first-of-type { border-top: none; }
.prep-line-main { display: flex; justify-content: space-between; font-size: 16px; }
.prep-loc { color: #1f6fd6; font-weight: 600; }
.prep-line-sub { font-size: 14px; color: #909399; margin-top: 2px; }
.prep-line-sub--done { color: #22a355; font-weight: 600; }
.prep-progress-text { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
.prep-progress { height: 16px; border-radius: 8px; background: #ebeef5; overflow: hidden; margin-bottom: 10px; }
.prep-progress-bar { height: 100%; background: #22a355; transition: width 0.2s; }
.prep-lines-scan { margin-bottom: 10px; }
</style>
