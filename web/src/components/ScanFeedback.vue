<script setup lang="ts">
import { computed, watch } from 'vue'

/**
 * 扫码统一反馈条（PRD 4.12）：
 * - success：绿色 + 确认音（WebAudio 蜂鸣）+ 震动
 * - error：红色 + 低沉长鸣 + 连续震动
 * - duplicate：黄色（重复扫码，detail 里展示原扫码时间/人员）
 * - offline：橙色（已入离线队列）
 * type/message 变化即重新播报，连续扫同一码也会再次提示。
 */
const props = withDefaults(
  defineProps<{
    type: 'success' | 'error' | 'duplicate' | 'offline'
    message: string
    /** 补充信息，如重复扫码的原扫码时间/人员 */
    detail?: string
    /** 是否静音（默认有提示音+震动） */
    silent?: boolean
  }>(),
  { detail: '', silent: false }
)

const CONF: Record<string, { icon: string; label: string; freq: number; ms: number; times: number; vibrate: number | number[] }> = {
  success:   { icon: '✓', label: '成功',   freq: 880, ms: 120, times: 1, vibrate: 80 },
  error:     { icon: '✕', label: '失败',   freq: 220, ms: 350, times: 1, vibrate: [150, 80, 150] },
  duplicate: { icon: '⚠', label: '重复',   freq: 440, ms: 150, times: 2, vibrate: [80, 60, 80] },
  offline:   { icon: '☁', label: '已离线暂存', freq: 330, ms: 100, times: 1, vibrate: 60 }
}

const conf = computed(() => CONF[props.type] ?? CONF.success)

let ctx: AudioContext | null = null

function beep(freq: number, ms: number, times: number) {
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    let start = ctx.currentTime
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.15, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + ms / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + ms / 1000)
      start += (ms + 90) / 1000
    }
  } catch {
    /* 无音频环境时静默 */
  }
}

function playFeedback() {
  if (props.silent || !props.message) return
  const c = conf.value
  beep(c.freq, c.ms, c.times)
  if (navigator.vibrate) navigator.vibrate(c.vibrate)
}

watch(() => [props.type, props.message, props.detail], playFeedback, { immediate: true })
</script>

<template>
  <div v-if="message" class="scan-feedback" :class="`scan-feedback--${type}`" role="alert">
    <span class="scan-feedback-icon">{{ conf.icon }}</span>
    <div class="scan-feedback-body">
      <div class="scan-feedback-msg">{{ message }}</div>
      <div v-if="detail" class="scan-feedback-detail">{{ detail }}</div>
    </div>
  </div>
</template>

<style scoped>
.scan-feedback {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 8px; margin: 10px 0;
  font-size: 18px; font-weight: 600; color: #fff;
}
.scan-feedback-icon { font-size: 24px; line-height: 1; }
.scan-feedback-body { flex: 1; min-width: 0; }
.scan-feedback-detail { font-size: 14px; font-weight: 400; opacity: 0.92; margin-top: 2px; }
.scan-feedback--success   { background: var(--scan-success, #22a355); }
.scan-feedback--error     { background: var(--scan-error, #d93026); }
.scan-feedback--duplicate { background: var(--scan-duplicate, #e6a100); color: #3d2e00; }
.scan-feedback--offline   { background: var(--scan-offline, #e8720c); }
</style>
