<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listSyncLogs,
  replaySync,
  reconcile,
  type SyncTask,
  type ReconcileResult
} from '@/api/integration2'

const all = ref<SyncTask[]>([])
const loading = ref(false)
const statusFilter = ref('')
/** 默认仅显示近 24 小时 */
const only24h = ref(true)

async function load() {
  loading.value = true
  try {
    const res = await listSyncLogs()
    all.value = res.data
  } finally {
    loading.value = false
  }
}

const rows = computed(() => {
  let list = all.value
  if (only24h.value) {
    const since = Date.now() - 24 * 3600 * 1000
    list = list.filter((t) => new Date(t.createdAt).getTime() >= since)
  }
  if (statusFilter.value) list = list.filter((t) => t.status === statusFilter.value)
  return list
})

const stats = computed(() => ({
  pending: all.value.filter((t) => t.status === 'PENDING_SYNC').length,
  synced: all.value.filter((t) => t.status === 'SYNCED').length,
  error: all.value.filter((t) => t.status === 'SYNC_ERROR').length
}))

function rowClass({ row }: { row: SyncTask }) {
  return row.status === 'SYNC_ERROR' ? 'sync-error-row' : ''
}

/* ---------- 人工重放 ---------- */
const replaying = ref<number | null>(null)

async function onReplay(row: SyncTask) {
  await ElMessageBox.confirm(
    `确认人工重放同步任务 ${row.bizType} / ${row.bizKey}？（幂等，可安全重复执行）`,
    '人工重放',
    { type: 'warning' }
  )
  replaying.value = row.id
  try {
    await replaySync(row.id)
    ElMessage.success('重放完成')
    load()
  } finally {
    replaying.value = null
  }
}

/* ---------- 日终对账 ---------- */
const reconcileVisible = ref(false)
const reconcileLoading = ref(false)
const reconcileResult = ref<ReconcileResult | null>(null)

async function onReconcile() {
  reconcileLoading.value = true
  try {
    const res = await reconcile()
    reconcileResult.value = res.data
    reconcileVisible.value = true
  } finally {
    reconcileLoading.value = false
  }
}

const STATUS_TAG: Record<string, { text: string; type: 'warning' | 'success' | 'danger' }> = {
  PENDING_SYNC: { text: '待同步', type: 'warning' },
  SYNCED: { text: '已同步', type: 'success' },
  SYNC_ERROR: { text: '同步异常', type: 'danger' }
}

onMounted(load)
</script>

<template>
  <div>
    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="8">
        <el-card>
          <el-statistic title="待同步" :value="stats.pending" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card>
          <el-statistic title="已同步" :value="stats.synced" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card>
          <el-statistic title="同步异常" :value="stats.error" />
        </el-card>
      </el-col>
    </el-row>

    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <div>
            <el-select
              v-model="statusFilter"
              placeholder="状态筛选"
              clearable
              style="width: 140px; margin-right: 8px"
            >
              <el-option label="待同步" value="PENDING_SYNC" />
              <el-option label="已同步" value="SYNCED" />
              <el-option label="同步异常" value="SYNC_ERROR" />
            </el-select>
            <el-checkbox v-model="only24h" style="margin-right: 8px">仅近 24 小时</el-checkbox>
            <el-button @click="load">刷新</el-button>
          </div>
          <el-button type="primary" :loading="reconcileLoading" @click="onReconcile">日终对账</el-button>
        </div>
      </template>
      <el-table
        v-loading="loading"
        :data="rows"
        border
        stripe
        :row-class-name="rowClass"
        max-height="560"
      >
        <el-table-column prop="bizType" label="业务类型" width="130" />
        <el-table-column prop="bizKey" label="业务单号" min-width="160" />
        <el-table-column prop="voucherType" label="凭证类型" width="120" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status]?.type ?? 'info'">
              {{ STATUS_TAG[row.status]?.text ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="attempts" label="重试次数" width="90" align="right" />
        <el-table-column prop="lastError" label="最近错误" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.lastError || '-' }}</template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="170" />
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :loading="replaying === row.id"
              :disabled="row.status === 'SYNCED'"
              @click="onReplay(row)"
            >
              人工重放
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="reconcileVisible" title="日终对账差异清单" width="75%">
      <template v-if="reconcileResult">
        <el-alert
          :type="
            reconcileResult.inMesNotU8.length === 0 && reconcileResult.inU8NotMes.length === 0
              ? 'success'
              : 'warning'
          "
          show-icon
          :closable="false"
          :title="`MES 已同步 ${reconcileResult.mesSyncedCount} 笔，U8 凭证 ${reconcileResult.u8VoucherCount} 笔`"
          style="margin-bottom: 12px"
        />
        <el-row :gutter="16">
          <el-col :span="12">
            <h4>MES 有 / U8 无（{{ reconcileResult.inMesNotU8.length }}）</h4>
            <el-table :data="reconcileResult.inMesNotU8.map((k) => ({ bizKey: k }))" border stripe max-height="420">
              <el-table-column prop="bizKey" label="业务单号（bizKey）" />
            </el-table>
          </el-col>
          <el-col :span="12">
            <h4>U8 有 / MES 无（{{ reconcileResult.inU8NotMes.length }}）</h4>
            <el-table :data="reconcileResult.inU8NotMes.map((k) => ({ bizKey: k }))" border stripe max-height="420">
              <el-table-column prop="bizKey" label="业务单号（bizKey）" />
            </el-table>
          </el-col>
        </el-row>
      </template>
      <template #footer>
        <el-button type="primary" @click="reconcileVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:deep(.sync-error-row) {
  background: #fef0f0;
}
</style>
