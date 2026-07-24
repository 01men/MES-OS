<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { getRuleHistory, setRule, type RuleVersion } from '@/api/config2'

/**
 * 后端暂无「列出全部规则」端点（rule-config.controller 仅提供按 key 查询），
 * 因此按内置常用规则清单逐个拉取版本历史，最新版本即当前值。
 */
const KNOWN_RULES: { key: string; desc: string }[] = [
  { key: 'abc.sampleRate', desc: 'ABC 循环盘点抽检比例（如 A 类全盘、B/C 类按比例抽检）' },
  { key: 'abc.tolerance', desc: 'ABC 各类物料盘点差异容忍阈值，超过需复盘' },
  { key: 'returns.overIssueRate', desc: '退补料超发率上限，超过触发预警/审批' },
  { key: 'stocktake.diffThreshold', desc: '盘点差异过账阈值，超过需走审批' },
  { key: 'stocktake.reinspectDays', desc: '库龄重检周期（按物料种类差异化，JSON，如 {"五金":180,"塑料":365,"default":365}）' },
  { key: 'surplus.remindDays', desc: '呆滞料预警提醒天数' },
  { key: 'surplus.labelTemplate', desc: '盈余入库标签模板（P20 标签模板页维护）' },
  { key: 'receiving.labelTemplate', desc: '收料标签模板（P20 标签模板页维护）' },
  { key: 'u8.mockFailure', desc: 'U8 接口故障模拟开关（联调测试用）' }
]

interface RuleRow {
  key: string
  desc: string
  current?: RuleVersion
  versions: RuleVersion[]
}

const rows = ref<RuleRow[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const list: RuleRow[] = await Promise.all(
      KNOWN_RULES.map(async (r) => {
        try {
          const res = await getRuleHistory(r.key)
          const versions = res.data ?? []
          return { key: r.key, desc: r.desc, current: versions[0], versions }
        } catch {
          return { key: r.key, desc: r.desc, current: undefined, versions: [] }
        }
      })
    )
    rows.value = list
  } finally {
    loading.value = false
  }
}

/* ---------- 编辑（创建新版本） ---------- */
const editVisible = ref(false)
const editFormRef = ref<FormInstance>()
const editSubmitting = ref(false)
const editForm = reactive({ key: '', value: '', comment: '' })
const editRules: FormRules = {
  value: [{ required: true, message: '请输入新值', trigger: 'blur' }],
  comment: [{ required: true, message: '请填写变更说明', trigger: 'blur' }]
}

function openEdit(row: RuleRow) {
  editForm.key = row.key
  editForm.value = row.current?.value ?? ''
  editForm.comment = ''
  editVisible.value = true
}

async function submitEdit() {
  await editFormRef.value?.validate()
  editSubmitting.value = true
  try {
    // 注意：后端当前版本仅落库 key/value，comment 随请求提交但暂不持久化
    await setRule(editForm.key, editForm.value)
    ElMessage.success('已创建新版本（旧版本保留，可在历史中查看）')
    editVisible.value = false
    load()
  } finally {
    editSubmitting.value = false
  }
}

/* ---------- 历史抽屉 ---------- */
const historyVisible = ref(false)
const historyKey = ref('')
const historyRows = ref<RuleVersion[]>([])

function openHistory(row: RuleRow) {
  historyKey.value = row.key
  historyRows.value = row.versions
  historyVisible.value = true
}

onMounted(load)
</script>

<template>
  <div>
    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="规则配置为版本化管理：修改即创建新版本并立即生效，旧版本保留可回溯，不会被覆盖。"
      style="margin-bottom: 12px"
    />
    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>业务规则</span>
          <el-button @click="load">刷新</el-button>
        </div>
      </template>
      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column prop="key" label="规则 Key" width="220" />
        <el-table-column label="当前值" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <code v-if="row.current">{{ row.current.value }}</code>
            <span v-else style="color: #c0c4cc">未配置</span>
          </template>
        </el-table-column>
        <el-table-column label="版本" width="70" align="right">
          <template #default="{ row }">{{ row.current?.version ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="生效时间" width="170">
          <template #default="{ row }">{{ row.current?.effectiveAt ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="100">
          <template #default="{ row }">{{ row.current?.operator || '-' }}</template>
        </el-table-column>
        <el-table-column prop="desc" label="用途说明" min-width="280" show-overflow-tooltip />
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="info" :disabled="row.versions.length === 0" @click="openHistory(row)">
              历史
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editVisible" :title="`编辑规则：${editForm.key}`" width="520px" destroy-on-close>
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="100px">
        <el-form-item label="新值" prop="value">
          <el-input v-model="editForm.value" type="textarea" :rows="3" placeholder="保存后作为新版本立即生效" />
        </el-form-item>
        <el-form-item label="变更说明" prop="comment">
          <el-input v-model="editForm.comment" placeholder="本次变更原因（后端当前版本暂不持久化该字段）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSubmitting" @click="submitEdit">保存为新版本</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="historyVisible" size="480px" :title="`版本历史：${historyKey}`">
      <el-timeline v-if="historyRows.length">
        <el-timeline-item
          v-for="(v, i) in historyRows"
          :key="v.id"
          :type="i === 0 ? 'primary' : undefined"
          :timestamp="v.effectiveAt"
          placement="top"
        >
          <el-card shadow="never">
            <div><b>v{{ v.version }}</b><span v-if="i === 0" style="color: #409eff">（当前生效）</span></div>
            <div style="margin: 6px 0"><code>{{ v.value }}</code></div>
            <div style="font-size: 12px; color: #909399">操作人：{{ v.operator || '-' }}</div>
          </el-card>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无历史版本" />
    </el-drawer>
  </div>
</template>
