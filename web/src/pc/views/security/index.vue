<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listUsers,
  listRoles,
  listPermissions,
  listTempGrants,
  assignUserRoles,
  assignUserWarehouses,
  listWarehouses,
  createTempGrant,
  revokeTempGrant,
  unbindUserDingTalk,
  listAuditLogs,
  exportAuditLogs,
  type RbacUser,
  type RbacRole,
  type RbacPermission,
  type TempGrant,
  type WarehouseOption,
  type AuditLog
} from '@/api/security2'

const activeTab = ref('rbac')

/** 角色可能是字符串或对象，统一取显示名 */
function roleName(r: unknown): string {
  if (typeof r === 'string') return r
  const o = r as { name?: string; code?: string }
  return o?.name ?? o?.code ?? String(r)
}
function roleKey(r: unknown): string | number {
  if (typeof r === 'string') return r
  const o = r as { id?: number; code?: string; name?: string }
  return o?.id ?? o?.code ?? o?.name ?? String(r)
}

/* ---------- Tab1 权限管理 ---------- */
const users = ref<RbacUser[]>([])
const roles = ref<RbacRole[]>([])
const permissions = ref<RbacPermission[]>([])
const warehouses = ref<WarehouseOption[]>([])
const tempGrants = ref<TempGrant[]>([])
const rbacLoading = ref(false)
/** 用户 id → 编辑中的角色选择 */
const roleSelection = reactive<Record<string, (string | number)[]>>({})
const warehouseSelection = reactive<Record<string, string[]>>({})

async function loadRbac() {
  rbacLoading.value = true
  try {
    const [u, r, p, w] = await Promise.all([
      listUsers(),
      listRoles(),
      listPermissions(),
      listWarehouses()
    ])
    users.value = u.data
    roles.value = r.data
    permissions.value = p.data
    warehouses.value = w.data
    users.value.forEach((user) => {
      roleSelection[String(user.id)] = (user.roles ?? []).map((x) => roleKey(x))
      warehouseSelection[String(user.id)] = [...(user.warehouseCodes ?? [])]
    })
    try {
      const tg = await listTempGrants()
      tempGrants.value = tg.data ?? []
    } catch {
      tempGrants.value = []
    }
  } finally {
    rbacLoading.value = false
  }
}

const grantDialog = ref(false)
const granting = ref(false)
const grantForm = reactive({
  userId: undefined as number | undefined,
  permissionCode: '',
  hours: 4
})

async function submitGrant() {
  if (!grantForm.userId || !grantForm.permissionCode || grantForm.hours <= 0) {
    ElMessage.warning('请选择用户、权限并填写有效时长')
    return
  }
  granting.value = true
  try {
    await createTempGrant({
      userId: grantForm.userId,
      permissionCode: grantForm.permissionCode,
      expiresAt: new Date(Date.now() + grantForm.hours * 3600000).toISOString()
    })
    ElMessage.success('临时授权已生效并写入审计')
    grantDialog.value = false
    await loadRbac()
  } finally {
    granting.value = false
  }
}

async function revokeGrant(row: TempGrant) {
  await ElMessageBox.confirm(`确认撤销临时权限 ${grantText.value(row)}？`, '撤销授权', {
    type: 'warning'
  })
  await revokeTempGrant(row.id)
  ElMessage.success('临时授权已撤销')
  await loadRbac()
}

async function unbindDingTalk(row: RbacUser) {
  await ElMessageBox.confirm(`确认解除 ${row.username} 的钉钉绑定？`, '钉钉账号', {
    type: 'warning'
  })
  await unbindUserDingTalk(row.id)
  ElMessage.success('钉钉绑定已解除')
  await loadRbac()
}

const savingUser = ref<string | null>(null)

async function saveRoles(user: RbacUser) {
  savingUser.value = String(user.id)
  try {
    await Promise.all([
      assignUserRoles(user.id, roleSelection[String(user.id)] ?? []),
      assignUserWarehouses(user.id, warehouseSelection[String(user.id)] ?? [])
    ])
    ElMessage.success(`已更新 ${user.username} 的角色与仓库范围`)
    await loadRbac()
  } finally {
    savingUser.value = null
  }
}

/** 角色 → 权限点展示（分组 tag） */
function rolePerms(r: RbacRole): string[] {
  return (r.permissions ?? []).map((p) => roleName(p))
}

/* ---------- Tab2 审计日志 ---------- */
const auditRows = ref<AuditLog[]>([])
const auditLoading = ref(false)
const query = reactive({
  operator: '',
  action: '',
  docNo: '',
  range: [dayOffset(-7), dayOffset(0)] as [string, string]
})

function dayOffset(days: number): string {
  const d = new Date(Date.now() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

async function loadAudit() {
  auditLoading.value = true
  try {
    const res = await listAuditLogs({
      operator: query.operator || undefined,
      action: query.action || undefined,
      docNo: query.docNo || undefined,
      from: query.range?.[0],
      to: query.range?.[1]
    })
    auditRows.value = res.data.items
  } finally {
    auditLoading.value = false
  }
}

function resetQuery() {
  query.operator = ''
  query.action = ''
  query.docNo = ''
  query.range = [dayOffset(-7), dayOffset(0)]
  loadAudit()
}

/** 导出：前端先弹审批提示，确认后下载 CSV */
async function onExport() {
  await ElMessageBox.confirm(
    '审计日志导出属于敏感操作，按制度需先完成导出审批。确认已完成审批并继续导出？',
    '导出确认',
    { type: 'warning', confirmButtonText: '已审批，导出', cancelButtonText: '取消' }
  )
  const res = await exportAuditLogs({
    operator: query.operator || undefined,
    action: query.action || undefined,
    docNo: query.docNo || undefined,
    from: query.range?.[0],
    to: query.range?.[1]
  })
  const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** before/after JSON 美化 */
function prettyJson(raw?: string): string {
  if (!raw) return '-'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

const grantText = computed(
  () => (g: TempGrant) => g.permissionCode ?? g.permCode ?? g.permission ?? '-'
)

onMounted(() => {
  loadRbac()
  loadAudit()
})
</script>

<template>
  <div>
    <el-tabs v-model="activeTab">
      <!-- ========== Tab1 权限管理 ========== -->
      <el-tab-pane label="权限管理" name="rbac">
        <el-card style="margin-bottom: 16px">
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center">
              <span>用户与角色分配</span>
              <el-button @click="loadRbac">刷新</el-button>
            </div>
          </template>
          <el-table v-loading="rbacLoading" :data="users" border stripe>
            <el-table-column prop="username" label="用户名" width="140" />
            <el-table-column label="姓名" width="120">
              <template #default="{ row }">{{ row.name || '-' }}</template>
            </el-table-column>
            <el-table-column label="角色" min-width="320">
              <template #default="{ row }">
                <el-select
                  v-model="roleSelection[String(row.id)]"
                  multiple
                  placeholder="选择角色"
                  style="width: 100%"
                >
                  <el-option
                    v-for="r in roles"
                    :key="String(roleKey(r))"
                    :label="roleName(r)"
                    :value="roleKey(r)"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="仓库数据范围" min-width="220">
              <template #default="{ row }">
                <el-select
                  v-model="warehouseSelection[String(row.id)]"
                  multiple
                  collapse-tags
                  placeholder="未分配仓库"
                  style="width: 100%"
                >
                  <el-option
                    v-for="warehouse in warehouses"
                    :key="warehouse.warehouseCode"
                    :label="`${warehouse.name || warehouse.warehouseCode}（${warehouse.warehouseCode}）`"
                    :value="warehouse.warehouseCode"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="钉钉" width="100">
              <template #default="{ row }">
                <el-tag :type="row.dingtalkBound ? 'success' : 'info'" size="small">
                  {{ row.dingtalkBound ? '已绑定' : '未绑定' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <el-button
                  type="primary"
                  size="small"
                  :loading="savingUser === String(row.id)"
                  @click="saveRoles(row)"
                >
                  保存
                </el-button>
                <el-button
                  v-if="row.dingtalkBound"
                  type="danger"
                  link
                  size="small"
                  @click="unbindDingTalk(row)"
                >
                  解绑
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-row :gutter="16">
          <el-col :span="14">
            <el-card>
              <template #header>角色权限点</template>
              <div v-for="r in roles" :key="String(roleKey(r))" style="margin-bottom: 14px">
                <div style="font-weight: 600; margin-bottom: 6px">{{ roleName(r) }}</div>
                <template v-if="rolePerms(r).length">
                  <el-tag
                    v-for="p in rolePerms(r)"
                    :key="p"
                    size="small"
                    style="margin: 0 6px 6px 0"
                  >
                    {{ p }}
                  </el-tag>
                </template>
                <span v-else style="color: #c0c4cc; font-size: 12px">暂无权限点数据</span>
              </div>
              <el-empty v-if="!roles.length" description="暂无角色数据" />
            </el-card>
          </el-col>
          <el-col :span="10">
            <el-card>
              <template #header>
                <div style="display: flex; justify-content: space-between; align-items: center">
                  <span>临时授权</span>
                  <el-button type="primary" size="small" @click="grantDialog = true">新增</el-button>
                </div>
              </template>
              <el-table v-if="tempGrants.length" :data="tempGrants" border stripe size="small">
                <el-table-column label="用户" min-width="110">
                  <template #default="{ row }">{{ row.username ?? row.userId ?? '-' }}</template>
                </el-table-column>
                <el-table-column label="权限" min-width="130">
                  <template #default="{ row }">{{ grantText(row) }}</template>
                </el-table-column>
                <el-table-column label="到期时间" min-width="150">
                  <template #default="{ row }">{{ row.expiresAt || row.expireAt || '-' }}</template>
                </el-table-column>
                <el-table-column label="操作" width="70" fixed="right">
                  <template #default="{ row }">
                    <el-button type="danger" link size="small" @click="revokeGrant(row)">撤销</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-alert v-else type="info" :closable="false" show-icon>
                <template #title>暂无临时授权记录。</template>
              </el-alert>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- ========== Tab2 审计日志 ========== -->
      <el-tab-pane label="审计日志" name="audit">
        <el-alert
          type="warning"
          show-icon
          :closable="false"
          title="审计日志只读，不可修改、不可删除。"
          style="margin-bottom: 12px"
        />
        <el-card>
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
              <div style="display: flex; gap: 8px; flex-wrap: wrap">
                <el-input v-model="query.operator" placeholder="操作人" clearable style="width: 130px" />
                <el-input v-model="query.action" placeholder="动作（如 doc.approve）" clearable style="width: 180px" />
                <el-input v-model="query.docNo" placeholder="单据号" clearable style="width: 150px" />
                <el-date-picker
                  v-model="query.range"
                  type="daterange"
                  value-format="YYYY-MM-DD"
                  start-placeholder="开始日期"
                  end-placeholder="结束日期"
                  style="width: 260px"
                />
                <el-button type="primary" @click="loadAudit">查询</el-button>
                <el-button @click="resetQuery">重置（近 7 天）</el-button>
              </div>
              <el-button @click="onExport">导出</el-button>
            </div>
          </template>
          <el-table v-loading="auditLoading" :data="auditRows" border stripe max-height="560">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div style="display: flex; gap: 24px; padding: 8px 16px">
                  <div style="flex: 1">
                    <div style="font-weight: 600; margin-bottom: 4px">变更前（before）</div>
                    <pre class="json-view">{{ prettyJson(row.before) }}</pre>
                  </div>
                  <div style="flex: 1">
                    <div style="font-weight: 600; margin-bottom: 4px">变更后（after）</div>
                    <pre class="json-view">{{ prettyJson(row.after) }}</pre>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="时间" width="170" />
            <el-table-column prop="operator" label="操作人" width="110" />
            <el-table-column prop="role" label="角色" width="110">
              <template #default="{ row }">{{ row.role || '-' }}</template>
            </el-table-column>
            <el-table-column label="设备 / IP" width="180">
              <template #default="{ row }">
                {{ [row.device, row.ip].filter(Boolean).join(' / ') || '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="action" label="动作" min-width="160" />
            <el-table-column prop="docNo" label="单据号" width="150">
              <template #default="{ row }">{{ row.docNo || '-' }}</template>
            </el-table-column>
            <el-table-column label="结果" width="120">
              <template #default="{ row }">
                <el-tag :type="row.result === 'SUCCESS' ? 'success' : 'danger'" size="small">
                  {{ row.result }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="grantDialog" title="新增临时授权" width="460px">
      <el-form label-width="90px">
        <el-form-item label="用户">
          <el-select v-model="grantForm.userId" filterable style="width: 100%">
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.name || u.username}（${u.username}）`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="权限">
          <el-select v-model="grantForm.permissionCode" filterable style="width: 100%">
            <el-option
              v-for="p in permissions.filter((item) => item.code !== '*')"
              :key="p.id"
              :label="`${p.name || p.code}（${p.code}）`"
              :value="p.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="有效小时">
          <el-input-number v-model="grantForm.hours" :min="1" :max="168" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="grantDialog = false">取消</el-button>
        <el-button type="primary" :loading="granting" @click="submitGrant">确认授权</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.json-view {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 8px;
  font-size: 12px;
  max-height: 240px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
