<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import KeyValueDesc from '@/components/KeyValueDesc.vue'
import {
  confirmArrival,
  getArrival,
  listArrivals,
  submitIqc,
  type ArrivalDetail,
  type ArrivalRow,
  type ArrivalStatus,
  type IqcDecision
} from '@/api/receiving2'

const statusOptions: { value: ArrivalStatus | ''; label: string }[] = [
  { value: 'INSPECTING', label: '待检' },
  { value: 'INSPECTED', label: '已判定' },
  { value: 'CONFIRMED', label: '已入库' },
  { value: 'ARRIVED', label: '到货暂存' },
  { value: '', label: '全部' }
]

const statusText: Record<string, string> = {
  ARRIVED: '到货暂存',
  INSPECTING: '待检',
  INSPECTED: '已判定',
  CONFIRMED: '已入库'
}
const statusTagType: Record<string, 'info' | 'warning' | 'success' | 'primary'> = {
  ARRIVED: 'info',
  INSPECTING: 'warning',
  INSPECTED: 'primary',
  CONFIRMED: 'success'
}
const decisionText: Record<string, string> = {
  ALL: '全部接收',
  PARTIAL: '部分接收',
  CONCESSION: '特采'
}
const syncText: Record<string, string> = {
  PENDING_SYNC: '待同步 U8',
  SYNCED: '已同步 U8',
  SYNC_ERROR: '同步失败'
}

function fmtTime(v: string | null | undefined): string {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false })
}

function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n'
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/* ---------- 列表 ---------- */
const queryStatus = ref<ArrivalStatus | ''>('INSPECTING')
const list = ref<ArrivalRow[]>([])
const loading = ref(false)
const page = reactive({ current: 1, size: 10 })
const pagedList = computed(() =>
  list.value.slice((page.current - 1) * page.size, page.current * page.size)
)

async function load() {
  loading.value = true
  try {
    list.value = await listArrivals(queryStatus.value || undefined)
    page.current = 1
  } finally {
    loading.value = false
  }
}

function exportCsv() {
  downloadCsv(
    `iqc-arrivals-${Date.now()}.csv`,
    ['到货单号', '采购订单', '物料编码', '供应商', '到货数量', 'ABC类', '状态', 'IQC判定', '创建时间'],
    list.value.map((r) => [
      r.arrivalNo,
      r.poNo,
      r.materialCode,
      r.supplierCode,
      r.qty,
      r.abcClass,
      statusText[r.status] ?? r.status,
      r.iqcDecision ? decisionText[r.iqcDecision] : '',
      fmtTime(r.createdAt)
    ])
  )
}

/* ---------- 详情抽屉 ---------- */
const drawerVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<ArrivalDetail | null>(null)

async function openDetail(row: ArrivalRow) {
  drawerVisible.value = true
  detailLoading.value = true
  try {
    detail.value = await getArrival(row.id)
    resetIqcForm()
  } finally {
    detailLoading.value = false
  }
}

const detailItems = computed(() => {
  const d = detail.value
  if (!d) return []
  return [
    { label: '到货单号', value: d.arrivalNo },
    { label: '采购订单', value: d.poNo },
    { label: '物料编码', value: d.materialCode },
    { label: '供应商', value: d.supplierCode },
    { label: '到货数量', value: d.qty },
    { label: 'ABC 类', value: d.abcClass },
    { label: '批次号', value: d.batchNo },
    { label: '包装号', value: d.packageNo },
    { label: '仓库/库位', value: `${d.warehouseCode} / ${d.locationCode}` },
    { label: '清点方式', value: d.countMode },
    { label: '实扫数量', value: d.scannedQty },
    { label: '委外', value: d.isOutsource ? '是' : '否' },
    { label: '到货时间', value: fmtTime(d.createdAt) },
    { label: 'U8 同步', value: d.syncStatus ? (syncText[d.syncStatus] ?? d.syncStatus) : '未同步' }
  ]
})

/* ---------- IQC 判定表单 ---------- */
const iqcForm = reactive({
  decision: 'ALL' as IqcDecision,
  qualifiedQty: 0,
  rejectedQty: 0,
  concessionQty: 0,
  pendingQty: 0,
  defectDescription: ''
})
const submitting = ref(false)

function resetIqcForm() {
  const qty = detail.value?.qty ?? 0
  iqcForm.decision = 'ALL'
  iqcForm.qualifiedQty = qty
  iqcForm.rejectedQty = 0
  iqcForm.concessionQty = 0
  iqcForm.pendingQty = 0
  iqcForm.defectDescription = ''
}

function onDecisionChange(v: IqcDecision) {
  const qty = detail.value?.qty ?? 0
  if (v === 'ALL') {
    iqcForm.qualifiedQty = qty
    iqcForm.rejectedQty = 0
    iqcForm.concessionQty = 0
    iqcForm.pendingQty = 0
  } else if (v === 'CONCESSION') {
    iqcForm.concessionQty = qty
    iqcForm.qualifiedQty = 0
    iqcForm.rejectedQty = 0
    iqcForm.pendingQty = 0
  }
}

const sumQty = computed(
  () =>
    Number(iqcForm.qualifiedQty || 0) +
    Number(iqcForm.rejectedQty || 0) +
    Number(iqcForm.concessionQty || 0) +
    Number(iqcForm.pendingQty || 0)
)
const conserved = computed(() => detail.value !== null && Math.abs(sumQty.value - detail.value.qty) < 1e-9)
const needDefect = computed(() => Number(iqcForm.rejectedQty || 0) > 0 || Number(iqcForm.concessionQty || 0) > 0)
const canSubmit = computed(() => {
  if (!detail.value || !conserved.value) return false
  if (iqcForm.decision === 'ALL' && (iqcForm.rejectedQty > 0 || iqcForm.concessionQty > 0 || iqcForm.pendingQty > 0)) return false
  if (iqcForm.decision === 'CONCESSION' && Number(iqcForm.concessionQty || 0) <= 0) return false
  if (needDefect.value && !iqcForm.defectDescription.trim()) return false
  return true
})

async function submitIqcForm() {
  const d = detail.value
  if (!d) return
  submitting.value = true
  try {
    const res = await submitIqc(d.id, {
      decision: iqcForm.decision,
      qualifiedQty: Number(iqcForm.qualifiedQty || 0),
      rejectedQty: Number(iqcForm.rejectedQty || 0),
      concessionQty: Number(iqcForm.concessionQty || 0),
      pendingQty: Number(iqcForm.pendingQty || 0),
      defectDescription: iqcForm.defectDescription.trim() || undefined
    })
    if (res.approvalId) {
      ElMessage.success(`判定已提交，已发起 MRB 会签审批（审批单 #${res.approvalId}），审批通过前不得入库`)
    } else {
      ElMessage.success('IQC 判定已提交')
    }
    detail.value = await getArrival(d.id)
    await load()
  } finally {
    submitting.value = false
  }
}

/* ---------- 确认入库 ---------- */
const confirming = ref(false)

async function confirmInbound() {
  const d = detail.value
  if (!d) return
  await ElMessageBox.confirm(
    `确认将到货单 ${d.arrivalNo} 入库/隔离过账？合格 ${d.qualifiedQty ?? 0}，不合格 ${d.rejectedQty ?? 0}，特采 ${d.concessionQty ?? 0}`,
    '确认入库',
    { type: 'warning' }
  )
  confirming.value = true
  try {
    await confirmArrival(d.id, d.countMode === 'MANUAL_REVIEW' ? { manualReview: true } : {})
    ElMessage.success('已确认入库，同步任务已入队')
    detail.value = await getArrival(d.id)
    await load()
  } finally {
    confirming.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <el-card>
      <el-form inline @submit.prevent>
        <el-form-item label="单据状态">
          <el-select v-model="queryStatus" style="width: 140px" @change="load">
            <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="load">查询</el-button>
          <el-button @click="exportCsv">导出 CSV</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="pagedList" border stripe>
        <el-table-column prop="arrivalNo" label="到货单号" min-width="150" />
        <el-table-column prop="materialCode" label="物料编码" min-width="120" />
        <el-table-column prop="supplierCode" label="供应商" min-width="110" />
        <el-table-column prop="qty" label="到货数量" width="100" align="right" />
        <el-table-column prop="abcClass" label="ABC 类" width="90" align="center" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType[row.status] ?? 'info'">{{ statusText[row.status] ?? row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="IQC 判定" width="100" align="center">
          <template #default="{ row }">
            <span v-if="row.iqcDecision">{{ decisionText[row.iqcDecision] }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="到货时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">
              {{ row.status === 'INSPECTING' ? '检验' : '详情' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page.current"
        v-model:page-size="page.size"
        :total="list.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        style="margin-top: 12px; justify-content: flex-end"
      />
    </el-card>

    <el-drawer v-model="drawerVisible" title="到货单详情 / IQC 检验" size="720px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <KeyValueDesc :column="3" :items="detailItems" />

          <!-- 已判定：四分量与入库操作 -->
          <template v-if="detail.status !== 'INSPECTING'">
            <el-divider content-position="left">IQC 判定结果</el-divider>
            <KeyValueDesc
              :column="4"
              :items="[
                { label: '判定方式', value: detail.iqcDecision ? decisionText[detail.iqcDecision] : '-' },
                { label: '合格', value: detail.qualifiedQty },
                { label: '不合格', value: detail.rejectedQty },
                { label: '特采', value: detail.concessionQty },
                { label: '待处理', value: detail.pendingQty },
                { label: '缺陷描述', value: detail.defectDescription, span: 2 },
                { label: 'MRB 审批单', value: detail.approvalId ? `#${detail.approvalId}` : '-' }
              ]"
            />
          </template>

          <!-- 待检：判定表单 -->
          <template v-else>
            <el-divider content-position="left">IQC 判定</el-divider>
            <el-alert
              v-if="iqcForm.decision === 'CONCESSION'"
              type="warning"
              show-icon
              :closable="false"
              title="特采将发起 MRB 会签审批，无审批不得入库"
              style="margin-bottom: 12px"
            />
            <el-form label-width="90px">
              <el-form-item label="判定方式">
                <el-radio-group v-model="iqcForm.decision" @change="onDecisionChange">
                  <el-radio value="ALL">全部接收</el-radio>
                  <el-radio value="PARTIAL">部分接收</el-radio>
                  <el-radio value="CONCESSION">特采</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="数量分配">
                <div class="qty-grid">
                  <span>合格</span>
                  <el-input-number v-model="iqcForm.qualifiedQty" :min="0" :max="detail.qty" :disabled="iqcForm.decision === 'ALL'" />
                  <span>不合格</span>
                  <el-input-number v-model="iqcForm.rejectedQty" :min="0" :max="detail.qty" :disabled="iqcForm.decision === 'ALL'" />
                  <span>特采</span>
                  <el-input-number v-model="iqcForm.concessionQty" :min="0" :max="detail.qty" :disabled="iqcForm.decision === 'ALL'" />
                  <span>待处理</span>
                  <el-input-number v-model="iqcForm.pendingQty" :min="0" :max="detail.qty" :disabled="iqcForm.decision === 'ALL'" />
                </div>
                <div :class="['conserve-tip', conserved ? 'ok' : 'err']">
                  合计 {{ sumQty }} / 到货 {{ detail.qty }}
                  <template v-if="!conserved">（数量不守恒，四项之和须等于到货数）</template>
                </div>
              </el-form-item>
              <el-form-item label="缺陷描述">
                <el-input
                  v-model="iqcForm.defectDescription"
                  type="textarea"
                  :rows="2"
                  :placeholder="needDefect ? '存在不合格/特采数量时必填' : '选填'"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submitIqcForm">
                  提交判定
                </el-button>
              </el-form-item>
            </el-form>
          </template>

          <!-- NCR 不合格报告 -->
          <template v-if="detail.ncrReports.length">
            <el-divider content-position="left">NCR 不合格报告</el-divider>
            <el-table :data="detail.ncrReports" border size="small">
              <el-table-column prop="ncrNo" label="报告号" min-width="140" />
              <el-table-column prop="qty" label="数量" width="80" align="right" />
              <el-table-column prop="defectDescription" label="缺陷描述" min-width="160" show-overflow-tooltip />
              <el-table-column prop="notifyRoles" label="推送对象" width="110" />
              <el-table-column prop="status" label="状态" width="90" align="center" />
            </el-table>
          </template>

          <!-- 入库过账 -->
          <template v-if="detail.postings.length">
            <el-divider content-position="left">入库过账</el-divider>
            <el-table :data="detail.postings" border size="small">
              <el-table-column prop="packageNo" label="包装号" min-width="140" />
              <el-table-column prop="qty" label="数量" width="80" align="right" />
              <el-table-column prop="status" label="库存状态" width="110" />
              <el-table-column label="特采" width="70" align="center">
                <template #default="{ row }">{{ row.concession ? '是' : '否' }}</template>
              </el-table-column>
              <el-table-column prop="sourcePoNo" label="来源采购单" min-width="120" />
            </el-table>
          </template>

          <div v-if="detail.status === 'INSPECTED'" style="margin-top: 16px; text-align: right">
            <el-button type="primary" :loading="confirming" @click="confirmInbound">确认入库</el-button>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.qty-grid {
  display: grid;
  grid-template-columns: 56px 160px 56px 160px;
  gap: 8px 12px;
  align-items: center;
}
.conserve-tip { margin-top: 8px; font-size: 12px; }
.conserve-tip.ok { color: #67c23a; }
.conserve-tip.err { color: #f56c6c; }
</style>
