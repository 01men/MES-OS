<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import ScanInput from '@/components/ScanInput.vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import { enqueue } from '@/api/offline'
import {
  scanBarcode,
  createArrival,
  sendInspect,
  submitIqc,
  confirmArrival,
  getArrivals,
  getArrival,
  reprintLabel,
  type ReceivingScanResult,
  type ArrivalItem,
  type ArrivalResult,
  type ConfirmResult
} from '@/api/receiving'

/** 步骤链：①扫码录入 → ②送检 → ③IQC判定 → ④确认入库 */
const steps = ['① 扫码录入', '② 送检', '③ IQC 判定', '④ 确认入库']

type FbType = 'success' | 'error' | 'duplicate' | 'offline'
const fb = reactive<{ type: FbType; message: string; detail: string }>({
  type: 'success',
  message: '',
  detail: ''
})
function showFb(type: FbType, message: string, detail = '') {
  fb.type = type
  fb.detail = detail
  fb.message = message
}

function errMsg(e: any): string {
  const m = e?.response?.data?.message
  if (m) return Array.isArray(m) ? String(m[0]) : String(m)
  return '网络异常，请检查网络后重试'
}
function isNetworkError(e: any): boolean {
  return !e?.response
}

/* ---------- ① 扫码录入 ---------- */
const scanning = ref(false)
const scanInfo = ref<ReceivingScanResult | null>(null)
const form = reactive({
  scannedQty: 0,
  qty: 0,
  labelQty: 0,
  warehouseCode: '',
  locationCode: '',
  workOrderId: ''
})

/** 条码格式 PO|料号|数量|供应商|批次时间：本地解析出条码数量作 scannedQty 兜底 */
function parseBarcodeQty(barcode: string): number {
  const parts = barcode.split('|')
  const n = Number(parts[2])
  return Number.isFinite(n) && n > 0 ? n : 0
}

const countModeText = computed(() => {
  if (!scanInfo.value) return ''
  const map: Record<string, string> = {
    FULL: 'A 类物料：全点',
    SAMPLE: 'B 类物料：抽查',
    LABEL: 'C 类物料：按标签计数'
  }
  return map[scanInfo.value.countMode] ?? scanInfo.value.countHint
})

async function onScan(barcode: string) {
  if (scanning.value) return
  scanning.value = true
  try {
    const res = await scanBarcode(barcode)
    scanInfo.value = res.data
    const parsed = parseBarcodeQty(barcode)
    form.scannedQty = parsed
    form.qty = parsed || scanInfo.value.remainingQty || 0
    form.labelQty = scanInfo.value.countMode === 'LABEL' ? form.qty : 0
    showFb('success', `识别成功：${scanInfo.value.materialCode}`, `订单 ${scanInfo.value.poNo}`)
  } catch (e: any) {
    scanInfo.value = null
    showFb('error', '扫码失败', errMsg(e))
  } finally {
    scanning.value = false
  }
}

/* ---------- 到货暂存提交（采集类：断网入离线队列） ---------- */
const submitting = ref(false)
/** arrivalId → 创建结果（包装号/批次号/标签），供入库确认后展示 */
const arrivalResults = ref<Record<string, ArrivalResult>>({})

async function submitArrival() {
  if (!scanInfo.value || submitting.value) return
  if (!form.qty || form.qty <= 0) {
    showFb('error', '请录入实收数量')
    return
  }
  submitting.value = true
  const payload = {
    poNo: scanInfo.value.poNo,
    materialCode: scanInfo.value.materialCode,
    qty: form.qty,
    scannedQty: form.scannedQty,
    labelQty: form.labelQty,
    warehouseCode: form.warehouseCode,
    locationCode: form.locationCode,
    workOrderId: form.workOrderId || undefined
  }
  try {
    const res = await createArrival(payload)
    const data = res.data
    showFb('success', `到货暂存成功：${data.arrivalNo}`, `包装号 ${data.packageNo} / 批次 ${data.batchNo}`)
    scanInfo.value = null
    await loadArrivals()
    // 记录创建结果（供确认入库后展示标签）
    const created = arrivals.value.find((a) => a.arrivalNo === data.arrivalNo)
    if (created) arrivalResults.value[String(created.id)] = data
  } catch (e: any) {
    if (isNetworkError(e)) {
      const taskNo = enqueue({ url: '/receiving/arrivals', method: 'post', data: payload })
      showFb('offline', '网络异常，已离线暂存', `任务号 ${taskNo}，联网后自动提交`)
    } else {
      showFb('error', '到货暂存失败', errMsg(e))
    }
  } finally {
    submitting.value = false
  }
}

/* ---------- 到货列表 + ②送检 ---------- */
const arrivals = ref<ArrivalItem[]>([])
const listLoading = ref(false)

async function loadArrivals() {
  listLoading.value = true
  try {
    const res = await getArrivals()
    arrivals.value = Array.isArray(res.data) ? res.data : []
  } catch {
    /* 列表加载失败不打断主流程 */
  } finally {
    listLoading.value = false
  }
}

async function onSendInspect(a: ArrivalItem) {
  try {
    await sendInspect(a.id)
    showFb('success', `已送检：${a.arrivalNo ?? a.id}`)
    await loadArrivals()
  } catch (e: any) {
    showFb('error', '送检失败', errMsg(e))
  }
}

/* ---------- ③ IQC 判定 ---------- */
const iqcTarget = ref<ArrivalItem | null>(null)
const iqc = reactive({
  decision: 'ALL' as 'ALL' | 'PARTIAL' | 'CONCESSION',
  qualifiedQty: 0,
  rejectedQty: 0,
  concessionQty: 0,
  pendingQty: 0,
  defectDescription: ''
})
const iqcApprovalId = ref('')

function openIqc(a: ArrivalItem) {
  iqcTarget.value = a
  iqcApprovalId.value = ''
  iqc.decision = 'ALL'
  iqc.qualifiedQty = a.qty ?? 0
  iqc.rejectedQty = 0
  iqc.concessionQty = 0
  iqc.pendingQty = 0
  iqc.defectDescription = ''
}

/** 部分接收/特采时：合格+不合格+特采+待处理 必须等于到货数 */
const iqcSum = computed(() => iqc.qualifiedQty + iqc.rejectedQty + iqc.concessionQty + iqc.pendingQty)
const iqcMismatch = computed(() => {
  if (!iqcTarget.value || iqc.decision === 'ALL') return false
  return iqcSum.value !== (iqcTarget.value.qty ?? 0)
})

async function onSubmitIqc() {
  if (!iqcTarget.value) return
  if (iqcMismatch.value) {
    showFb('error', `数量不匹配：合计 ${iqcSum.value} ≠ 到货数 ${iqcTarget.value.qty ?? 0}`)
    return
  }
  try {
    const res = await submitIqc(iqcTarget.value.id, { ...iqc })
    const approvalId = res.data?.approvalId
    if (iqc.decision === 'CONCESSION' && approvalId) {
      iqcApprovalId.value = approvalId
      showFb('success', '特采已提交 MRB 会签审批', `审批单号 ${approvalId}`)
    } else {
      showFb('success', 'IQC 判定已提交')
    }
    iqcTarget.value = null
    await loadArrivals()
  } catch (e: any) {
    showFb('error', 'IQC 提交失败', errMsg(e))
  }
}

/* ---------- ④ 确认入库（高风险：必须在线） ---------- */
const confirmResult = ref<{ id: string | number; result: ConfirmResult; packageNo?: string; batchNo?: string; label?: unknown } | null>(null)

async function onConfirm(a: ArrivalItem) {
  try {
    const res = await confirmArrival(a.id)
    let packageNo = a.packageNo
    let batchNo = a.batchNo
    try {
      const detail = await getArrival(a.id)
      packageNo = packageNo ?? detail.data?.packageNo
      batchNo = batchNo ?? detail.data?.batchNo
    } catch {
      /* 详情拉取失败不阻断结果展示 */
    }
    const cached = arrivalResults.value[String(a.id)]
    confirmResult.value = {
      id: a.id,
      result: res.data,
      packageNo: packageNo ?? cached?.packageNo,
      batchNo: batchNo ?? cached?.batchNo,
      label: cached?.label
    }
    showFb('success', '入库确认成功', `过账：${res.data.syncStatus}`)
    await loadArrivals()
  } catch (e: any) {
    showFb(
      'error',
      isNetworkError(e) ? '该操作必须联网完成' : '入库确认失败',
      isNetworkError(e) ? '请连接网络后重试' : errMsg(e)
    )
  }
}

/* ---------- 标签补打 ---------- */
const reprint = reactive({ packageNo: '', reason: '' })
async function onReprint() {
  if (!reprint.packageNo || !reprint.reason) {
    showFb('error', '请填写包装号与补打原因')
    return
  }
  try {
    await reprintLabel(reprint.packageNo, reprint.reason)
    showFb('success', `标签补打成功：${reprint.packageNo}`)
    reprint.reason = ''
  } catch (e: any) {
    showFb('error', '补打失败', errMsg(e))
  }
}

/* ---------- 底部主操作 ---------- */
onMounted(() => {
  void loadArrivals()
  setPdaActions([
    { label: '提交到货暂存', type: 'primary', onClick: () => void submitArrival() },
    { label: '刷新列表', type: 'info', onClick: () => void loadArrivals() }
  ])
})
</script>

<template>
  <div>
    <!-- 步骤链引导 -->
    <div class="pda-card recv-steps">
      <span v-for="s in steps" :key="s" class="recv-step">{{ s }}</span>
    </div>

    <ScanFeedback :type="fb.type" :message="fb.message" :detail="fb.detail" />

    <!-- ① 扫码 -->
    <div class="pda-card">
      <div class="recv-card-title">① 扫送货单 / 物料码</div>
      <ScanInput placeholder="扫描送货单 / 物料条码（PO|料号|数量|供应商|批次）" :disabled="scanning" @scan="onScan" />
    </div>

    <!-- 扫码结果 + 实收录入 -->
    <div v-if="scanInfo" class="pda-card">
      <div class="recv-kv"><span>订单号</span><b>{{ scanInfo.poNo }}</b></div>
      <div class="recv-kv"><span>物料</span><b>{{ scanInfo.materialCode }} {{ scanInfo.materialName ?? '' }}</b></div>
      <div class="recv-kv"><span>单位</span><b>{{ scanInfo.unit }}</b></div>
      <div class="recv-kv"><span>剩余可收</span><b>{{ scanInfo.remainingQty }}</b></div>
      <div class="recv-kv">
        <span>ABC 类别</span>
        <b class="recv-abc">{{ scanInfo.abcClass }} 类 · {{ countModeText }}</b>
      </div>
      <div v-if="scanInfo.countHint" class="recv-hint">{{ scanInfo.countHint }}</div>

      <label class="recv-label">实收数量</label>
      <input v-model.number="form.qty" class="pda-input recv-input" type="number" min="0" />
      <label class="recv-label">扫码数量</label>
      <input v-model.number="form.scannedQty" class="pda-input recv-input" type="number" min="0" />
      <label v-if="scanInfo.countMode === 'LABEL'" class="recv-label">标签数量（C 类按标签计数）</label>
      <input v-if="scanInfo.countMode === 'LABEL'" v-model.number="form.labelQty" class="pda-input recv-input" type="number" min="0" />
      <label class="recv-label">仓库编码</label>
      <input v-model="form.warehouseCode" class="pda-input recv-input" type="text" placeholder="如 RM" />
      <label class="recv-label">储位编码</label>
      <input v-model="form.locationCode" class="pda-input recv-input" type="text" placeholder="如 RM-A-01" />
    </div>

    <!-- ③ IQC 判定表单 -->
    <div v-if="iqcTarget" class="pda-card">
      <div class="recv-card-title">③ IQC 判定 — {{ iqcTarget.arrivalNo }}（到货 {{ iqcTarget.qty }}）</div>
      <div class="recv-decisions">
        <button
          v-for="d in [
            { v: 'ALL', t: '全部接收' },
            { v: 'PARTIAL', t: '部分接收' },
            { v: 'CONCESSION', t: '特采' }
          ]"
          :key="d.v"
          class="pda-btn recv-decision"
          :class="iqc.decision === d.v ? 'pda-btn--primary' : 'pda-btn--info'"
          @click="iqc.decision = d.v as typeof iqc.decision"
        >
          {{ d.t }}
        </button>
      </div>
      <template v-if="iqc.decision !== 'ALL'">
        <label class="recv-label">合格数量</label>
        <input v-model.number="iqc.qualifiedQty" class="pda-input recv-input" type="number" min="0" />
        <label class="recv-label">不合格数量</label>
        <input v-model.number="iqc.rejectedQty" class="pda-input recv-input" type="number" min="0" />
        <label class="recv-label">特采数量</label>
        <input v-model.number="iqc.concessionQty" class="pda-input recv-input" type="number" min="0" />
        <label class="recv-label">待处理数量</label>
        <input v-model.number="iqc.pendingQty" class="pda-input recv-input" type="number" min="0" />
        <div class="recv-sum" :class="{ 'recv-sum--error': iqcMismatch }">
          合计 {{ iqcSum }} / 到货 {{ iqcTarget.qty ?? 0 }}
          <template v-if="iqcMismatch">（合格+不合格+特采+待处理 必须等于到货数）</template>
        </div>
        <label class="recv-label">不良描述</label>
        <input v-model="iqc.defectDescription" class="pda-input recv-input" type="text" placeholder="不良现象描述" />
      </template>
      <div v-if="iqcApprovalId" class="recv-mrb">已提交 MRB 会签审批：{{ iqcApprovalId }}</div>
      <button class="pda-btn pda-btn--success recv-block-btn" :disabled="iqcMismatch" @click="onSubmitIqc">
        提交 IQC 判定
      </button>
    </div>

    <!-- ④ 入库确认结果 -->
    <div v-if="confirmResult" class="pda-card">
      <div class="recv-card-title">④ 入库确认结果</div>
      <div class="recv-kv"><span>包装号</span><b>{{ confirmResult.packageNo ?? '-' }}</b></div>
      <div class="recv-kv"><span>批次号</span><b>{{ confirmResult.batchNo ?? '-' }}</b></div>
      <div class="recv-kv"><span>U8 同步状态</span><b>{{ confirmResult.result.syncStatus }}</b></div>
      <div v-if="confirmResult.result.workOrderIssueReminder" class="recv-hint">
        {{ confirmResult.result.workOrderIssueReminder }}
      </div>
      <div v-if="confirmResult.label" class="recv-label-content">
        标签内容：{{ typeof confirmResult.label === 'string' ? confirmResult.label : JSON.stringify(confirmResult.label) }}
      </div>
    </div>

    <!-- 标签补打 -->
    <div class="pda-card">
      <div class="recv-card-title">标签补打</div>
      <input v-model="reprint.packageNo" class="pda-input recv-input" type="text" placeholder="包装号" />
      <input v-model="reprint.reason" class="pda-input recv-input" type="text" placeholder="补打原因（必填）" />
      <button class="pda-btn pda-btn--warning recv-block-btn" @click="onReprint">补打标签</button>
    </div>

    <!-- 到货列表（②送检 / ③IQC / ④确认入库入口） -->
    <div class="pda-card">
      <div class="recv-card-title">到货暂存列表{{ listLoading ? '（加载中…）' : `（${arrivals.length}）` }}</div>
      <div v-if="!arrivals.length && !listLoading" class="recv-empty">暂无到货记录</div>
      <div v-for="a in arrivals" :key="String(a.id)" class="recv-arrival">
        <div class="recv-kv"><span>到货单</span><b>{{ a.arrivalNo ?? a.id }}</b></div>
        <div class="recv-kv"><span>物料 / 数量</span><b>{{ a.materialCode }} × {{ a.qty }}</b></div>
        <div class="recv-kv"><span>状态</span><b>{{ a.status ?? '-' }}</b></div>
        <div class="recv-row-btns">
          <button class="pda-btn pda-btn--primary" @click="onSendInspect(a)">送检</button>
          <button class="pda-btn pda-btn--warning" @click="openIqc(a)">IQC 判定</button>
          <button class="pda-btn pda-btn--success" @click="onConfirm(a)">确认入库</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.recv-steps { display: flex; flex-wrap: wrap; gap: 8px; }
.recv-step {
  font-size: 14px; font-weight: 600; color: #1f6fd6;
  background: #eaf3ff; border-radius: 6px; padding: 4px 10px;
}
.recv-card-title { font-size: 17px; font-weight: 700; margin-bottom: 10px; color: #303133; }
.recv-kv { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; font-size: 16px; }
.recv-kv span { color: #909399; flex-shrink: 0; }
.recv-kv b { color: #303133; text-align: right; word-break: break-all; }
.recv-abc { color: #1f6fd6 !important; }
.recv-hint { color: #e6a100; font-size: 14px; margin-top: 4px; }
.recv-label { display: block; font-size: 15px; color: #606266; margin: 10px 0 4px; }
.recv-input { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; }
.recv-decisions { display: flex; gap: 8px; margin-bottom: 6px; }
.recv-decision { font-size: 16px; min-height: 48px; }
.recv-sum { margin: 8px 0; font-size: 16px; font-weight: 600; color: #22a355; }
.recv-sum--error { color: #d93026; }
.recv-mrb {
  margin: 8px 0; padding: 8px 10px; border-radius: 6px;
  background: #eaf3ff; color: #1f6fd6; font-weight: 600;
}
.recv-block-btn { width: 100%; margin-top: 10px; }
.recv-label-content { font-size: 14px; color: #606266; margin-top: 8px; word-break: break-all; }
.recv-empty { color: #a8abb2; font-size: 15px; padding: 8px 0; }
.recv-arrival { border-top: 1px solid #ebeef5; padding: 10px 0; }
.recv-arrival:first-of-type { border-top: none; }
.recv-row-btns { display: flex; gap: 8px; margin-top: 8px; }
.recv-row-btns .pda-btn { min-height: 48px; font-size: 16px; }
</style>
