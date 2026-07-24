<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { getRuleHistory, setRule, type RuleVersion } from '@/api/config2'
import {
  getDingTalkAdminConfig,
  saveDingTalkAdminConfig,
  type DingTalkAdminConfig
} from '@/api/auth'

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
const dingtalkLoading = ref(false)
const dingtalkSaving = ref(false)
const dingtalk = reactive({
  enabled: false,
  clientId: '',
  clientSecret: '',
  publicOrigin: '',
  hasSecret: false,
  ready: false,
  callbackUrl: '',
  source: 'environment' as DingTalkAdminConfig['source']
})
const displayedCallbackUrl = computed(() => {
  const origin = dingtalk.publicOrigin.trim().replace(/\/+$/, '')
  return origin
    ? `${origin}/api/auth/dingtalk/callback`
    : dingtalk.callbackUrl
})

async function loadDingTalk() {
  dingtalkLoading.value = true
  try {
    const { data } = await getDingTalkAdminConfig()
    Object.assign(dingtalk, data, { clientSecret: '' })
  } finally {
    dingtalkLoading.value = false
  }
}

async function saveDingTalk() {
  if (dingtalk.enabled && (!dingtalk.clientId.trim() || (!dingtalk.hasSecret && !dingtalk.clientSecret.trim()))) {
    ElMessage.warning('启用前请填写 Client ID 和 Client Secret')
    return
  }
  dingtalkSaving.value = true
  try {
    const { data } = await saveDingTalkAdminConfig({
      enabled: dingtalk.enabled,
      clientId: dingtalk.clientId.trim(),
      publicOrigin: dingtalk.publicOrigin.trim(),
      ...(dingtalk.clientSecret.trim()
        ? { clientSecret: dingtalk.clientSecret.trim() }
        : {})
    })
    Object.assign(dingtalk, data, { clientSecret: '' })
    ElMessage.success('钉钉登录配置已保存并写入审计日志')
  } finally {
    dingtalkSaving.value = false
  }
}

async function copyCallback() {
  await navigator.clipboard.writeText(displayedCallbackUrl.value)
  ElMessage.success('回调地址已复制')
}

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

onMounted(() => {
  load()
  loadDingTalk()
})
</script>

<template>
  <div>
    <el-card v-loading="dingtalkLoading" style="margin-bottom: 16px">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>钉钉账号登录</span>
          <div style="display: flex; align-items: center; gap: 10px">
            <el-tag :type="dingtalk.ready ? 'success' : 'info'">
              {{ dingtalk.ready ? '可用' : '未就绪' }}
            </el-tag>
            <el-switch v-model="dingtalk.enabled" active-text="启用" />
          </div>
        </div>
      </template>
      <el-form label-width="170px" style="max-width: 820px">
        <el-form-item label="Client ID / AppKey">
          <el-input v-model="dingtalk.clientId" placeholder="钉钉企业内部应用中以 ding 开头的 AppKey" />
        </el-form-item>
        <el-form-item label="Client Secret / AppSecret">
          <el-input
            v-model="dingtalk.clientSecret"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="dingtalk.hasSecret ? '已加密保存；留空表示不修改' : '请输入 AppSecret'"
          />
        </el-form-item>
        <el-form-item label="MES 公开访问地址">
          <el-input v-model="dingtalk.publicOrigin" placeholder="例如 https://mes.example.com" />
        </el-form-item>
        <el-form-item label="钉钉授权回调地址">
          <div style="display: flex; width: 100%; gap: 8px">
            <el-input :model-value="displayedCallbackUrl" readonly />
            <el-button @click="copyCallback">复制</el-button>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="dingtalkSaving" @click="saveDingTalk">
            保存钉钉配置
          </el-button>
          <span style="margin-left: 12px; color: #909399; font-size: 12px">
            密钥仅加密保存在服务端，不会回传浏览器；配置来源：{{ dingtalk.source }}
          </span>
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" show-icon>
        <template #title>
          钉钉开放平台创建企业内部应用 → 开通统一身份认证 → 将上方回调地址登记为授权回调地址；
          保存启用后，登录页才会显示钉钉入口。首次使用需先以账号密码登录并在头像菜单中绑定钉钉。
        </template>
      </el-alert>
    </el-card>

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
