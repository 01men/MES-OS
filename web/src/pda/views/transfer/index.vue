<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import { enqueue } from '@/api/offline'
import { createTransfer, fetchTodos, confirmReplenish } from '@/api/transfer'

interface ReplenishTodo {
  id: string
  todoId?: string
  workOrderId?: string
  materialCode?: string
  batchNo?: string
  qty?: number
  status?: string
}

const sourceWorkOrderId = ref('')
const targetWorkOrderId = ref('')
const materialCode = ref('')
const batchNo = ref('')
const qtyText = ref('')
const submitting = ref(false)
const todos = ref<ReplenishTodo[]>([])

const fb = ref<{ type: 'success' | 'error' | 'duplicate' | 'offline'; msg: string; detail?: string }>({
  type: 'success',
  msg: ''
})
function setFb(type: typeof fb.value.type, msg: string, detail = '') {
  fb.value = { type, msg, detail }
}

const formValid = computed(
  () =>
    !!sourceWorkOrderId.value.trim() &&
    !!targetWorkOrderId.value.trim() &&
    !!materialCode.value.trim() &&
    Number(qtyText.value) > 0
)

async function submit() {
  if (!formValid.value || submitting.value) return
  submitting.value = true
  const payload = {
    sourceWorkOrderId: sourceWorkOrderId.value.trim(),
    targetWorkOrderId: targetWorkOrderId.value.trim(),
    materialCode: materialCode.value.trim(),
    batchNo: batchNo.value.trim() || undefined,
    qty: Number(qtyText.value)
  }
  try {
    const res = await createTransfer(payload)
    const approvalId = res.data?.approvalId
    if (approvalId) {
      setFb('duplicate', '已提交班组长审批', `专用件挪料审批单：${approvalId}`)
    } else {
      setFb('success', '挪料成功')
    }
    materialCode.value = ''
    batchNo.value = ''
    qtyText.value = ''
    await loadTodos()
  } catch (err: any) {
    if (!err?.response) {
      enqueue({ url: '/transfer', method: 'post', data: payload })
      setFb('offline', '已离线暂存，联网后自动同步')
      materialCode.value = ''
      batchNo.value = ''
      qtyText.value = ''
    } else {
      const msg = err.response.data?.message
      setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '挪料提交失败'))
    }
  } finally {
    submitting.value = false
  }
}

async function loadTodos() {
  try {
    const res = await fetchTodos()
    todos.value = res.data ?? []
  } catch {
    todos.value = []
  }
}

async function confirmTodo(t: ReplenishTodo) {
  const id = t.todoId ?? t.id
  try {
    await confirmReplenish(id)
    setFb('success', '已确认补回', t.materialCode ?? '')
    await loadTodos()
  } catch (err: any) {
    const msg = err?.response?.data?.message
    setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '确认补回失败'))
  }
}

watchEffect(() => {
  setPdaActions([
    {
      label: submitting.value ? '提交中…' : '提交挪料',
      type: 'primary',
      disabled: !formValid.value || submitting.value,
      onClick: submit
    }
  ])
})

onMounted(loadTodos)
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.msg" :detail="fb.detail" />

    <div class="pda-card">
      <div class="field-label">源工单号</div>
      <input v-model="sourceWorkOrderId" class="pda-input field" type="text" placeholder="扫/输源工单号" />
      <div class="field-label">目标工单号</div>
      <input v-model="targetWorkOrderId" class="pda-input field" type="text" placeholder="扫/输目标工单号" />
      <div class="field-label">物料编码</div>
      <input v-model="materialCode" class="pda-input field" type="text" placeholder="扫/输物料编码" />
      <div class="field-label">批次号（选填）</div>
      <input v-model="batchNo" class="pda-input field" type="text" placeholder="批次号" />
      <div class="field-label">数量</div>
      <input v-model="qtyText" class="pda-input field" type="number" inputmode="decimal" placeholder="挪料数量" />
    </div>

    <div class="pda-card">
      <div class="section-title">补料待办（{{ todos.length }}）</div>
      <div v-if="!todos.length" class="empty">暂无待补回任务</div>
      <div v-for="t in todos" :key="t.todoId ?? t.id" class="todo-row">
        <div class="todo-info">
          <div class="todo-title">{{ t.materialCode ?? '-' }} × {{ t.qty ?? '-' }}</div>
          <div class="todo-sub">工单 {{ t.workOrderId ?? '-' }}<template v-if="t.batchNo"> · 批次 {{ t.batchNo }}</template></div>
        </div>
        <button class="pda-btn pda-btn--success confirm-btn" @click="confirmTodo(t)">确认补回</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field-label { font-size: 15px; color: #606266; margin: 10px 0 4px; font-weight: 600; }
.field-label:first-child { margin-top: 0; }
.field { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; }
.section-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.empty { text-align: center; color: #909399; padding: 8px 0; }
.todo-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
.todo-row:last-child { border-bottom: none; }
.todo-info { flex: 1; min-width: 0; }
.todo-title { font-size: 17px; font-weight: 700; }
.todo-sub { margin-top: 2px; font-size: 14px; color: #909399; }
.confirm-btn { flex: 0 0 110px; min-height: 48px; font-size: 16px; }
</style>
