<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import KeyValueDesc from '@/components/KeyValueDesc.vue'
import {
  createNote,
  getNote,
  listNotes,
  pullNotes,
  type DocStatus,
  type NoteSummary
} from '@/api/shipping2'

const statusOptions: { value: DocStatus | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'DRAFT', label: '待发货' },
  { value: 'PENDING_APPROVAL', label: '少发审批中' },
  { value: 'APPROVED', label: '少发已批' },
  { value: 'PENDING_SYNC', label: '待同步' },
  { value: 'SYNCED', label: '已放行' },
  { value: 'SYNC_ERROR', label: '同步失败' },
  { value: 'REVERSED', label: '已冲销' },
  { value: 'VOID', label: '已作废' }
]
const statusText: Record<string, string> = Object.fromEntries(
  statusOptions.filter((o) => o.value).map((o) => [o.value, o.label])
)
const statusTagType: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'primary'> = {
  DRAFT: 'warning',
  PENDING_APPROVAL: 'danger',
  APPROVED: 'primary',
  PENDING_SYNC: 'primary',
  SYNCED: 'success',
  SYNC_ERROR: 'danger',
  REVERSED: 'info',
  VOID: 'info'
}
const shortageStatusText: Record<string, string> = {
  PENDING_APPROVAL: '待审批',
  APPROVED: '已批准',
  REJECTED: '已驳回'
}
const reshipStatusText: Record<string, string> = {
  OPEN: '待补发',
  RESHIPPED: '已补发'
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
const queryStatus = ref<DocStatus | ''>('DRAFT')
const list = ref<NoteSummary[]>([])
const loading = ref(false)
const pulling = ref(false)
const page = reactive({ current: 1, size: 10 })
const pagedList = computed(() =>
  list.value.slice((page.current - 1) * page.size, page.current * page.size)
)

async function load() {
  loading.value = true
  try {
    list.value = await listNotes(queryStatus.value || undefined)
    page.current = 1
  } finally {
    loading.value = false
  }
}

async function onPullNotes() {
  pulling.value = true
  try {
    const res = await pullNotes()
    ElMessage.success(`从 U8 拉取 ${res.pulled} 条：新建 ${res.created.length} 条，跳过已存在 ${res.skipped.length} 条`)
    await load()
  } finally {
    pulling.value = false
  }
}

function exportCsv() {
  downloadCsv(
    `delivery-notes-${Date.now()}.csv`,
    ['发货单号', '客户编码', '客户名称', '来源', '行数', '应发', '已扫', '欠发', '状态', '装柜顺序'],
    list.value.map((r) => [
      r.dnNo,
      r.customerCode,
      r.customerName,
      r.source,
      r.lines.length,
      r.expectedQty,
      r.scannedQty,
      r.shortageQty,
      statusText[r.status] ?? r.status,
      (r.loadingSequence ?? []).join('>')
    ])
  )
}

/* ---------- 详情抽屉 ---------- */
const drawerVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<NoteSummary | null>(null)

async function openDetail(row: NoteSummary) {
  drawerVisible.value = true
  detailLoading.value = true
  try {
    detail.value = await getNote(row.id)
  } finally {
    detailLoading.value = false
  }
}

const scanPercent = computed(() => {
  const d = detail.value
  if (!d || !d.expectedQty) return 0
  return Math.min(100, Math.round((d.scannedQty / d.expectedQty) * 100))
})

/* ---------- 新建发货单 ---------- */
const createVisible = ref(false)
const creating = ref(false)
const createForm = reactive({
  customerCode: '',
  lines: [] as { orderNo: string; productCode: string; qty: number }[]
})
/** 装柜顺序：明细中不重复的订单号，按数组顺序装柜 */
const sequence = ref<string[]>([])

function openCreate() {
  createForm.customerCode = ''
  createForm.lines = [{ orderNo: '', productCode: '', qty: 1 }]
  sequence.value = []
  createVisible.value = true
}

function addLine() {
  createForm.lines.push({ orderNo: '', productCode: '', qty: 1 })
}
function removeLine(i: number) {
  createForm.lines.splice(i, 1)
  rebuildSequence()
}
/** 订单号变化后同步装柜顺序列表（保留已有顺序，追加新订单号） */
function rebuildSequence() {
  const orders = [...new Set(createForm.lines.map((l) => l.orderNo.trim()).filter(Boolean))]
  sequence.value = [
    ...sequence.value.filter((o) => orders.includes(o)),
    ...orders.filter((o) => !sequence.value.includes(o))
  ]
}
function moveSeq(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= sequence.value.length) return
  const arr = [...sequence.value]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  sequence.value = arr
}

async function submitCreate() {
  if (!createForm.customerCode.trim()) {
    ElMessage.warning('请填写客户编码')
    return
  }
  const lines = createForm.lines.filter((l) => l.productCode.trim() && l.qty > 0)
  if (!lines.length) {
    ElMessage.warning('请至少填写一行有效明细（产品编码 + 数量）')
    return
  }
  creating.value = true
  try {
    const note = await createNote({
      customerCode: createForm.customerCode.trim(),
      lines: lines.map((l) => ({
        orderNo: l.orderNo.trim() || undefined,
        productCode: l.productCode.trim(),
        qty: Number(l.qty)
      })),
      loadingSequence: sequence.value.length ? sequence.value : undefined
    })
    ElMessage.success(`发货单 ${note.dnNo} 已创建`)
    createVisible.value = false
    await load()
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <el-card>
      <el-form inline @submit.prevent>
        <el-form-item label="状态">
          <el-select v-model="queryStatus" style="width: 140px" @change="load">
            <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="load">查询</el-button>
          <el-button type="warning" :loading="pulling" @click="onPullNotes">从 U8 同步</el-button>
          <el-button type="success" @click="openCreate">新建发货单</el-button>
          <el-button @click="exportCsv">导出 CSV</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="pagedList" border stripe>
        <el-table-column prop="dnNo" label="发货单号" min-width="150" />
        <el-table-column label="客户" min-width="150">
          <template #default="{ row }">
            {{ row.customerName ? `${row.customerName}（${row.customerCode}）` : row.customerCode }}
          </template>
        </el-table-column>
        <el-table-column label="行数" width="70" align="right">
          <template #default="{ row }">{{ row.lines.length }}</template>
        </el-table-column>
        <el-table-column prop="expectedQty" label="应发" width="90" align="right" />
        <el-table-column prop="scannedQty" label="已扫" width="90" align="right" />
        <el-table-column label="欠发" width="90" align="right">
          <template #default="{ row }">
            <span :style="row.shortageQty > 0 ? 'color:#f56c6c;font-weight:600' : ''">{{ row.shortageQty }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType[row.status] ?? 'info'">{{ statusText[row.status] ?? row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="装柜顺序" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.loadingSequence?.length ? row.loadingSequence.join(' → ') : '默认（按明细顺序）' }}
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="80" align="center" />
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
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

    <!-- 详情抽屉 -->
    <el-drawer v-model="drawerVisible" title="发货单详情" size="720px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <KeyValueDesc
            :column="3"
            :items="[
              { label: '发货单号', value: detail.dnNo },
              { label: '客户', value: detail.customerName ? `${detail.customerName}（${detail.customerCode}）` : detail.customerCode },
              { label: '来源', value: detail.source },
              { label: '状态', value: statusText[detail.status] ?? detail.status },
              { label: '装柜顺序', value: detail.loadingSequence?.length ? detail.loadingSequence.join(' → ') : '默认', span: 2 },
              { label: '仓管员确认', value: detail.keeperConfirmBy },
              { label: '司机', value: detail.driverName },
              { label: '放行时间', value: fmtTime(detail.releasedAt) }
            ]"
          />

          <el-divider content-position="left">扫码进度</el-divider>
          <el-progress :percentage="scanPercent" :status="scanPercent >= 100 ? 'success' : undefined" />
          <p style="color: #606266; margin: 8px 0">
            应发 {{ detail.expectedQty }} / 已扫 {{ detail.scannedQty }} / 欠发
            <b :style="detail.shortageQty > 0 ? 'color:#f56c6c' : ''">{{ detail.shortageQty }}</b>
            <template v-if="detail.nextExpected">
              ｜下一待扫：{{ detail.nextExpected.orderNo }} / {{ detail.nextExpected.productCode }}（余 {{ detail.nextExpected.remaining }}）
            </template>
          </p>

          <el-table :data="detail.lines" border size="small">
            <el-table-column prop="orderNo" label="订单号" min-width="130" />
            <el-table-column prop="productCode" label="产品编码" min-width="120" />
            <el-table-column prop="qty" label="应发" width="80" align="right" />
            <el-table-column prop="scannedQty" label="已扫" width="80" align="right" />
            <el-table-column label="欠发" width="80" align="right">
              <template #default="{ row }">
                <span :style="row.shortageQty > 0 ? 'color:#f56c6c;font-weight:600' : ''">{{ row.shortageQty }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="unit" label="单位" width="70" align="center" />
          </el-table>

          <template v-if="detail.shortages.length">
            <el-divider content-position="left">欠发记录</el-divider>
            <el-table :data="detail.shortages" border size="small">
              <el-table-column prop="orderNo" label="订单号" min-width="120" />
              <el-table-column prop="productCode" label="产品编码" min-width="110" />
              <el-table-column prop="qty" label="欠发数" width="80" align="right" />
              <el-table-column prop="reason" label="少发原因" min-width="140" show-overflow-tooltip />
              <el-table-column label="审批状态" width="100" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'APPROVED' ? 'success' : row.status === 'REJECTED' ? 'info' : 'danger'" size="small">
                    {{ shortageStatusText[row.status] ?? row.status }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="补发状态" width="100" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.reshipStatus === 'RESHIPPED' ? 'success' : 'warning'" size="small">
                    {{ reshipStatusText[row.reshipStatus] ?? row.reshipStatus }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </template>
      </div>
    </el-drawer>

    <!-- 新建发货单 -->
    <el-dialog v-model="createVisible" title="新建发货单" width="760px" :close-on-click-modal="false">
      <el-form label-width="90px">
        <el-form-item label="客户编码" required>
          <el-input v-model="createForm.customerCode" placeholder="客户编码（主数据）" style="width: 260px" />
        </el-form-item>
        <el-form-item label="发货明细" required>
          <div style="width: 100%">
            <div v-for="(line, i) in createForm.lines" :key="i" class="line-row">
              <el-input v-model="line.orderNo" placeholder="订单号（可空）" style="width: 180px" @blur="rebuildSequence" />
              <el-input v-model="line.productCode" placeholder="产品编码" style="width: 180px" />
              <el-input-number v-model="line.qty" :min="1" style="width: 140px" />
              <el-button link type="danger" :disabled="createForm.lines.length <= 1" @click="removeLine(i)">删除</el-button>
            </div>
            <el-button link type="primary" @click="addLine">+ 添加明细行</el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="sequence.length" label="装柜顺序">
          <div style="width: 100%">
            <div v-for="(o, i) in sequence" :key="o" class="seq-row">
              <span class="seq-no">{{ i + 1 }}</span>
              <span style="flex: 1">{{ o }}</span>
              <el-button link type="primary" :disabled="i === 0" @click="moveSeq(i, -1)">上移</el-button>
              <el-button link type="primary" :disabled="i === sequence.length - 1" @click="moveSeq(i, 1)">下移</el-button>
            </div>
            <p style="color: #909399; font-size: 12px; margin: 4px 0 0">
              装柜顺序按订单号排列；不设置则默认按明细下单顺序。
            </p>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.line-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.seq-row { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px dashed #e4e7ed; }
.seq-no {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%;
  background: #409eff; color: #fff; font-size: 12px;
}
</style>
