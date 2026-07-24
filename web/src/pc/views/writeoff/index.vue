<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import {
  listWriteoffs,
  createWriteoff,
  exportWriteoffs,
  type WriteoffOrder,
  type WriteoffReason
} from '@/api/returns2'

const rows = ref<WriteoffOrder[]>([])
const loading = ref(false)

const REASON_LABEL: Record<WriteoffReason, string> = {
  CUSTOMER_INSPECT: '客检',
  DESTRUCTIVE_TEST: '破坏性测试',
  OTHER: '其他'
}
const STATUS_LABEL: Record<string, { text: string; type: 'warning' | 'success' | 'info' }> = {
  PENDING_APPROVAL: { text: '双审批中', type: 'warning' },
  POSTED: { text: '已过账', type: 'success' },
  VOID: { text: '已作废', type: 'info' }
}

async function load() {
  loading.value = true
  try {
    const res = await listWriteoffs()
    rows.value = res.data
  } finally {
    loading.value = false
  }
}

/* ---------- 新建 ---------- */
const dlgVisible = ref(false)
const formRef = ref<FormInstance>()
const submitting = ref(false)
const form = reactive({
  workOrderId: '',
  materialCode: '',
  batchNo: '',
  packageNo: '',
  qty: 1,
  reason: 'CUSTOMER_INSPECT' as WriteoffReason,
  customerOrderNo: ''
})

const rules: FormRules = {
  materialCode: [{ required: true, message: '请输入物料编码', trigger: 'blur' }],
  batchNo: [{ required: true, message: '请输入批次号', trigger: 'blur' }],
  packageNo: [{ required: true, message: '请输入包装号', trigger: 'blur' }],
  qty: [{ required: true, message: '请输入数量', trigger: 'blur' }],
  reason: [{ required: true, message: '请选择原因类型', trigger: 'change' }],
  customerOrderNo: [
    {
      validator: (_r, v, cb) => {
        if (form.reason === 'CUSTOMER_INSPECT' && !v) cb(new Error('原因类型为「客检」时客户订单号必填'))
        else cb()
      },
      trigger: 'blur'
    }
  ]
}

function openCreate() {
  Object.assign(form, {
    workOrderId: '',
    materialCode: '',
    batchNo: '',
    packageNo: '',
    qty: 1,
    reason: 'CUSTOMER_INSPECT',
    customerOrderNo: ''
  })
  dlgVisible.value = true
}

async function submit() {
  await formRef.value?.validate()
  submitting.value = true
  try {
    await createWriteoff({
      workOrderId: form.workOrderId || undefined,
      materialCode: form.materialCode,
      batchNo: form.batchNo,
      packageNo: form.packageNo,
      qty: form.qty,
      reason: form.reason,
      customerOrderNo: form.reason === 'CUSTOMER_INSPECT' ? form.customerOrderNo : undefined
    })
    ElMessage.success('核销单已创建，待质量工程师 + 财务双审批')
    dlgVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

/* ---------- 导出 CSV ---------- */
async function onExport() {
  const res = await exportWriteoffs()
  const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `writeoffs-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div>
    <el-alert
      type="warning"
      show-icon
      :closable="false"
      title="损耗核销需质量工程师 + 财务双审批，任一拒绝即作废；双审批通过后方可过账（扣减库存并同步 U8）。"
      style="margin-bottom: 12px"
    />
    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>损耗核销单</span>
          <div>
            <el-button @click="onExport">导出 CSV</el-button>
            <el-button type="primary" @click="openCreate">新建核销单</el-button>
          </div>
        </div>
      </template>
      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column prop="docNo" label="单号" width="150" />
        <el-table-column prop="materialCode" label="物料编码" width="130" />
        <el-table-column prop="batchNo" label="批次号" width="120" />
        <el-table-column prop="packageNo" label="包装号" width="130" />
        <el-table-column prop="qty" label="数量" width="90" align="right" />
        <el-table-column label="原因类型" width="110">
          <template #default="{ row }">{{ REASON_LABEL[row.reason as WriteoffReason] ?? row.reason }}</template>
        </el-table-column>
        <el-table-column prop="workOrderId" label="工单号" width="130">
          <template #default="{ row }">{{ row.workOrderId || '-' }}</template>
        </el-table-column>
        <el-table-column prop="customerOrderNo" label="客户订单号" width="130">
          <template #default="{ row }">{{ row.customerOrderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="双审批状态" width="110">
          <template #default="{ row }">
            <el-tag :type="STATUS_LABEL[row.status]?.type ?? 'info'">
              {{ STATUS_LABEL[row.status]?.text ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="U8 同步" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'POSTED'" :type="row.u8Synced ? 'success' : 'danger'">
              {{ row.u8Synced ? '已同步' : '未同步' }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="operator" label="经办人" width="100" />
        <el-table-column prop="createdAt" label="创建时间" min-width="160" />
      </el-table>
    </el-card>

    <el-dialog v-model="dlgVisible" title="新建损耗核销单" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="工单号" prop="workOrderId">
          <el-input v-model="form.workOrderId" placeholder="可选" />
        </el-form-item>
        <el-form-item label="物料编码" prop="materialCode">
          <el-input v-model="form.materialCode" />
        </el-form-item>
        <el-form-item label="批次号" prop="batchNo">
          <el-input v-model="form.batchNo" />
        </el-form-item>
        <el-form-item label="包装号" prop="packageNo">
          <el-input v-model="form.packageNo" placeholder="扣减的库存批次包装号" />
        </el-form-item>
        <el-form-item label="数量" prop="qty">
          <el-input-number v-model="form.qty" :min="0.0001" :precision="4" style="width: 100%" />
        </el-form-item>
        <el-form-item label="原因类型" prop="reason">
          <el-radio-group v-model="form.reason">
            <el-radio-button value="CUSTOMER_INSPECT">客检</el-radio-button>
            <el-radio-button value="DESTRUCTIVE_TEST">破坏性测试</el-radio-button>
            <el-radio-button value="OTHER">其他</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item
          v-if="form.reason === 'CUSTOMER_INSPECT'"
          label="客户订单号"
          prop="customerOrderNo"
        >
          <el-input v-model="form.customerOrderNo" placeholder="客检必填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>
