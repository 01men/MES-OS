<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import ScanInput from '@/components/ScanInput.vue'
import ScanFeedback from '@/components/ScanFeedback.vue'
import { setPdaActions } from '@/layouts/pdaActions'
import { enqueue } from '@/api/offline'
import { createQtransfer, confirmQtransfer } from '@/api/returns'

const packageNo = ref('')
const direction = ref<'GOOD_TO_BAD' | 'BAD_TO_GOOD'>('GOOD_TO_BAD')
const reason = ref('')
const submitting = ref(false)
/** 已提交的调拨单 */
const transferId = ref('')
const posted = ref(false)
const postStatus = ref('')

const fb = ref<{ type: 'success' | 'error' | 'duplicate' | 'offline'; msg: string; detail?: string }>({
  type: 'success',
  msg: ''
})
function setFb(type: typeof fb.value.type, msg: string, detail = '') {
  fb.value = { type, msg, detail }
}

const formValid = computed(() => !!packageNo.value.trim() && !!reason.value.trim())

function onScan(code: string) {
  packageNo.value = code
  transferId.value = ''
  posted.value = false
  postStatus.value = ''
  setFb('success', `包装码：${code}`)
}

async function submit() {
  if (!formValid.value || submitting.value) return
  submitting.value = true
  const payload = { packageNo: packageNo.value.trim(), direction: direction.value, reason: reason.value.trim() }
  try {
    const res = await createQtransfer(payload)
    transferId.value = res.data?.id ?? res.data?.qtransferId ?? ''
    setFb('success', '调拨申请已提交', '请质检角色账号进行电子签确认')
  } catch (err: any) {
    if (!err?.response) {
      enqueue({ url: '/returns/qtransfers', method: 'post', data: payload })
      setFb('offline', '已离线暂存，联网后自动同步')
    } else {
      const msg = err.response.data?.message
      setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '调拨提交失败'))
    }
  } finally {
    submitting.value = false
  }
}

/** 质检电子签确认（质检角色账号操作）；确认类必须在线 */
async function confirm() {
  if (!transferId.value || submitting.value) return
  submitting.value = true
  try {
    const res = await confirmQtransfer(transferId.value)
    posted.value = true
    postStatus.value = res.data?.status ?? res.data?.postStatus ?? '已过账'
    setFb('success', '电子签确认完成', `过账状态：${postStatus.value}`)
  } catch (err: any) {
    const msg = err?.response?.data?.message
    setFb('error', Array.isArray(msg) ? msg[0] : String(msg ?? '电子签确认失败（需质检角色权限）'))
  } finally {
    submitting.value = false
  }
}

watchEffect(() => {
  if (posted.value) {
    setPdaActions([{ label: '已过账', type: 'success', disabled: true, onClick: () => undefined }])
  } else if (transferId.value) {
    setPdaActions([
      {
        label: submitting.value ? '确认中…' : '质检电子签确认',
        type: 'warning',
        disabled: submitting.value,
        onClick: confirm
      }
    ])
  } else {
    setPdaActions([
      {
        label: submitting.value ? '提交中…' : '提交调拨申请',
        type: 'primary',
        disabled: !formValid.value || submitting.value,
        onClick: submit
      }
    ])
  }
})
</script>

<template>
  <div>
    <ScanFeedback :type="fb.type" :message="fb.msg" :detail="fb.detail" />

    <div class="pda-card">
      <ScanInput placeholder="扫描包装码" @scan="onScan" />
      <div v-if="packageNo" class="pkg">当前包装码：{{ packageNo }}</div>
    </div>

    <div class="pda-card">
      <div class="field-label">调拨方向</div>
      <div class="dir-row">
        <button class="dir-btn" :class="{ active: direction === 'GOOD_TO_BAD' }" @click="direction = 'GOOD_TO_BAD'">良品 → 不良</button>
        <button class="dir-btn" :class="{ active: direction === 'BAD_TO_GOOD' }" @click="direction = 'BAD_TO_GOOD'">不良 → 良品</button>
      </div>
      <div class="field-label">原因</div>
      <input v-model="reason" class="pda-input field" type="text" placeholder="调拨原因（必填）" :disabled="!!transferId" />
    </div>

    <div v-if="posted" class="pda-card posted-box">
      <div class="posted-title">✓ 已过账</div>
      <div class="posted-sub">过账状态：{{ postStatus }}</div>
    </div>
    <div v-else-if="transferId" class="pda-card wait-box">
      调拨单 {{ transferId }} 待质检电子签确认
    </div>
  </div>
</template>

<style scoped>
.pkg { margin-top: 10px; font-size: 17px; font-weight: 700; color: #1f6fd6; }
.field-label { font-size: 15px; color: #606266; margin: 10px 0 4px; font-weight: 600; }
.field-label:first-child { margin-top: 0; }
.field { width: 100%; box-sizing: border-box; border: 1px solid #dcdfe6; }
.dir-row { display: flex; gap: 10px; }
.dir-btn {
  flex: 1; min-height: 52px; border: 2px solid #dcdfe6; border-radius: 10px; background: #fff;
  font-size: 17px; font-weight: 600; color: #303133; cursor: pointer;
}
.dir-btn.active { border-color: #1f6fd6; background: #eaf3ff; color: #1f6fd6; }
.wait-box { font-size: 17px; font-weight: 700; color: #e6a100; text-align: center; }
.posted-box { text-align: center; }
.posted-title { font-size: 22px; font-weight: 800; color: #22a355; }
.posted-sub { margin-top: 8px; font-size: 16px; color: #606266; }
</style>
