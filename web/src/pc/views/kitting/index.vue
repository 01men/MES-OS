<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import KeyValueDesc from '@/components/KeyValueDesc.vue'
import { getKittingBoard, type KittingBoardRow } from '@/api/prep2'

const statusText: Record<string, string> = {
  KIT: '齐套',
  SHORTAGE: '缺料',
  NO_BOM: '无 BOM'
}
const statusTagType: Record<string, 'success' | 'danger' | 'info'> = {
  KIT: 'success',
  SHORTAGE: 'danger',
  NO_BOM: 'info'
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

const queryStatus = ref<'' | 'KIT' | 'SHORTAGE' | 'NO_BOM'>('')
const board = ref<KittingBoardRow[]>([])
const loading = ref(false)
const lastRefreshAt = ref('')
const page = reactive({ current: 1, size: 10 })

const filtered = computed(() =>
  queryStatus.value ? board.value.filter((r) => r.status === queryStatus.value) : board.value
)
const pagedList = computed(() =>
  filtered.value.slice((page.current - 1) * page.size, page.current * page.size)
)

watch(queryStatus, () => {
  page.current = 1
})

async function load() {
  loading.value = true
  try {
    board.value = await getKittingBoard()
    lastRefreshAt.value = new Date().toLocaleString('zh-CN', { hour12: false })
  } finally {
    loading.value = false
  }
}

/* 30 秒自动刷新开关 */
const autoRefresh = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
watch(autoRefresh, (on) => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (on) timer = setInterval(load, 30000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function shortageCount(row: KittingBoardRow): number {
  return row.shortageLines?.length ?? 0
}

function lineRowClass({ row }: { row: { shortageQty: number } }): string {
  return row.shortageQty > 0 ? 'shortage-row' : ''
}

function exportCsv() {
  const rows: (string | number | null | undefined)[][] = []
  for (const r of filtered.value) {
    for (const l of r.lines ?? []) {
      rows.push([
        r.workOrderId,
        r.productCode,
        r.planQty,
        statusText[r.status] ?? r.status,
        l.materialCode,
        l.unit,
        l.requiredQty,
        l.available,
        l.shortageQty,
        l.visibility.qualified,
        l.visibility.pendingInspection,
        l.visibility.staging
      ])
    }
    if (!r.lines?.length) {
      rows.push([r.workOrderId, r.productCode, r.planQty, statusText[r.status] ?? r.status, r.error ?? ''])
    }
  }
  downloadCsv(
    `kitting-board-${Date.now()}.csv`,
    ['工单号', '产品', '计划数', '齐套状态', '物料编码', '单位', '需求数', '可用数', '缺口', '良品仓', '待检区', '暂不入库'],
    rows
  )
}

onMounted(load)
</script>

<template>
  <div>
    <el-card>
      <el-form inline @submit.prevent>
        <el-form-item label="齐套状态">
          <el-select v-model="queryStatus" style="width: 130px">
            <el-option value="" label="全部" />
            <el-option value="KIT" label="齐套" />
            <el-option value="SHORTAGE" label="缺料" />
            <el-option value="NO_BOM" label="无 BOM" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
          <el-button @click="exportCsv">导出 CSV</el-button>
        </el-form-item>
        <el-form-item label="自动刷新(30s)">
          <el-switch v-model="autoRefresh" />
        </el-form-item>
        <el-form-item v-if="lastRefreshAt" label="上次刷新">
          <span style="color: #909399">{{ lastRefreshAt }}</span>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="pagedList" border row-key="workOrderId">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand-wrap">
              <template v-if="row.lines?.length">
                <KeyValueDesc
                  :column="4"
                  :items="[
                    { label: 'BOM 编码', value: row.bomCode },
                    { label: '计划数量', value: row.planQty },
                    { label: '缺料行数', value: shortageCount(row) },
                    { label: '计算时间', value: fmtTime(row.computedAt) }
                  ]"
                />
                <el-table :data="row.lines" border size="small" :row-class-name="lineRowClass" style="margin-top: 8px">
                  <el-table-column prop="materialCode" label="物料编码" min-width="130" />
                  <el-table-column prop="unit" label="单位" width="70" align="center" />
                  <el-table-column prop="requiredQty" label="需求数" width="100" align="right" />
                  <el-table-column prop="available" label="可用数" width="100" align="right" />
                  <el-table-column label="缺口" width="100" align="right">
                    <template #default="{ row: line }">
                      <span :style="line.shortageQty > 0 ? 'color:#f56c6c;font-weight:600' : ''">
                        {{ line.shortageQty }}
                      </span>
                    </template>
                  </el-table-column>
                  <el-table-column label="良品仓" width="100" align="right">
                    <template #default="{ row: line }">{{ line.visibility.qualified }}</template>
                  </el-table-column>
                  <el-table-column label="待检区" width="100" align="right">
                    <template #default="{ row: line }">{{ line.visibility.pendingInspection }}</template>
                  </el-table-column>
                  <el-table-column label="暂不入库" width="100" align="right">
                    <template #default="{ row: line }">{{ line.visibility.staging }}</template>
                  </el-table-column>
                </el-table>
              </template>
              <el-alert
                v-else
                type="info"
                :closable="false"
                show-icon
                :title="row.error ? `无法计算齐套：${row.error}` : '无物料行明细'"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="workOrderId" label="工单号" min-width="130" />
        <el-table-column prop="productCode" label="产品" min-width="120" />
        <el-table-column prop="planQty" label="计划数" width="90" align="right" />
        <el-table-column label="齐套状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType[row.status] ?? 'info'">{{ statusText[row.status] ?? row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="缺料行数" width="100" align="right">
          <template #default="{ row }">
            <span :style="shortageCount(row) > 0 ? 'color:#f56c6c;font-weight:600' : ''">{{ shortageCount(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="workOrderStatus" label="工单状态" width="110" align="center" />
        <el-table-column prop="planDate" label="计划日期" width="120" />
      </el-table>

      <el-pagination
        v-model:current-page="page.current"
        v-model:page-size="page.size"
        :total="filtered.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        style="margin-top: 12px; justify-content: flex-end"
      />
    </el-card>
  </div>
</template>

<style scoped>
.expand-wrap { padding: 4px 16px; }
:deep(.shortage-row) { background: #fef0f0; }
</style>
