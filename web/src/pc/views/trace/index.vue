<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  exportTrace,
  traceBackward,
  traceForward,
  THEORETICAL_BOM,
  type BackwardTrace,
  type ForwardTrace
} from '@/api/trace2'

function fmtTime(v: string | null | undefined): string {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false })
}

interface TraceNode {
  title: string
  lines: string[]
  /** 缺链路段（理论 BOM 追溯）或缺失段，灰色展示 */
  missing: boolean
}

interface PhotoItem {
  url: string
  label: string
}

const activeTab = ref<'forward' | 'backward'>('forward')

/* ---------- 正向：原料批次 → 客户 ---------- */
const batchNo = ref('')
const forwardLoading = ref(false)
const forwardResult = ref<ForwardTrace | null>(null)

async function doForward() {
  const key = batchNo.value.trim()
  if (!key) {
    ElMessage.warning('请输入原料批次号')
    return
  }
  forwardLoading.value = true
  try {
    forwardResult.value = await traceForward(key)
  } finally {
    forwardLoading.value = false
  }
}

const forwardNodes = computed<TraceNode[]>(() => {
  const r = forwardResult.value
  if (!r) return []
  const nodes: TraceNode[] = []
  nodes.push(
    r.materials.length
      ? {
          title: '来料批次',
          lines: r.materials.map(
            (m) => `批次 ${r.batchNo} ｜ 物料 ${m.materialCode} ｜ 包装 ${m.packageNo} ｜ 来源单 ${m.sourceDocNo} ｜ 来料 ${fmtTime(m.receivedAt)}`
          ),
          missing: false
        }
      : { title: '来料批次', lines: [`批次 ${r.batchNo} 无库存批次记录`], missing: true }
  )
  nodes.push(
    r.workOrders.length
      ? {
          title: '生产工单',
          lines: r.workOrders.map((w) =>
            w.source === THEORETICAL_BOM
              ? `工单 ${w.workOrderId}（${THEORETICAL_BOM}）`
              : `工单 ${w.workOrderId} ｜ 产品 ${w.productCode ?? '-'} ｜ 状态 ${w.status ?? '-'}`
          ),
          missing: r.workOrders.every((w) => w.source === THEORETICAL_BOM)
        }
      : { title: '生产工单', lines: ['未关联工单'], missing: true }
  )
  nodes.push(
    r.serials.length
      ? {
          title: '成品序列号',
          lines: r.serials.map((s) => `${s.serialNo} ｜ 产品 ${s.productCode} ｜ 状态 ${s.status}`),
          missing: false
        }
      : { title: '成品序列号', lines: ['未关联成品序列号'], missing: true }
  )
  nodes.push(
    r.shipments.length
      ? {
          title: '发货单',
          lines: r.shipments.map(
            (s) => `${s.dnNo} ｜ 状态 ${s.status} ｜ 客户 ${s.customerName ?? s.customerCode} ｜ 放行 ${fmtTime(s.releasedAt)}`
          ),
          missing: false
        }
      : { title: '发货单', lines: ['未发货'], missing: true }
  )
  nodes.push(
    r.customer
      ? {
          title: '客户',
          lines: [`${r.customer.customerName ?? '-'}（${r.customer.customerCode}）`],
          missing: false
        }
      : { title: '客户', lines: ['未到客户环节'], missing: true }
  )
  return nodes
})

/* ---------- 反向：成品序列号 → 来料 ---------- */
const serialNo = ref('')
const backwardLoading = ref(false)
const backwardResult = ref<BackwardTrace | null>(null)

async function doBackward() {
  const key = serialNo.value.trim()
  if (!key) {
    ElMessage.warning('请输入成品序列号')
    return
  }
  backwardLoading.value = true
  try {
    backwardResult.value = await traceBackward(key)
  } finally {
    backwardLoading.value = false
  }
}

const backwardNodes = computed<TraceNode[]>(() => {
  const r = backwardResult.value
  if (!r) return []
  const nodes: TraceNode[] = []
  nodes.push({
    title: '成品序列号',
    lines: [`${r.serialNo} ｜ 产品 ${r.productCode} ｜ 状态 ${r.status}`],
    missing: false
  })
  nodes.push(
    r.workOrder
      ? {
          title: '生产工单',
          lines: [
            r.workOrder.source === THEORETICAL_BOM
              ? `工单 ${r.workOrder.workOrderId}（${THEORETICAL_BOM}）`
              : `工单 ${r.workOrder.workOrderId} ｜ 产品 ${r.workOrder.productCode ?? '-'} ｜ 状态 ${r.workOrder.status ?? '-'}`
          ],
          missing: r.workOrder.source === THEORETICAL_BOM
        }
      : { title: '生产工单', lines: ['序列号未绑定工单'], missing: true }
  )
  nodes.push(
    r.batches.length
      ? {
          title: '原料批次',
          lines: r.batches.map((b) =>
            b.source === THEORETICAL_BOM
              ? `物料 ${b.materialCode}（${THEORETICAL_BOM}，无批次关联）`
              : `批次 ${b.batchNo} ｜ 物料 ${b.materialCode} ｜ 包装 ${b.packageNo ?? '-'} ｜ 来料 ${fmtTime(b.receivedAt)}`
          ),
          missing: r.batches.every((b) => b.source === THEORETICAL_BOM)
        }
      : { title: '原料批次', lines: ['未关联原料批次'], missing: true }
  )
  const supplierLines = [
    ...new Set(
      r.batches
        .filter((b) => b.source !== THEORETICAL_BOM)
        .map((b) => `${b.supplierName ?? '-'}（${b.supplierCode ?? '-'}）｜ 来料日期 ${fmtTime(b.receivedAt)}`)
    )
  ]
  nodes.push(
    supplierLines.length
      ? { title: '供应商 / 来料日期', lines: supplierLines, missing: false }
      : { title: '供应商 / 来料日期', lines: ['缺链路字段，按理论 BOM 追溯'], missing: true }
  )
  nodes.push(
    r.shipment
      ? {
          title: '发货单',
          lines: [`${r.shipment.dnNo} ｜ 客户 ${r.shipment.customerName ?? r.shipment.customerCode}`],
          missing: false
        }
      : { title: '发货单', lines: ['该成品尚未发货'], missing: true }
  )
  return nodes
})

/* ---------- 关联照片（发货照片，后端补充字段后自动展示） ---------- */
const photos = computed<PhotoItem[]>(() => {
  const out: PhotoItem[] = []
  const r = forwardResult.value
  const b = backwardResult.value
  if (activeTab.value === 'forward' && r) {
    for (const s of r.shipments) {
      for (const p of s.photos ?? []) out.push({ url: p.url, label: `${s.dnNo} ${p.photoType ?? ''}`.trim() })
    }
  }
  if (activeTab.value === 'backward' && b?.shipment) {
    for (const p of b.shipment.photos ?? []) out.push({ url: p.url, label: `${b.shipment.dnNo} ${p.photoType ?? ''}`.trim() })
  }
  return out
})

/* ---------- 导出追溯报告 ---------- */
const exporting = ref(false)

async function onExport() {
  const params =
    activeTab.value === 'forward'
      ? { batchNo: batchNo.value.trim() }
      : { serialNo: serialNo.value.trim() }
  if (!params.batchNo && !params.serialNo) {
    ElMessage.warning('请先输入追溯关键字')
    return
  }
  exporting.value = true
  try {
    const csv = await exportTrace(params)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `trace-${activeTab.value}-${params.batchNo ?? params.serialNo}-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('追溯报告已导出')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div>
    <el-card>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="正向追溯（原料批次 → 客户）" name="forward">
          <el-form inline @submit.prevent>
            <el-form-item label="原料批次号">
              <el-input v-model="batchNo" clearable placeholder="如 LOT-20260724-..." style="width: 260px" @keyup.enter="doForward" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="forwardLoading" @click="doForward">追溯</el-button>
              <el-button :loading="exporting" :disabled="!forwardResult" @click="onExport">导出追溯报告</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="反向追溯（成品序列号 → 来料）" name="backward">
          <el-form inline @submit.prevent>
            <el-form-item label="成品序列号">
              <el-input v-model="serialNo" clearable placeholder="成品 SN" style="width: 260px" @keyup.enter="doBackward" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="backwardLoading" @click="doBackward">追溯</el-button>
              <el-button :loading="exporting" :disabled="!backwardResult" @click="onExport">导出追溯报告</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <div v-loading="forwardLoading || backwardLoading" class="trace-body">
        <el-timeline v-if="(activeTab === 'forward' ? forwardNodes : backwardNodes).length" style="margin-top: 12px">
          <el-timeline-item
            v-for="(node, i) in activeTab === 'forward' ? forwardNodes : backwardNodes"
            :key="i"
            :color="node.missing ? '#c0c4cc' : '#409eff'"
            :hollow="node.missing"
          >
            <div class="node-title" :class="{ missing: node.missing }">
              {{ node.title }}
              <el-tag v-if="node.missing" size="small" type="info" effect="plain">理论 BOM 追溯</el-tag>
            </div>
            <div v-for="(line, j) in node.lines" :key="j" class="node-line" :class="{ missing: node.missing }">
              {{ line }}
            </div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="输入批次号或序列号开始追溯" :image-size="90" />

        <template v-if="forwardResult || backwardResult">
          <el-divider content-position="left">关联照片</el-divider>
          <div v-if="photos.length" class="photo-list">
            <div v-for="(p, i) in photos" :key="i" class="photo-item">
              <el-image
                :src="p.url"
                :preview-src-list="photos.map((x) => x.url)"
                :initial-index="i"
                fit="cover"
                preview-teleported
                style="width: 120px; height: 90px; border-radius: 4px"
              />
              <div class="photo-label">{{ p.label }}</div>
            </div>
          </div>
          <span v-else style="color: #909399; font-size: 13px">
            暂无关联照片（发货照片在发运放行环节上传确认后关联到发货单）
          </span>
        </template>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.trace-body { min-height: 200px; }
.node-title { font-weight: 600; display: flex; align-items: center; gap: 8px; }
.node-title.missing { color: #909399; }
.node-line { color: #606266; font-size: 13px; margin-top: 2px; }
.node-line.missing { color: #a8abb2; }
.photo-list { display: flex; gap: 12px; flex-wrap: wrap; }
.photo-item { text-align: center; }
.photo-label { font-size: 12px; color: #909399; margin-top: 4px; max-width: 120px; }
</style>
