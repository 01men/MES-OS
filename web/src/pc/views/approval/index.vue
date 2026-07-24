<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import KeyValueDesc from '@/components/KeyValueDesc.vue'
import { useAuthStore } from '@/stores/auth'
import {
  listTodo,
  listDone,
  listMine,
  listAll,
  approve,
  reject,
  parseSteps,
  type ApprovalOrder,
  type ApprovalStep
} from '@/api/approval2'

const auth = useAuthStore()
const activeTab = ref('todo')

const rows = ref<ApprovalOrder[]>([])
const loading = ref(false)

const STATUS_TAG: Record<string, { text: string; type: 'warning' | 'success' | 'danger' | 'info' }> = {
  PENDING: { text: '待审批', type: 'warning' },
  APPROVED: { text: '已通过', type: 'success' },
  REJECTED: { text: '已拒绝', type: 'danger' },
  WITHDRAWN: { text: '已撤回', type: 'info' }
}

const loaders: Record<string, () => Promise<{ data: ApprovalOrder[] }>> = {
  todo: listTodo,
  done: listDone,
  mine: listMine,
  all: listAll
}

async function load() {
  loading.value = true
  try {
    const res = await loaders[activeTab.value]()
    rows.value = res.data
  } finally {
    loading.value = false
  }
}

function onTabChange() {
  load()
}

/** 当前步骤描述 */
function currentStepText(row: ApprovalOrder): string {
  const steps = parseSteps(row.steps)
  if (row.status !== 'PENDING') return STATUS_TAG[row.status]?.text ?? row.status
  const idx = row.currentStep ?? steps.findIndex((s) => s.status === 'PENDING')
  const step = steps[idx]
  if (!step) return `第 ${idx + 1} 步`
  const who = step.approverRole ?? step.userId ?? '-'
  return `第 ${idx + 1}/${steps.length} 步 · ${who}`
}

/** 自审拦截：自己发起的单即使在「待我审批」也不显示操作按钮（后端同样强校验） */
function canAct(row: ApprovalOrder): boolean {
  if (row.status !== 'PENDING') return false
  return row.applicantId !== auth.user?.username
}

/* ---------- 同意 / 拒绝 ---------- */
async function onApprove(row: ApprovalOrder) {
  const { value } = await ElMessageBox.prompt('审批意见（可选）', `同意 · ${row.bizType} ${row.bizId}`, {
    confirmButtonText: '同意',
    cancelButtonText: '取消',
    inputPlaceholder: '可留空'
  })
  await approve(row.id, value || undefined)
  ElMessage.success('已同意')
  load()
}

async function onReject(row: ApprovalOrder) {
  const { value } = await ElMessageBox.prompt('请输入拒绝原因（必填）', `拒绝 · ${row.bizType} ${row.bizId}`, {
    confirmButtonText: '拒绝',
    cancelButtonText: '取消',
    inputPlaceholder: '拒绝原因',
    inputValidator: (v) => (!!v && !!v.trim()) || '拒绝原因必填'
  })
  await reject(row.id, value.trim())
  ElMessage.success('已拒绝')
  load()
}

/* ---------- 详情抽屉 ---------- */
const drawerVisible = ref(false)
const current = ref<ApprovalOrder | null>(null)
const currentSteps = computed<ApprovalStep[]>(() => (current.value ? parseSteps(current.value.steps) : []))
const activeStep = computed(() => {
  if (!current.value) return 0
  if (current.value.status !== 'PENDING') return currentSteps.value.length
  return current.value.currentStep ?? currentSteps.value.findIndex((s) => s.status === 'PENDING')
})

function stepStatus(s: ApprovalStep): 'wait' | 'process' | 'finish' | 'error' {
  if (s.status === 'APPROVED') return 'finish'
  if (s.status === 'REJECTED') return 'error'
  return 'wait'
}

function openDetail(row: ApprovalOrder) {
  current.value = row
  drawerVisible.value = true
}

onMounted(load)
</script>

<template>
  <div>
    <el-card>
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane label="待我审批" name="todo" />
        <el-tab-pane label="我已审批" name="done" />
        <el-tab-pane label="我发起的" name="mine" />
        <el-tab-pane label="全部（管理员）" name="all" />
      </el-tabs>
      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column prop="bizType" label="业务类型" width="150" />
        <el-table-column prop="bizId" label="业务单号" min-width="150" />
        <el-table-column label="发起人" width="120">
          <template #default="{ row }">{{ row.applicantName || row.applicantId }}</template>
        </el-table-column>
        <el-table-column label="当前步骤" min-width="170">
          <template #default="{ row }">{{ currentStepText(row) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status]?.type ?? 'info'">
              {{ STATUS_TAG[row.status]?.text ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="发起时间" width="170" />
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <template v-if="activeTab === 'todo' && canAct(row)">
              <el-button link type="success" @click="onApprove(row)">同意</el-button>
              <el-button link type="danger" @click="onReject(row)">拒绝</el-button>
            </template>
            <el-tooltip
              v-else-if="activeTab === 'todo' && row.status === 'PENDING'"
              content="自己发起的审批单不可自审"
              placement="top"
            >
              <span style="color: #c0c4cc; font-size: 12px">不可自审</span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="drawerVisible" size="520px" title="审批详情">
      <template v-if="current">
        <KeyValueDesc
          :column="2"
          :items="[
            { label: '审批单号', value: current.id },
            { label: '业务类型', value: current.bizType },
            { label: '业务单据号', value: current.bizId },
            { label: '发起人', value: current.applicantName || current.applicantId },
            { label: '状态', value: STATUS_TAG[current.status]?.text ?? current.status },
            { label: '发起时间', value: current.createdAt },
            { label: '拒绝原因', value: current.rejectReason || '-', span: 2 }
          ]"
        />
        <h4 style="margin: 20px 0 12px">审批步骤链</h4>
        <el-steps direction="vertical" :active="activeStep">
          <el-step
            v-for="(s, i) in currentSteps"
            :key="i"
            :title="`步骤 ${i + 1}：${s.approverRole ?? s.userId ?? '-'}`"
            :status="stepStatus(s)"
          >
            <template #description>
              <div style="font-size: 12px; color: #909399">
                <div v-if="s.actedBy">操作人：{{ s.actedBy }}</div>
                <div v-if="s.actedAt">时间：{{ s.actedAt }}</div>
                <div v-if="s.comment">意见：{{ s.comment }}</div>
                <div v-if="s.status === 'PENDING'">等待审批</div>
              </div>
            </template>
          </el-step>
        </el-steps>
      </template>
    </el-drawer>
  </div>
</template>
