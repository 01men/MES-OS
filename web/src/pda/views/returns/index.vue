<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import { enqueue } from '@/api/offline'
import { createReturn, createReplenish, type ReturnType, type ReplenishType } from '@/api/returns'

type BizKind = ReturnType | ReplenishType
const BIZ_OPTIONS: Array<{ key: BizKind; label: string; isReturn: boolean }> = [
  { key: 'DEFECT', label: '不良退料', isReturn: true },
  { key: 'NORMAL', label: '正常退料', isReturn: true },
  { key: 'OVER_ISSUE', label: '超领退料', isReturn: true },
  { key: 'TRANSFER_ONLY', label: '补料-余量调拨', isReturn: false },
  { key: 'RETURN_AND_REPLENISH', label: '一退一补', isReturn: false },
  { key: 'DIRECT', label: '直接补料', isReturn: false }
]

const biz = ref<BizKind>('DEFECT')
const workOrderId = ref('')
const materialCode = ref('')
const batchNo = ref('')
const qtyText = ref('')
const reason = ref('')
const defectRecordId = ref('')
const returnOrderId = ref('')
const submitting = ref(false)
/** 提交结果（审批状态展示） */
const resultText = ref('')

const fb = ref<{ type: 'success' | 'error' | 'duplicate' | 'offline'; msg: string; detail?: string }>({
  type: 'success',
  msg: ''
})
function setFb(type: typeof fb.value.type, msg: string, detail = '') {
  fb.value = { type, msg, detail }
}

const current = computed(() => BIZ_OPTIONS.find((o) => o.key === biz.value)!)
const isDefect = computed(() => biz.value === 'DEFECT')
const needReturnOrder = computed(() => biz.value === 'RETURN_AND_REPLENISH')

const formValid = computed(() => {
  if (!workOrderId.value.trim() || !materialCode.value.trim() || Number(qtyText.value) <= 0) return false
  if (current.value.isReturn && !batchNo.value.trim()) return false
  if (isDefect.value && !defectRecordId.value.trim()) return false
  return true
})

async function submit() {
  if (!formValid.value || submitting.value) return
  submitting.value = true
  resultText.value = ''
  try {
    if (current.value.isReturn) {
      const payload = {
        workOrderId: workOrderId.value.trim(),
        type: biz.value as ReturnType,
        materialCode: materialCode.value.trim(),
        batchNo: batchNo.value.trim(),
        qty: Number(qtyText.value),
        reason: reason.value.trim() || undefined,
        defectRecordId: isDefect.value ? defectRecordId.value.trim() : undefined
      }
      try {
        const res = await createReturn(payload)
        showResult(res.data)
      } catch (err: any) {
        if (!err?.response) {
          enqueue({ url: '/returns', method: 'post', data: payload })
          setFb('offline', '已离线暂存，联网后自动同步')
          return
        }
        throw err
      }
    } else {
      const payload = {
        workOrderId: workOrderId.value.trim(),
        type: biz.value as ReplenishType,
        materialCode: materialCode.value.trim(),
        qty: Number(qtyText.value),
        returnOrderId: needReturnOrder.value ? returnOrderId.value.trim() || undefined : undefined
      }
      try {
        const res = await createReplenish(payload)
        showResult(res.data)
      } catch (err: any) {
        if (!err?.response) {
          enqueue({ url: '/returns/replenish', method: 'post', data: payload })
          setFb('offline', '已离线暂存，联网后自动同步')
          return
        }
        throw err
      }
    }
  } catch (err: any) {
    // 后端业务错误（如超阈值）原样展示
    const msg = err?.response?.data?.message
    setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '提交失败'))
  } finally {
    submitting.value = false
  }
}

function showResult(data: any) {
  const approvalId = data?.approvalId
  const status = data?.status
  if (approvalId) {
    resultText.value = `已提交审批（${approvalId}）${status ? ' · ' + status : ''}`
    setFb('success', `${current.value.label}已提交`, '等待审批')
  } else {
    resultText.value = status ? `状态：${status}` : '提交成功'
    setFb('success', `${current.value.label}成功`, status ?? '')
  }
  qtyText.value = ''
  reason.value = ''
  defectRecordId.value = ''
}

watchEffect(() => {
  setPdaActions([
    {
      label: submitting.value ? '提交中…' : `提交${current.value.label}`,
      type: 'primary',
      disabled: !formValid.value || submitting.value,
      onClick: submit
    }
  ])
})
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.msg" :detail="fb.detail" />

    <div class="pda-card">
      <div class="field-label">业务类型</div>
      <div class="biz-grid">
        <button
          v-for="o in BIZ_OPTIONS"
          :key="o.key"
          class="biz-btn"
          :class="{ active: biz === o.key }"
          @click="biz = o.key"
        >{{ o.label }}</button>
      </div>
    </div>

    <div class="pda-card">
      <div class="field-label">工单号</div>
      <input v-model="workOrderId" class="pda-input field" type="text" placeholder="扫/输工单号" />
      <div class="field-label">物料编码</div>
      <input v-model="materialCode" class="pda-input field" type="text" placeholder="扫/输物料编码" />
      <template v-if="current.isReturn">
        <div class="field-label">批次号</div>
        <input v-model="batchNo" class="pda-input field" type="text" placeholder="批次号" />
      </template>
      <div class="field-label">数量</div>
      <input v-model="qtyText" class="pda-input field" type="number" inputmode="decimal" placeholder="数量" />
      <template v-if="isDefect">
        <div class="field-label">不良记录号（必填）</div>
        <input v-model="defectRecordId" class="pda-input field" type="text" placeholder="关联不良记录号" />
      </template>
      <template v-if="needReturnOrder">
        <div class="field-label">关联退料单号（选填）</div>
        <input v-model="returnOrderId" class="pda-input field" type="text" placeholder="退料单号" />
      </template>
      <template v-if="current.isReturn">
        <div class="field-label">原因（选填）</div>
        <input v-model="reason" class="pda-input field" type="text" placeholder="退料原因" />
      </template>
    </div>

    <div v-if="resultText" class="pda-card result-box">{{ resultText }}</div>
  </div>
</template>

<style scoped>
.field-label { font-size: 15px; color: #606266; margin: 10px 0 4px; font-weight: 600; }
.field-label:first-child { margin-top: 0; }
.field { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; }
.biz-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.biz-btn {
  min-height: 52px; border: 2px solid #dcdfe6; border-radius: 10px; background: #fff;
  font-size: 17px; font-weight: 600; color: #303133; cursor: pointer;
}
.biz-btn.active { border-color: #1f6fd6; background: #eaf3ff; color: #1f6fd6; }
.result-box { font-size: 17px; font-weight: 700; color: #22a355; text-align: center; }
</style>
