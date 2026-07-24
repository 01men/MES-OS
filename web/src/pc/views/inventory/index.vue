<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { getAvailable, queryLots, type AvailableResult, type StockLot, type StockStatus } from '@/api/inventory2'

const statusOptions: { value: StockStatus | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'QUALIFIED', label: '合格' },
  { value: 'PENDING_INSPECTION', label: '待检' },
  { value: 'ISOLATED', label: '不良/隔离' },
  { value: 'SURPLUS_YL', label: '余料' },
  { value: 'STAGING', label: '备料区' },
  { value: 'FROZEN', label: '冻结' },
  { value: 'EXPIRED', label: '过期' }
]
const statusText: Record<string, string> = Object.fromEntries(
  statusOptions.filter((o) => o.value).map((o) => [o.value, o.label])
)
const statusTagType: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
  QUALIFIED: 'success',
  PENDING_INSPECTION: 'warning',
  ISOLATED: 'danger',
  SURPLUS_YL: 'info',
  STAGING: 'primary',
  FROZEN: 'info',
  EXPIRED: 'danger'
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

const query = reactive({
  materialCode: '',
  batchNo: '',
  warehouseCode: '',
  status: '' as StockStatus | ''
})
const list = ref<StockLot[]>([])
const loading = ref(false)
const page = reactive({ current: 1, size: 10 })
const pagedList = computed(() =>
  list.value.slice((page.current - 1) * page.size, page.current * page.size)
)

async function load() {
  loading.value = true
  try {
    list.value = await queryLots({
      materialCode: query.materialCode.trim() || undefined,
      batchNo: query.batchNo.trim() || undefined,
      warehouseCode: query.warehouseCode.trim() || undefined,
      status: query.status || undefined
    })
    page.current = 1
  } finally {
    loading.value = false
  }
}

function resetQuery() {
  query.materialCode = ''
  query.batchNo = ''
  query.warehouseCode = ''
  query.status = ''
  load()
}

/* ---------- 展开行：可用量口径 ---------- */
const availableMap = reactive<Record<string, AvailableResult | 'loading' | 'error'>>({})

async function onExpand(row: StockLot, expanded: StockLot[]) {
  const code = row.materialCode
  if (!expanded.length || availableMap[code]) return
  availableMap[code] = 'loading'
  try {
    availableMap[code] = await getAvailable(code)
  } catch {
    availableMap[code] = 'error'
  }
}

function availOf(code: string): AvailableResult | null {
  const v = availableMap[code]
  return v && v !== 'loading' && v !== 'error' ? v : null
}

function exportCsv() {
  downloadCsv(
    `inventory-lots-${Date.now()}.csv`,
    ['包装号', '物料编码', '批次号', '仓库', '库位', '数量', '状态', '绑定工单', '来源单据', '入库日期', '失效日期'],
    list.value.map((r) => [
      r.packageNo,
      r.materialCode,
      r.batchNo,
      r.warehouseCode,
      r.locationCode,
      r.qty,
      statusText[r.status] ?? r.status,
      r.workOrderId,
      r.sourceDocNo,
      fmtTime(r.receivedAt),
      fmtTime(r.expiryDate)
    ])
  )
}

onMounted(load)
</script>

<template>
  <div>
    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="本页为只读台账，不直接改库存；库存变更请通过收料、备料、转移、盘点等业务单据处理。"
      style="margin-bottom: 12px"
    />
    <el-card>
      <el-form inline @submit.prevent>
        <el-form-item label="物料编码">
          <el-input v-model="query.materialCode" clearable placeholder="精确匹配" style="width: 160px" @keyup.enter="load" />
        </el-form-item>
        <el-form-item label="批次号">
          <el-input v-model="query.batchNo" clearable style="width: 160px" @keyup.enter="load" />
        </el-form-item>
        <el-form-item label="仓库">
          <el-input v-model="query.warehouseCode" clearable style="width: 130px" @keyup.enter="load" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" style="width: 130px">
            <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="load">查询</el-button>
          <el-button @click="resetQuery">重置</el-button>
          <el-button @click="exportCsv">导出 CSV</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="pagedList" border stripe row-key="id" @expand-change="onExpand">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="avail-wrap">
              <template v-if="availableMap[row.materialCode] === 'loading'">
                <span style="color: #909399">可用量计算中…</span>
              </template>
              <template v-else-if="availableMap[row.materialCode] === 'error'">
                <span style="color: #f56c6c">可用量查询失败</span>
              </template>
              <template v-else-if="availOf(row.materialCode)">
                <div class="avail-title">物料 {{ row.materialCode }} 可用量口径</div>
                <div class="avail-formula">
                  <span class="num">{{ availOf(row.materialCode)!.qualifiedQty }}</span>
                  <span class="label">合格现存</span>
                  <span class="op">−</span>
                  <span class="num">{{ availOf(row.materialCode)!.occupiedQty }}</span>
                  <span class="label">有效占用</span>
                  <span class="op">−</span>
                  <span class="num">{{ availOf(row.materialCode)!.safetyStock }}</span>
                  <span class="label">安全库存</span>
                  <span class="op">=</span>
                  <span class="num result">{{ availOf(row.materialCode)!.available }}</span>
                  <span class="label">可用</span>
                </div>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="packageNo" label="包装号" min-width="150" />
        <el-table-column prop="materialCode" label="物料编码" min-width="120" />
        <el-table-column prop="batchNo" label="批次号" min-width="170" show-overflow-tooltip />
        <el-table-column label="库位" min-width="120">
          <template #default="{ row }">{{ row.warehouseCode }} / {{ row.locationCode }}</template>
        </el-table-column>
        <el-table-column prop="qty" label="数量" width="90" align="right" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType[row.status] ?? 'info'">{{ statusText[row.status] ?? row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="绑定工单" min-width="110">
          <template #default="{ row }">{{ row.workOrderId || '-' }}</template>
        </el-table-column>
        <el-table-column prop="sourceDocNo" label="来源单据" min-width="140" show-overflow-tooltip />
        <el-table-column label="入库日期" width="165">
          <template #default="{ row }">{{ fmtTime(row.receivedAt) }}</template>
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
  </div>
</template>

<style scoped>
.avail-wrap { padding: 8px 16px; }
.avail-title { font-weight: 600; margin-bottom: 8px; }
.avail-formula { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.avail-formula .num { font-size: 20px; font-weight: 600; color: #303133; }
.avail-formula .num.result { color: #67c23a; }
.avail-formula .label { color: #909399; font-size: 12px; }
.avail-formula .op { color: #c0c4cc; font-size: 18px; }
</style>
