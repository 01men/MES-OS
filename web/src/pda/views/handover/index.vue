<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import ScanInput from '@/components/ScanInput.vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import { useAuthStore } from '@/stores/auth'
import {
  getPrepOrders,
  getPrepOrder,
  confirmHandover,
  rejectHandover,
  type PrepOrder
} from '@/api/prep'

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

/* ---------- 备料单查询 ---------- */
const orders = ref<PrepOrder[]>([])
const order = ref<PrepOrder | null>(null)
const loading = ref(false)

async function loadOrders() {
  try {
    const res = await getPrepOrders()
    orders.value = Array.isArray(res.data) ? res.data : []
  } catch {
    /* 列表加载失败不影响扫码查询 */
  }
}

async function loadOrder(prepDocNo: string) {
  if (!prepDocNo || loading.value) return
  loading.value = true
  try {
    const res = await getPrepOrder(prepDocNo)
    order.value = res.data
    showFb('success', `已加载备料单：${prepDocNo}`)
  } catch (e: any) {
    order.value = null
    showFb('error', `备料单查询失败：${prepDocNo}`, errMsg(e))
  } finally {
    loading.value = false
  }
}

function onScan(docNo: string) {
  void loadOrder(docNo)
}

/* ---------- 双方确认状态 ---------- */
const prepId = computed(() => order.value?.prepId ?? order.value?.id ?? '')
const keeperConfirmed = computed(
  () => !!(order.value?.handover?.keeperConfirmed ?? order.value?.keeperConfirmed)
)
const receiverConfirmed = computed(
  () => !!(order.value?.handover?.receiverConfirmed ?? order.value?.receiverConfirmed)
)
const bothConfirmed = computed(() => keeperConfirmed.value && receiverConfirmed.value)
const postingStatus = computed(
  () => order.value?.handover?.postingStatus ?? order.value?.postingStatus ?? '-'
)
const u8SyncStatus = computed(
  () => order.value?.handover?.u8SyncStatus ?? order.value?.u8SyncStatus ?? '-'
)

/** 按当前用户角色决定可点的确认按钮 */
const roles = computed(() => auth.user?.roles ?? [])
const canKeeper = computed(
  () => roles.value.some((r) => ['仓管员', '系统管理员', 'admin'].includes(r)) || !roles.value.length
)
const canReceiver = computed(
  () => roles.value.some((r) => r.includes('生产') || r.includes('接收') || ['系统管理员', 'admin'].includes(r)) || !roles.value.length
)

/* ---------- 交接确认（高风险：必须在线） ---------- */
const confirming = ref(false)

async function onConfirm(role: 'KEEPER' | 'RECEIVER') {
  if (!order.value || confirming.value) return
  confirming.value = true
  try {
    await confirmHandover(prepId.value, role)
    showFb('success', role === 'KEEPER' ? '仓管员确认成功' : '生产接收确认成功')
    await loadOrder(String(order.value.prepDocNo))
  } catch (e: any) {
    if (isNetworkError(e)) {
      showFb('error', '该操作必须联网完成', '请连接网络后重试')
    } else {
      // 含 400 SAME_ACCOUNT_CONFIRM：交接双方不得为同一账号
      showFb('error', '交接确认失败', errMsg(e))
    }
  } finally {
    confirming.value = false
  }
}

/* ---------- 退回修改（过账前） ---------- */
const rejectReason = ref('')
const posted = computed(() => {
  const s = String(postingStatus.value)
  return bothConfirmed.value && s !== '-' && s !== '' && !/未|NOT|PENDING/i.test(s)
})

async function onReject() {
  if (!order.value) return
  if (!rejectReason.value.trim()) {
    showFb('error', '请填写退回原因')
    return
  }
  try {
    await rejectHandover(prepId.value, rejectReason.value.trim())
    showFb('success', '已退回修改')
    rejectReason.value = ''
    await loadOrder(String(order.value.prepDocNo))
  } catch (e: any) {
    showFb('error', '退回失败', errMsg(e))
  }
}

onMounted(() => {
  void loadOrders()
  setPdaActions([
    {
      label: '仓管员确认',
      type: 'primary',
      onClick: () => void onConfirm('KEEPER')
    },
    {
      label: '生产接收确认',
      type: 'success',
      onClick: () => void onConfirm('RECEIVER')
    }
  ])
})
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.message" :detail="fb.detail" />

    <!-- 输入/扫备料单号 -->
    <div class="pda-card">
      <div class="ho-card-title">扫描 / 选择备料单</div>
      <ScanInput placeholder="扫描备料单号" :disabled="loading" @scan="onScan" />
      <div v-if="orders.length" class="ho-order-list">
        <button
          v-for="o in orders"
          :key="String(o.prepDocNo ?? o.id)"
          class="ho-order-item"
          :class="{ 'ho-order-item--active': order?.prepDocNo === o.prepDocNo }"
          @click="loadOrder(String(o.prepDocNo))"
        >
          {{ o.prepDocNo }} <span class="ho-order-status">{{ o.status ?? '' }}</span>
        </button>
      </div>
    </div>

    <!-- 备料单明细 -->
    <div v-if="order" class="pda-card">
      <div class="ho-card-title">备料单 {{ order.prepDocNo }}（工单 {{ order.workOrderId ?? '-' }}）</div>

      <div v-for="(l, i) in order.lines ?? []" :key="i" class="ho-line">
        <div class="ho-line-main">
          <b>{{ l.materialCode }}</b>
          <span>× {{ l.requiredQty }}</span>
        </div>
        <div class="ho-line-sub">{{ l.materialName ?? '' }} {{ l.packageNo ? '· 包装 ' + l.packageNo : '' }}</div>
      </div>
      <div v-if="!(order.lines ?? []).length" class="ho-empty">无物料明细</div>

      <div v-if="order.leftoverReminder" class="ho-leftover">余料提醒：{{ order.leftoverReminder }}</div>

      <!-- 双方确认状态 -->
      <div class="ho-confirm-status">
        <div class="ho-status-item" :class="{ 'ho-status-item--done': keeperConfirmed }">
          仓管员：{{ keeperConfirmed ? '已确认 ✓' : '待确认' }}
          <span v-if="order.keeperConfirmTime" class="ho-status-time">{{ order.keeperConfirmTime }}</span>
        </div>
        <div class="ho-status-item" :class="{ 'ho-status-item--done': receiverConfirmed }">
          生产接收：{{ receiverConfirmed ? '已确认 ✓' : '待确认' }}
          <span v-if="order.receiverConfirmTime" class="ho-status-time">{{ order.receiverConfirmTime }}</span>
        </div>
      </div>

      <!-- 双方完成：过账 + U8 同步状态 -->
      <div v-if="bothConfirmed" class="ho-posting">
        <div class="ho-kv"><span>过账状态</span><b>{{ postingStatus }}</b></div>
        <div class="ho-kv"><span>U8 同步状态</span><b>{{ u8SyncStatus }}</b></div>
      </div>

      <!-- 角色提示 -->
      <div class="ho-role-hint">
        当前用户：{{ auth.user?.username ?? '-' }}（{{ roles.join('、') || '无角色' }}）
        <template v-if="!canKeeper && !canReceiver">，无确认权限</template>
      </div>

      <!-- 过账前可退回修改 -->
      <div v-if="!posted" class="ho-reject">
        <input v-model="rejectReason" class="pda-input ho-input" type="text" placeholder="退回原因（必填）" />
        <button class="pda-btn pda-btn--danger ho-block-btn" @click="onReject">退回修改</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ho-card-title { font-size: 17px; font-weight: 700; margin-bottom: 10px; color: #303133; }
.ho-order-list { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.ho-order-item {
  text-align: left; font-size: 16px; padding: 10px 12px;
  border: 1px solid #ebeef5; border-radius: 8px; background: #fff;
}
.ho-order-item--active { border-color: #1f6fd6; background: #eaf3ff; }
.ho-order-status { float: right; color: #909399; font-size: 14px; }
.ho-line { border-top: 1px solid #ebeef5; padding: 8px 0; }
.ho-line:first-of-type { border-top: none; }
.ho-line-main { display: flex; justify-content: space-between; font-size: 16px; }
.ho-line-sub { font-size: 14px; color: #909399; margin-top: 2px; }
.ho-empty { color: #a8abb2; font-size: 15px; padding: 6px 0; }
.ho-leftover { color: #e6a100; font-size: 14px; font-weight: 600; margin: 8px 0; }
.ho-confirm-status { display: flex; gap: 10px; margin: 12px 0; }
.ho-status-item {
  flex: 1; text-align: center; padding: 10px 6px; border-radius: 8px;
  background: #f5f6f8; color: #909399; font-size: 15px; font-weight: 600;
}
.ho-status-item--done { background: #e8f7ee; color: #22a355; }
.ho-status-time { display: block; font-size: 12px; font-weight: 400; margin-top: 2px; }
.ho-posting { border-top: 1px dashed #dcdfe6; padding-top: 10px; margin-top: 4px; }
.ho-kv { display: flex; justify-content: space-between; font-size: 16px; padding: 4px 0; }
.ho-kv span { color: #909399; }
.ho-role-hint { font-size: 14px; color: #606266; margin: 10px 0; }
.ho-reject { border-top: 1px dashed #dcdfe6; padding-top: 10px; }
.ho-input { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; }
.ho-block-btn { width: 100%; margin-top: 10px; }
</style>
