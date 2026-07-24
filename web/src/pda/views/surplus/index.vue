<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import ScanInput from '@/components/ScanInput.vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import { useAuthStore } from '@/stores/auth'
import { enqueue } from '@/api/offline'
import {
  createSurplus,
  getSurplusList,
  printSurplusLabel,
  processSurplus,
  type SurplusItem,
  type SurplusLabel,
  type SurplusSourceType,
  type SurplusProcessMethod
} from '@/api/surplus'

const auth = useAuthStore()

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

/* ---------- 登记表单 ---------- */
const SOURCE_TYPES: { v: SurplusSourceType; t: string }[] = [
  { v: 'SUPPLIER_EXTRA', t: '供应商多送' },
  { v: 'ORDER_LEFT', t: '工单剩余' },
  { v: 'WORKSHOP_RETURN', t: '车间退料' }
]
const form = reactive({
  packageNo: '',
  sourceType: 'ORDER_LEFT' as SurplusSourceType,
  sourceDocNo: '',
  responsible: auth.user?.username ?? ''
})

function onScan(code: string) {
  form.packageNo = code
  showFb('success', `已扫包装码：${code}`)
}

/* ---------- 登记入 YL 区（采集类：断网入离线队列） ---------- */
const submitting = ref(false)

async function onRegister() {
  if (submitting.value) return
  if (!form.packageNo || !form.sourceDocNo || !form.responsible) {
    showFb('error', '请扫包装码并填写来源单号、责任人')
    return
  }
  submitting.value = true
  const payload = {
    packageNo: form.packageNo,
    sourceType: form.sourceType,
    sourceDocNo: form.sourceDocNo,
    responsible: form.responsible
  }
  try {
    const res = await createSurplus(payload)
    const item = res.data
    showFb('success', `余料已登记入 ${item?.zoneCode ?? 'YL'} 区`, `包装号 ${form.packageNo}`)
    form.packageNo = ''
    form.sourceDocNo = ''
    await loadList()
  } catch (e: any) {
    if (isNetworkError(e)) {
      const taskNo = enqueue({ url: '/surplus', method: 'post', data: payload })
      showFb('offline', '网络异常，已离线暂存', `任务号 ${taskNo}，联网后自动提交`)
    } else {
      showFb('error', '登记失败', errMsg(e))
    }
  } finally {
    submitting.value = false
  }
}

/* ---------- 余料标签打印 ---------- */
const label = ref<{ item: SurplusItem; content: SurplusLabel } | null>(null)

async function onPrint(item: SurplusItem) {
  try {
    const res = await printSurplusLabel(item.id)
    label.value = { item, content: res.data ?? {} }
    showFb('success', `标签已打印：${item.packageNo}`)
  } catch (e: any) {
    showFb('error', '打印失败', errMsg(e))
  }
}

/* ---------- 余料列表 + 处理 ---------- */
const list = ref<SurplusItem[]>([])
const listLoading = ref(false)

async function loadList() {
  listLoading.value = true
  try {
    const res = await getSurplusList()
    list.value = Array.isArray(res.data) ? res.data : []
  } catch {
    /* 列表加载失败不打断登记 */
  } finally {
    listLoading.value = false
  }
}

const PROCESS_METHODS: { v: SurplusProcessMethod; t: string; needWo?: boolean }[] = [
  { v: 'RETURN_SUPPLIER', t: '退供应商' },
  { v: 'REUSE_ORDER', t: '用于后续订单', needWo: true },
  { v: 'CROSS_TRANSFER', t: '跨单挪用', needWo: true }
]
const proc = reactive<{
  target: SurplusItem | null
  method: SurplusProcessMethod
  qty: number
  targetWorkOrderId: string
}>({ target: null, method: 'RETURN_SUPPLIER', qty: 0, targetWorkOrderId: '' })

function openProcess(item: SurplusItem) {
  proc.target = item
  proc.method = 'RETURN_SUPPLIER'
  proc.qty = item.qty ?? 0
  proc.targetWorkOrderId = ''
}

const methodNeedWo = () => PROCESS_METHODS.find((m) => m.v === proc.method)?.needWo

async function onProcess() {
  if (!proc.target) return
  if (!proc.qty || proc.qty <= 0) {
    showFb('error', '请填写处理数量')
    return
  }
  if (methodNeedWo() && !proc.targetWorkOrderId.trim()) {
    showFb('error', '请填写目标工单号')
    return
  }
  try {
    await processSurplus(proc.target.id, {
      method: proc.method,
      qty: proc.qty,
      targetWorkOrderId: proc.targetWorkOrderId.trim() || undefined
    })
    showFb('success', `处理成功：${proc.target.packageNo}`)
    proc.target = null
    await loadList()
  } catch (e: any) {
    showFb('error', '处理失败', errMsg(e))
  }
}

onMounted(() => {
  void loadList()
  setPdaActions([
    { label: '登记入 YL 区', type: 'primary', onClick: () => void onRegister() },
    { label: '刷新列表', type: 'info', onClick: () => void loadList() }
  ])
})
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.message" :detail="fb.detail" />

    <!-- 扫包装码登记 -->
    <div class="pda-card">
      <div class="sp-card-title">余料登记</div>
      <ScanInput placeholder="扫描余料包装码" @scan="onScan" />
      <div v-if="form.packageNo" class="sp-pkg">包装码：<b>{{ form.packageNo }}</b></div>

      <label class="sp-label">来源类型</label>
      <div class="sp-source-types">
        <button
          v-for="s in SOURCE_TYPES"
          :key="s.v"
          class="pda-btn sp-source-btn"
          :class="form.sourceType === s.v ? 'pda-btn--primary' : 'pda-btn--info'"
          @click="form.sourceType = s.v"
        >
          {{ s.t }}
        </button>
      </div>

      <label class="sp-label">来源单号</label>
      <input v-model="form.sourceDocNo" class="pda-input sp-input" type="text" placeholder="采购单 / 工单 / 退料单号" />
      <label class="sp-label">责任人</label>
      <input v-model="form.responsible" class="pda-input sp-input" type="text" placeholder="责任人" />
    </div>

    <!-- 标签内容 -->
    <div v-if="label" class="pda-card">
      <div class="sp-card-title">余料标签 — {{ label.item.packageNo }}</div>
      <div class="sp-kv"><span>包装号</span><b>{{ label.content.packageNo ?? label.item.packageNo }}</b></div>
      <div class="sp-kv"><span>物料</span><b>{{ label.content.materialCode ?? label.item.materialCode ?? '-' }}</b></div>
      <div class="sp-kv"><span>数量</span><b>{{ label.content.qty ?? label.item.qty ?? '-' }}</b></div>
      <div class="sp-kv"><span>来源类型</span><b>{{ label.content.sourceType ?? label.item.sourceType }}</b></div>
      <div class="sp-kv"><span>来源单号</span><b>{{ label.content.sourceDocNo ?? label.item.sourceDocNo }}</b></div>
      <div class="sp-kv"><span>责任人</span><b>{{ label.content.responsible ?? label.item.responsible }}</b></div>
      <div class="sp-kv"><span>存放区</span><b>{{ label.content.zoneCode ?? 'YL' }}</b></div>
    </div>

    <!-- 处理表单 -->
    <div v-if="proc.target" class="pda-card">
      <div class="sp-card-title">处理余料 — {{ proc.target.packageNo }}（现存 {{ proc.target.qty ?? '-' }}）</div>
      <div class="sp-source-types">
        <button
          v-for="m in PROCESS_METHODS"
          :key="m.v"
          class="pda-btn sp-source-btn"
          :class="proc.method === m.v ? 'pda-btn--warning' : 'pda-btn--info'"
          @click="proc.method = m.v"
        >
          {{ m.t }}
        </button>
      </div>
      <label class="sp-label">处理数量</label>
      <input v-model.number="proc.qty" class="pda-input sp-input" type="number" min="0" />
      <template v-if="methodNeedWo()">
        <label class="sp-label">目标工单号</label>
        <input v-model="proc.targetWorkOrderId" class="pda-input sp-input" type="text" placeholder="目标工单号" />
      </template>
      <div class="sp-proc-btns">
        <button class="pda-btn pda-btn--info" @click="proc.target = null">取消</button>
        <button class="pda-btn pda-btn--success" @click="onProcess">确认处理</button>
      </div>
    </div>

    <!-- 余料列表 -->
    <div class="pda-card">
      <div class="sp-card-title">余料列表{{ listLoading ? '（加载中…）' : `（${list.length}）` }}</div>
      <div v-if="!list.length && !listLoading" class="sp-empty">暂无余料记录</div>
      <div v-for="item in list" :key="String(item.id)" class="sp-item">
        <div class="sp-kv"><span>包装号</span><b>{{ item.packageNo }}</b></div>
        <div class="sp-kv"><span>物料 / 数量</span><b>{{ item.materialCode ?? '-' }} × {{ item.qty ?? '-' }}</b></div>
        <div class="sp-kv"><span>来源</span><b>{{ SOURCE_TYPES.find(s => s.v === item.sourceType)?.t ?? item.sourceType }} · {{ item.sourceDocNo }}</b></div>
        <div class="sp-kv"><span>状态</span><b>{{ item.status ?? '-' }}</b></div>
        <div class="sp-item-btns">
          <button class="pda-btn pda-btn--primary" @click="onPrint(item)">打印标签</button>
          <button class="pda-btn pda-btn--warning" @click="openProcess(item)">发起处理</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp-card-title { font-size: 17px; font-weight: 700; margin-bottom: 10px; color: #303133; }
.sp-pkg { margin-top: 10px; font-size: 16px; color: #303133; }
.sp-label { display: block; font-size: 15px; color: #606266; margin: 10px 0 4px; }
.sp-input { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; }
.sp-source-types { display: flex; gap: 8px; }
.sp-source-btn { font-size: 16px; min-height: 48px; }
.sp-kv { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; font-size: 16px; }
.sp-kv span { color: #909399; flex-shrink: 0; }
.sp-kv b { text-align: right; word-break: break-all; }
.sp-empty { color: #a8abb2; font-size: 15px; padding: 8px 0; }
.sp-item { border-top: 1px solid #ebeef5; padding: 10px 0; }
.sp-item:first-of-type { border-top: none; }
.sp-item-btns { display: flex; gap: 8px; margin-top: 8px; }
.sp-item-btns .pda-btn { min-height: 48px; font-size: 16px; }
.sp-proc-btns { display: flex; gap: 8px; margin-top: 12px; }
</style>
