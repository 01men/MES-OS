<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import ScanInput from '@/components/ScanInput.vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import PhotoCapture from '@/components/PhotoCapture.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import {
  fetchNotes, fetchNote, scanSerial, confirmPhotos, shortShip, release,
  type PhotoType, type ShippingNote
} from '@/api/shipping'

type Mode = 'list' | 'work'
const PHOTO_TYPES: Array<{ key: PhotoType; label: string }> = [
  { key: 'CAR', label: '车牌' },
  { key: 'SEAL', label: '签封' },
  { key: 'EMPTY', label: '空柜' },
  { key: 'SIDE1', label: '货物左侧' },
  { key: 'SIDE2', label: '货物右侧' },
  { key: 'MARK', label: '唛头' }
]
const STEPS = ['扫描', '拍照', '差异确认', '放行']

const mode = ref<Mode>('list')
const notes = ref<ShippingNote[]>([])
const note = ref<ShippingNote | null>(null)
const step = ref(1)
const loading = ref(false)
const submitting = ref(false)

const photos = ref<Partial<Record<PhotoType, string>>>({})
const shortShipReason = ref('')
const shortShipSubmitted = ref(false)
const keeperConfirm = ref(false)
const driverName = ref('')
const driverConfirm = ref(false)
const released = ref(false)
const u8Status = ref('')

const fb = ref<{ type: 'success' | 'error' | 'duplicate' | 'offline'; msg: string; detail?: string }>({
  type: 'success',
  msg: ''
})
function setFb(type: typeof fb.value.type, msg: string, detail = '') {
  fb.value = { type, msg, detail }
}

/* ---------- 发货单列表 ---------- */
async function loadNotes() {
  loading.value = true
  try {
    const res = await fetchNotes()
    notes.value = res.data ?? []
  } finally {
    loading.value = false
  }
}

async function refreshNote() {
  if (!note.value) return
  const res = await fetchNote(note.value.id)
  note.value = res.data
}

async function openNote(n: ShippingNote) {
  loading.value = true
  try {
    const res = await fetchNote(n.id)
    note.value = res.data
    mode.value = 'work'
    step.value = 1
    photos.value = {}
    shortShipReason.value = ''
    shortShipSubmitted.value = false
    keeperConfirm.value = false
    driverName.value = ''
    driverConfirm.value = false
    released.value = false
    u8Status.value = ''
    setFb('success', '')
  } finally {
    loading.value = false
  }
}

function backToList() {
  mode.value = 'list'
  note.value = null
  void loadNotes()
}

/* ---------- 步骤 1：扫描 ---------- */
const nextHint = computed(() => {
  const ne = note.value?.nextExpected
  if (!ne || (!ne.orderNo && !ne.productCode)) return ''
  return `请扫：订单${ne.orderNo ?? '-'} 产品${ne.productCode ?? '-'}`
})

async function onScan(serialNo: string) {
  if (!note.value || submitting.value) return
  submitting.value = true
  try {
    await scanSerial(note.value.id, serialNo)
    setFb('success', `扫码成功：${serialNo}`)
    await refreshNote()
  } catch (err: any) {
    const d = err?.response?.data
    const code = d?.code
    const msg = d?.message
    const text = Array.isArray(msg) ? msg[0] : String(msg ?? '')
    if (code === 'DUPLICATE_SCAN') {
      const first = [d?.firstScanAt, d?.firstScanBy].filter(Boolean).join(' / ')
      setFb('duplicate', '重复扫码', first ? `首次：${first}` : text)
    } else if (code === 'SERIAL_NOT_FOUND') {
      setFb('error', '序列号不存在', text || serialNo)
    } else if (code === 'WRONG_ORDER') {
      setFb('error', '扫错订单', text || serialNo)
    } else if (code === 'OVER_SHIP') {
      setFb('error', '超发：该订单已扫满', text)
    } else if (code === 'SEQUENCE_VIOLATION') {
      const hint = d?.nextExpected ? `应扫：订单${d.nextExpected.orderNo ?? '-'} 产品${d.nextExpected.productCode ?? '-'}` : text
      setFb('error', '扫码顺序错误', hint)
    } else {
      setFb('error', text || '扫码失败', serialNo)
    }
    await refreshNote().catch(() => undefined)
  } finally {
    submitting.value = false
  }
}

/* ---------- 步骤 2：拍照 ---------- */
const allPhotosDone = computed(() => PHOTO_TYPES.every((p) => photos.value[p.key]))

function onPhotoUploaded(type: PhotoType, url: string) {
  photos.value = { ...photos.value, [type]: url }
  setFb('success', `${PHOTO_TYPES.find((p) => p.key === type)?.label}照片已上传`)
}

async function submitPhotos() {
  if (!note.value || !allPhotosDone.value) return
  submitting.value = true
  try {
    await confirmPhotos(
      note.value.id,
      PHOTO_TYPES.map((p) => ({ photoType: p.key, url: photos.value[p.key]! }))
    )
    setFb('success', '六类照片已确认')
    step.value = 3
    await refreshNote().catch(() => undefined)
  } catch (err: any) {
    const msg = err?.response?.data?.message
    setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '照片确认失败'))
  } finally {
    submitting.value = false
  }
}

/* ---------- 步骤 3：差异确认 ---------- */
const hasShortage = computed(() => (note.value?.shortages?.length ?? 0) > 0 || (note.value?.shortageQty ?? 0) > 0)

async function submitShortShip() {
  if (!note.value || !shortShipReason.value.trim()) return
  submitting.value = true
  try {
    await shortShip(note.value.id, shortShipReason.value.trim())
    shortShipSubmitted.value = true
    setFb('success', '少发申请已提交', '待审批')
    await refreshNote().catch(() => undefined)
  } catch (err: any) {
    const msg = err?.response?.data?.message
    setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '少发提交失败'))
  } finally {
    submitting.value = false
  }
}

/* ---------- 步骤 4：放行（必须在线） ---------- */
const canRelease = computed(
  () => keeperConfirm.value && driverConfirm.value && !!driverName.value.trim() && !released.value
)

async function doRelease() {
  if (!note.value || !canRelease.value) return
  submitting.value = true
  try {
    const res = await release(note.value.id, {
      keeperConfirm: true,
      driverName: driverName.value.trim(),
      driverConfirm: true
    })
    released.value = true
    u8Status.value = res.data?.u8SyncStatus ?? res.data?.status ?? '已放行'
    setFb('success', '放行成功', `U8 同步状态：${u8Status.value}`)
    await refreshNote().catch(() => undefined)
  } catch (err: any) {
    const msg = err?.response?.data?.message
    setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '放行失败（放行操作必须在线）'))
  } finally {
    submitting.value = false
  }
}

/* ---------- 底部主操作（随步骤切换） ---------- */
watchEffect(() => {
  if (mode.value === 'list') {
    setPdaActions([{ label: loading.value ? '加载中…' : '刷新发货单', type: 'primary', disabled: loading.value, onClick: loadNotes }])
    return
  }
  if (step.value === 1) {
    setPdaActions([{ label: '扫描完成，去拍照', type: 'primary', onClick: () => { step.value = 2 } }])
  } else if (step.value === 2) {
    setPdaActions([
      { label: '上一步', type: 'info', onClick: () => { step.value = 1 } },
      {
        label: submitting.value ? '提交中…' : `确认照片（${Object.keys(photos.value).length}/6）`,
        type: 'primary',
        disabled: !allPhotosDone.value || submitting.value,
        onClick: submitPhotos
      }
    ])
  } else if (step.value === 3) {
    setPdaActions([{ label: '去放行', type: 'primary', onClick: () => { step.value = 4 } }])
  } else {
    setPdaActions([
      {
        label: released.value ? '已放行' : submitting.value ? '放行中…' : '确认放行',
        type: 'success',
        disabled: !canRelease.value || submitting.value,
        onClick: doRelease
      }
    ])
  }
})

onMounted(loadNotes)
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.msg" :detail="fb.detail" />

    <!-- 发货单列表 -->
    <template v-if="mode === 'list'">
      <div v-if="!notes.length && !loading" class="pda-card empty">暂无发货单</div>
      <button v-for="n in notes" :key="n.id" class="pda-card note-item" @click="openNote(n)">
        <div class="note-no">{{ n.noteNo }}</div>
        <div class="note-sub">客户 {{ n.customerCode ?? '-' }} · {{ n.status }}</div>
      </button>
    </template>

    <!-- 放行作业 -->
    <template v-else-if="note">
      <!-- 步骤条 -->
      <div class="pda-card steps">
        <div v-for="(s, i) in STEPS" :key="s" class="step" :class="{ active: step === i + 1, done: step > i + 1 }">
          <span class="step-dot">{{ i + 1 }}</span>
          <span class="step-label">{{ s }}</span>
        </div>
      </div>

      <div class="pda-card note-head">
        <div class="note-no">{{ note.noteNo }}</div>
        <div class="note-sub">客户 {{ note.customerCode ?? '-' }} · {{ note.status }}</div>
      </div>

      <!-- 步骤 1：扫描 -->
      <template v-if="step === 1">
        <div class="pda-card counters">
          <div class="counter"><span class="counter-num">{{ note.shouldQty ?? '-' }}</span><span class="counter-label">应发</span></div>
          <div class="counter"><span class="counter-num ok">{{ note.scannedQty ?? 0 }}</span><span class="counter-label">已扫</span></div>
          <div class="counter"><span class="counter-num warn">{{ note.shortageQty ?? '-' }}</span><span class="counter-label">欠发</span></div>
          <div class="counter"><span class="counter-num dup">{{ note.duplicateScanCount ?? 0 }}</span><span class="counter-label">重复</span></div>
        </div>
        <div v-if="nextHint" class="pda-card next-hint">{{ nextHint }}</div>
        <div class="pda-card">
          <ScanInput placeholder="扫描成品序列号" @scan="onScan" />
        </div>
      </template>

      <!-- 步骤 2：六类照片 -->
      <template v-else-if="step === 2">
        <div v-for="p in PHOTO_TYPES" :key="p.key" class="pda-card photo-item">
          <div class="photo-title">
            {{ p.label }}
            <span v-if="photos[p.key]" class="photo-done">✓ 已上传</span>
            <span v-else class="photo-wait">待拍摄</span>
          </div>
          <PhotoCapture
            upload-url="/common/upload"
            :storage-key="`wms-photo-p14-${note.noteNo}-${p.key}`"
            @uploaded="(url: string) => onPhotoUploaded(p.key, url)"
            @error="(msg: string) => setFb('error', msg)"
          />
        </div>
      </template>

      <!-- 步骤 3：差异确认 -->
      <template v-else-if="step === 3">
        <div class="pda-card">
          <div class="section-title">欠发明细</div>
          <template v-if="hasShortage">
            <div v-for="(s, i) in note.shortages ?? []" :key="i" class="shortage-row">
              订单 {{ s.orderNo ?? '-' }} · 产品 {{ s.productCode ?? '-' }} · 欠发 {{ s.qty ?? '-' }}
            </div>
            <div v-if="!(note.shortages?.length)" class="shortage-row">欠发数量：{{ note.shortageQty }}</div>
            <template v-if="!shortShipSubmitted">
              <input v-model="shortShipReason" class="pda-input reason-input" type="text" placeholder="少发原因（必填）" />
              <button
                class="pda-btn pda-btn--warning"
                :disabled="!shortShipReason.trim() || submitting"
                @click="submitShortShip"
              >提交少发申请</button>
            </template>
            <div v-else class="pending-approval">少发申请已提交，待审批</div>
          </template>
          <div v-else class="empty">无欠发差异</div>
        </div>
      </template>

      <!-- 步骤 4：放行 -->
      <template v-else>
        <div class="pda-card">
          <label class="check-row">
            <input v-model="keeperConfirm" type="checkbox" class="check-box" :disabled="released" />
            <span>仓管员确认：货物、照片、单据核对无误</span>
          </label>
          <input v-model="driverName" class="pda-input reason-input" type="text" placeholder="司机姓名" :disabled="released" />
          <label class="check-row">
            <input v-model="driverConfirm" type="checkbox" class="check-box" :disabled="released" />
            <span>司机确认：已核对装柜货物</span>
          </label>
        </div>
        <div v-if="released" class="pda-card released-box">
          <div class="released-title">✓ 已放行</div>
          <div class="released-sub">U8 同步状态：{{ u8Status || note.u8SyncStatus || note.status }}</div>
          <button class="pda-btn pda-btn--info" @click="backToList">返回发货单列表</button>
        </div>
      </template>

      <button v-if="!released" class="pda-btn pda-btn--info back-btn" @click="backToList">返回发货单列表</button>
    </template>
  </div>
</template>

<style scoped>
.empty { text-align: center; color: #909399; }
.note-item { display: block; width: 100%; text-align: left; border: none; cursor: pointer; }
.note-no { font-size: 19px; font-weight: 700; color: #303133; }
.note-sub { margin-top: 4px; font-size: 15px; color: #909399; }

.steps { display: flex; justify-content: space-between; padding: 12px 8px; }
.step { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
.step-dot {
  width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: #dcdfe6; color: #fff; font-size: 15px; font-weight: 700;
}
.step.active .step-dot { background: #1f6fd6; }
.step.done .step-dot { background: #22a355; }
.step-label { font-size: 13px; color: #909399; }
.step.active .step-label { color: #1f6fd6; font-weight: 700; }

.counters { display: flex; justify-content: space-around; text-align: center; }
.counter { display: flex; flex-direction: column; gap: 2px; }
.counter-num { font-size: 26px; font-weight: 800; color: #303133; }
.counter-num.ok { color: #22a355; }
.counter-num.warn { color: #d93026; }
.counter-num.dup { color: #e6a100; }
.counter-label { font-size: 14px; color: #909399; }

.next-hint { background: #fff7e6; color: #b26a00; font-size: 18px; font-weight: 700; text-align: center; }

.photo-title { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
.photo-done { color: #22a355; font-size: 14px; margin-left: 8px; }
.photo-wait { color: #909399; font-size: 14px; margin-left: 8px; font-weight: 400; }

.section-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.shortage-row { padding: 8px 0; font-size: 16px; border-bottom: 1px solid #f0f0f0; }
.reason-input { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; margin: 10px 0; }
.pending-approval { margin-top: 10px; color: #e6a100; font-size: 17px; font-weight: 700; }

.check-row { display: flex; align-items: center; gap: 10px; padding: 12px 0; font-size: 17px; }
.check-box { width: 26px; height: 26px; flex-shrink: 0; }

.released-box { text-align: center; }
.released-title { font-size: 22px; font-weight: 800; color: #22a355; }
.released-sub { margin: 8px 0 12px; font-size: 16px; color: #606266; }
.back-btn { width: 100%; margin-top: 4px; }
</style>
