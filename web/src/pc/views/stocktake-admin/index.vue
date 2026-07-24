<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import KeyValueDesc from '@/components/KeyValueDesc.vue'
import {
  listStrategies,
  createStrategy,
  generateTasks,
  listTasks,
  getTask,
  freezeTask,
  unfreezeTask,
  postAdjustments,
  getReport,
  getAging,
  type StocktakeStrategy,
  type StocktakeTask,
  type StocktakeTaskDetail,
  type StocktakeReport,
  type AgingRow,
  type ReconcileLine
} from '@/api/stocktake2'

const activeTab = ref('strategy')

const TASK_STATUS: Record<string, { text: string; type: 'info' | 'warning' | 'success' }> = {
  OPEN: { text: '待盘', type: 'info' },
  COUNTING: { text: '盘点中', type: 'warning' },
  COMPLETED: { text: '已完成', type: 'success' }
}
const LINE_STATUS: Record<string, string> = {
  PENDING: '待盘',
  COUNTED: '初盘已交',
  RECOUNTED: '复盘已交',
  POSTED: '已过账'
}

/* ---------- Tab1 策略配置 ---------- */
const strategies = ref<StocktakeStrategy[]>([])
const strategyLoading = ref(false)
const strategyDlg = ref(false)
const strategyFormRef = ref<FormInstance>()
const strategySubmitting = ref(false)
const strategyForm = reactive({
  name: '',
  scopeType: 'ABC' as 'ABC' | 'MATERIAL' | 'AREA',
  scopeValue: 'A',
  cycleDays: 30,
  ownerUserId: ''
})
const strategyRules: FormRules = {
  name: [{ required: true, message: '请输入策略名称', trigger: 'blur' }],
  scopeType: [{ required: true, message: '请选择范围类型', trigger: 'change' }],
  scopeValue: [{ required: true, message: '请输入范围值', trigger: 'blur' }],
  cycleDays: [{ required: true, message: '请输入盘点周期（天）', trigger: 'blur' }],
  ownerUserId: [{ required: true, message: '请输入责任人', trigger: 'blur' }]
}

async function loadStrategies() {
  strategyLoading.value = true
  try {
    const res = await listStrategies()
    strategies.value = res.data
  } finally {
    strategyLoading.value = false
  }
}

async function submitStrategy() {
  await strategyFormRef.value?.validate()
  strategySubmitting.value = true
  try {
    await createStrategy({ ...strategyForm })
    ElMessage.success('策略已创建')
    strategyDlg.value = false
    loadStrategies()
  } finally {
    strategySubmitting.value = false
  }
}

/* ---------- Tab2 任务管理 ---------- */
const tasks = ref<StocktakeTask[]>([])
const taskLoading = ref(false)
const taskStatusFilter = ref('')
const generating = ref(false)

async function loadTasks() {
  taskLoading.value = true
  try {
    const res = await listTasks(taskStatusFilter.value || undefined)
    tasks.value = res.data
  } finally {
    taskLoading.value = false
  }
}

async function onGenerate() {
  generating.value = true
  try {
    await generateTasks()
    ElMessage.success('盘点任务已按策略生成')
    loadTasks()
  } finally {
    generating.value = false
  }
}

/* 任务详情抽屉 */
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<StocktakeTaskDetail | null>(null)

async function openDetail(row: StocktakeTask) {
  detailVisible.value = true
  detailLoading.value = true
  try {
    const res = await getTask(row.id)
    detail.value = res.data
  } finally {
    detailLoading.value = false
  }
}

async function onFreeze(mode: 'HARD' | 'SOFT') {
  if (!detail.value) return
  await ElMessageBox.confirm(
    mode === 'HARD'
      ? '硬冻结：范围内批次立即转为 FROZEN，禁止出入库。确认冻结？'
      : '软冻结：以快照为基准、变动隔离记录，需审批通过后生效。确认发起？',
    '冻结确认',
    { type: 'warning' }
  )
  const res = await freezeTask(detail.value.id, mode)
  if (mode === 'SOFT' && res.data?.id) {
    ElMessage.warning(`软冻结已提交审批（审批单 #${res.data.id}），审批通过后生效`)
  } else {
    ElMessage.success('已冻结')
  }
  openDetail(detail.value)
  loadTasks()
}

/* 软冻结解冻对账清单 */
const reconcileVisible = ref(false)
const reconcileRows = ref<ReconcileLine[]>([])

async function onUnfreeze() {
  if (!detail.value) return
  await ElMessageBox.confirm('确认解冻？软冻结将执行逐笔对账。', '解冻确认', { type: 'warning' })
  const res = await unfreezeTask(detail.value.id)
  const data = res.data
  if (data.mode === 'SOFT' && data.reconciliation) {
    reconcileRows.value = data.reconciliation
    reconcileVisible.value = true
  } else {
    ElMessage.success(`已解冻（硬冻结恢复 ${data.restored?.length ?? 0} 个批次）`)
  }
  openDetail(detail.value)
  loadTasks()
}

async function onPostAdjustments() {
  if (!detail.value) return
  await ElMessageBox.confirm(
    '差异过账将按实盘数调整库存台账（需审批通过）。确认过账？',
    '差异过账',
    { type: 'warning' }
  )
  await postAdjustments(detail.value.id)
  ElMessage.success('差异过账已提交')
  openDetail(detail.value)
  loadTasks()
}

/* ---------- Tab3 盘点报告 + 库龄 ---------- */
const reportTaskId = ref<number | undefined>()
const report = ref<StocktakeReport | null>(null)
const reportLoading = ref(false)

async function loadReport() {
  if (!reportTaskId.value) return
  reportLoading.value = true
  try {
    const res = await getReport(reportTaskId.value)
    report.value = res.data
  } finally {
    reportLoading.value = false
  }
}

function pct(v: number | null | undefined): string {
  return v == null ? '-' : `${(v * 100).toFixed(2)}%`
}

const agingRows = ref<AgingRow[]>([])
const agingLoading = ref(false)

async function loadAging() {
  agingLoading.value = true
  try {
    const res = await getAging()
    agingRows.value = res.data
  } finally {
    agingLoading.value = false
  }
}

function agingRowClass({ row }: { row: AgingRow }) {
  if (row.level === 'REINSPECT_DUE') return 'aging-danger'
  if (row.level === 'WARN_3M') return 'aging-warn'
  return ''
}

onMounted(() => {
  loadStrategies()
  loadTasks()
  loadAging()
})
</script>

<template>
  <div>
    <el-tabs v-model="activeTab">
      <!-- ========== Tab1 策略配置 ========== -->
      <el-tab-pane label="策略配置" name="strategy">
        <el-card>
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center">
              <span>盘点策略</span>
              <el-button type="primary" @click="strategyDlg = true">新建策略</el-button>
            </div>
          </template>
          <el-alert
            type="info"
            show-icon
            :closable="false"
            title="循环盘点默认周期：A 类 30 天 / B 类 90 天 / C 类 180 天；A 类及高风险物料默认盲盘（初盘人不可见账面数）。"
            style="margin-bottom: 12px"
          />
          <el-table v-loading="strategyLoading" :data="strategies" border stripe>
            <el-table-column prop="name" label="策略名称" min-width="160" />
            <el-table-column prop="scopeType" label="范围类型" width="110" />
            <el-table-column prop="scopeValue" label="范围值" width="120" />
            <el-table-column prop="cycleDays" label="周期（天）" width="100" align="right" />
            <el-table-column prop="ownerUserId" label="责任人" width="120" />
            <el-table-column label="启用" width="80">
              <template #default="{ row }">
                <el-tag :type="row.active ? 'success' : 'info'">{{ row.active ? '启用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" min-width="160" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- ========== Tab2 任务管理 ========== -->
      <el-tab-pane label="任务管理" name="task">
        <el-card>
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center">
              <div>
                <el-select
                  v-model="taskStatusFilter"
                  placeholder="状态筛选"
                  clearable
                  style="width: 140px; margin-right: 8px"
                  @change="loadTasks"
                >
                  <el-option label="待盘" value="OPEN" />
                  <el-option label="盘点中" value="COUNTING" />
                  <el-option label="已完成" value="COMPLETED" />
                </el-select>
                <el-button @click="loadTasks">刷新</el-button>
              </div>
              <el-button type="primary" :loading="generating" @click="onGenerate">生成任务</el-button>
            </div>
          </template>
          <el-table v-loading="taskLoading" :data="tasks" border stripe>
            <el-table-column prop="taskNo" label="任务号" width="170" />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">{{ row.taskType === 'ANNUAL' ? '年度盘点' : '循环盘点' }}</template>
            </el-table-column>
            <el-table-column label="盲盘" width="70">
              <template #default="{ row }">
                <el-tag v-if="row.blind" type="warning">盲盘</el-tag>
                <span v-else>明盘</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="TASK_STATUS[row.status]?.type ?? 'info'">
                  {{ TASK_STATUS[row.status]?.text ?? row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="冻结" width="110">
              <template #default="{ row }">
                <el-tag v-if="row.freezeActive" type="danger">
                  {{ row.freezeMode === 'HARD' ? '硬冻结中' : '软冻结中' }}
                </el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column prop="generatedDate" label="生成日期" width="120" />
            <el-table-column prop="ownerUserId" label="责任人" width="110">
              <template #default="{ row }">{{ row.ownerUserId || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- ========== Tab3 盘点报告 ========== -->
      <el-tab-pane label="盘点报告" name="report">
        <el-card style="margin-bottom: 16px">
          <template #header>差异汇总报表</template>
          <div style="margin-bottom: 12px">
            <el-select
              v-model="reportTaskId"
              placeholder="选择盘点任务"
              style="width: 260px; margin-right: 8px"
              filterable
            >
              <el-option v-for="t in tasks" :key="t.id" :label="t.taskNo" :value="t.id" />
            </el-select>
            <el-button type="primary" :loading="reportLoading" :disabled="!reportTaskId" @click="loadReport">
              查询报告
            </el-button>
          </div>
          <template v-if="report">
            <KeyValueDesc
              :column="4"
              :items="[
                { label: '任务号', value: report.taskNo },
                { label: '状态', value: TASK_STATUS[report.status]?.text ?? report.status },
                { label: '账面合计', value: report.totals.bookQty },
                { label: '实盘合计', value: report.totals.actualQty },
                { label: '差异合计', value: report.totals.diff },
                { label: '差异率', value: pct(report.totals.diffRate) },
                { label: '已过账差异', value: report.totals.postedDiff },
                { label: '三账一致性', value: report.consistency.consistent == null ? '未完成过账' : report.consistency.consistent ? '一致' : '不一致' }
              ]"
            />
            <el-tag
              v-if="report.consistency.consistent != null"
              :type="report.consistency.consistent ? 'success' : 'danger'"
              style="margin-top: 8px"
            >
              三账一致性校验：{{ report.consistency.consistent ? '通过（报告差异 = 已过账调整）' : '不通过' }}
            </el-tag>

            <h4>明细行</h4>
            <el-table :data="report.lines" border stripe max-height="360">
              <el-table-column prop="lineNo" label="行号" width="120" />
              <el-table-column prop="packageNo" label="包装号" width="130" />
              <el-table-column prop="materialCode" label="物料" width="120" />
              <el-table-column prop="batchNo" label="批次" width="110" />
              <el-table-column prop="areaCode" label="库区" width="90" />
              <el-table-column prop="abcClass" label="ABC" width="70" />
              <el-table-column prop="bookQty" label="账面" width="90" align="right" />
              <el-table-column prop="actualQty" label="实盘" width="90" align="right">
                <template #default="{ row }">{{ row.actualQty ?? '-' }}</template>
              </el-table-column>
              <el-table-column label="差异" width="90" align="right">
                <template #default="{ row }">
                  <span :style="{ color: row.diff ? (row.diff > 0 ? '#67c23a' : '#f56c6c') : '' }">
                    {{ row.diff ?? '-' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="差异率" width="90" align="right">
                <template #default="{ row }">{{ pct(row.diffRate) }}</template>
              </el-table-column>
              <el-table-column prop="reason" label="原因" min-width="120">
                <template #default="{ row }">{{ row.reason || '-' }}</template>
              </el-table-column>
            </el-table>

            <el-row :gutter="16" style="margin-top: 16px">
              <el-col :span="12">
                <h4>按库区汇总</h4>
                <el-table :data="report.summary.byArea" border stripe>
                  <el-table-column prop="key" label="库区" />
                  <el-table-column prop="book" label="账面" align="right" />
                  <el-table-column prop="actual" label="实盘" align="right" />
                  <el-table-column prop="diff" label="差异" align="right" />
                </el-table>
              </el-col>
              <el-col :span="12">
                <h4>按 ABC 分类汇总</h4>
                <el-table :data="report.summary.byAbcClass" border stripe>
                  <el-table-column prop="key" label="ABC 类" />
                  <el-table-column prop="book" label="账面" align="right" />
                  <el-table-column prop="actual" label="实盘" align="right" />
                  <el-table-column prop="diff" label="差异" align="right" />
                </el-table>
              </el-col>
            </el-row>
          </template>
          <el-empty v-else description="请选择任务后查询" />
        </el-card>

        <el-card>
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center">
              <span>库龄预警</span>
              <el-button @click="loadAging">刷新</el-button>
            </div>
          </template>
          <el-table
            v-loading="agingLoading"
            :data="agingRows.filter((r) => r.level !== 'NONE')"
            border
            stripe
            max-height="420"
            :row-class-name="agingRowClass"
          >
            <el-table-column prop="packageNo" label="包装号" width="140" />
            <el-table-column prop="materialCode" label="物料" width="120" />
            <el-table-column prop="materialName" label="物料名称" min-width="140">
              <template #default="{ row }">{{ row.materialName || '-' }}</template>
            </el-table-column>
            <el-table-column prop="batchNo" label="批次" width="110" />
            <el-table-column prop="locationCode" label="库位" width="110" />
            <el-table-column prop="qty" label="数量" width="90" align="right" />
            <el-table-column prop="daysSinceMove" label="未动天数" width="100" align="right" />
            <el-table-column prop="ageDays" label="库龄（天）" width="100" align="right" />
            <el-table-column prop="reinspectDays" label="重检周期" width="100" align="right" />
            <el-table-column label="预警级别" width="130">
              <template #default="{ row }">
                <el-tag v-if="row.level === 'REINSPECT_DUE'" type="danger">REINSPECT_DUE 到期重检</el-tag>
                <el-tag v-else-if="row.level === 'WARN_3M'" type="warning">WARN_3M 三月未动</el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新建策略对话框 -->
    <el-dialog v-model="strategyDlg" title="新建盘点策略" width="520px" destroy-on-close>
      <el-form ref="strategyFormRef" :model="strategyForm" :rules="strategyRules" label-width="110px">
        <el-form-item label="策略名称" prop="name">
          <el-input v-model="strategyForm.name" placeholder="如：A 类月度循环盘" />
        </el-form-item>
        <el-form-item label="范围类型" prop="scopeType">
          <el-select v-model="strategyForm.scopeType" style="width: 100%">
            <el-option label="ABC 分类" value="ABC" />
            <el-option label="指定物料" value="MATERIAL" />
            <el-option label="指定库区" value="AREA" />
          </el-select>
        </el-form-item>
        <el-form-item label="范围值" prop="scopeValue">
          <el-input
            v-model="strategyForm.scopeValue"
            :placeholder="strategyForm.scopeType === 'ABC' ? 'A / B / C' : strategyForm.scopeType === 'MATERIAL' ? '物料编码' : '库区编码'"
          />
        </el-form-item>
        <el-form-item label="周期（天）" prop="cycleDays">
          <el-input-number v-model="strategyForm.cycleDays" :min="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="责任人" prop="ownerUserId">
          <el-input v-model="strategyForm.ownerUserId" placeholder="责任人用户名" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="strategyDlg = false">取消</el-button>
        <el-button type="primary" :loading="strategySubmitting" @click="submitStrategy">保存</el-button>
      </template>
    </el-dialog>

    <!-- 任务详情抽屉 -->
    <el-drawer v-model="detailVisible" size="75%" :title="`盘点任务 ${detail?.taskNo ?? ''}`">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <KeyValueDesc
            :column="4"
            :items="[
              { label: '任务号', value: detail.taskNo },
              { label: '类型', value: detail.taskType === 'ANNUAL' ? '年度盘点' : '循环盘点' },
              { label: '盲盘', value: detail.blind ? '是' : '否' },
              { label: '状态', value: TASK_STATUS[detail.status]?.text ?? detail.status },
              { label: '冻结方式', value: detail.freezeMode },
              { label: '冻结中', value: detail.freezeActive ? '是' : '否' },
              { label: '责任人', value: detail.ownerUserId },
              { label: '生成日期', value: detail.generatedDate }
            ]"
          />
          <div style="margin: 12px 0">
            <template v-if="!detail.freezeActive && detail.status !== 'COMPLETED'">
              <el-button type="warning" @click="onFreeze('HARD')">硬冻结</el-button>
              <el-button type="warning" plain @click="onFreeze('SOFT')">软冻结（需审批）</el-button>
            </template>
            <el-button v-if="detail.freezeActive" type="success" @click="onUnfreeze">解冻</el-button>
            <el-button
              v-if="detail.status === 'COUNTING'"
              type="danger"
              style="margin-left: 8px"
              @click="onPostAdjustments"
            >
              差异过账
            </el-button>
          </div>
          <el-table :data="detail.lines" border stripe max-height="520">
            <el-table-column prop="lineNo" label="行号" width="130" />
            <el-table-column prop="packageNo" label="包装号" width="130" />
            <el-table-column prop="materialCode" label="物料" width="120" />
            <el-table-column prop="batchNo" label="批次" width="110" />
            <el-table-column prop="locationCode" label="库位" width="110" />
            <el-table-column label="账面" width="90" align="right">
              <template #default="{ row }">{{ row.bookQty ?? '***' }}</template>
            </el-table-column>
            <el-table-column label="实盘" width="90" align="right">
              <template #default="{ row }">{{ row.actualQty ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="复盘" width="90" align="right">
              <template #default="{ row }">{{ row.recountQty ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="差异" width="90" align="right">
              <template #default="{ row }">
                <span v-if="row.diff == null">-</span>
                <span v-else :style="{ color: row.diff ? (row.diff > 0 ? '#67c23a' : '#f56c6c') : '' }">
                  {{ row.diff }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="需复盘" width="80">
              <template #default="{ row }">
                <el-tag v-if="row.needRecount" type="warning">是</el-tag>
                <span v-else>否</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">{{ LINE_STATUS[row.status] ?? row.status }}</template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" min-width="110">
              <template #default="{ row }">{{ row.reason || '-' }}</template>
            </el-table-column>
          </el-table>
        </template>
      </div>
    </el-drawer>

    <!-- 软冻结解冻对账清单 -->
    <el-dialog v-model="reconcileVisible" title="软冻结解冻 · 逐笔对账清单" width="80%">
      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="应结存 = 冻结快照 + 冻结期间合法变动；与当前实物账逐笔核对。"
        style="margin-bottom: 12px"
      />
      <el-table :data="reconcileRows" border stripe max-height="480">
        <el-table-column prop="lineNo" label="行号" width="130" />
        <el-table-column prop="packageNo" label="包装号" width="140" />
        <el-table-column prop="materialCode" label="物料" width="130" />
        <el-table-column prop="batchNo" label="批次" width="120" />
        <el-table-column prop="snapshotQty" label="冻结快照" width="100" align="right" />
        <el-table-column prop="movementSum" label="冻结期变动" width="110" align="right" />
        <el-table-column prop="expectedQty" label="应结存" width="100" align="right" />
        <el-table-column prop="currentQty" label="当前账存" width="100" align="right" />
        <el-table-column label="对账" width="90">
          <template #default="{ row }">
            <el-tag :type="row.match ? 'success' : 'danger'">{{ row.match ? '相符' : '不符' }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button type="primary" @click="reconcileVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:deep(.aging-warn) {
  background: #fdf6ec;
}
:deep(.aging-danger) {
  background: #fef0f0;
}
</style>
