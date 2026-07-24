<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 扫码枪输入框（键盘楔入模式）：
 * - 挂载自动聚焦，失焦后自动夺回焦点（可用 autoRefocus 关闭）
 * - 扫码枪输入间隔 < scanInterval(默认50ms) 判定为枪输入
 * - 回车（扫码枪尾缀）触发 emit('scan', code) 并清空
 */
const props = withDefaults(
  defineProps<{
    placeholder?: string
    /** 失焦自动夺回焦点（PDA 常开） */
    autoRefocus?: boolean
    /** 扫码枪按键间隔阈值 ms */
    scanInterval?: number
    disabled?: boolean
  }>(),
  {
    placeholder: '请扫描条码 / 二维码',
    autoRefocus: true,
    scanInterval: 50,
    disabled: false
  }
)

const emit = defineEmits<{
  (e: 'scan', code: string): void
}>()

const value = ref('')
const inputRef = ref<HTMLInputElement>()
/** 最近一次判定结果：true=扫码枪输入（可用于页面提示） */
const lastFromGun = ref(false)

let lastKeyTime = 0
let refocusTimer: ReturnType<typeof setTimeout> | undefined

function onKeydown(e: KeyboardEvent) {
  const now = performance.now()
  // 连续按键间隔小于阈值 → 判定为扫码枪
  if (lastKeyTime && e.key.length === 1) {
    lastFromGun.value = now - lastKeyTime < props.scanInterval
  }
  lastKeyTime = now

  if (e.key === 'Enter') {
    e.preventDefault()
    const code = value.value.trim()
    if (code) emit('scan', code)
    value.value = ''
    lastKeyTime = 0
  }
}

function onBlur() {
  if (!props.autoRefocus || props.disabled) return
  refocusTimer = setTimeout(() => inputRef.value?.focus(), 80)
}

function focus() {
  inputRef.value?.focus()
}

onMounted(focus)
onBeforeUnmount(() => refocusTimer && clearTimeout(refocusTimer))

defineExpose({ focus, lastFromGun })
</script>

<template>
  <input
    ref="inputRef"
    v-model="value"
    class="scan-input pda-input"
    type="text"
    inputmode="none"
    autocomplete="off"
    :placeholder="placeholder"
    :disabled="disabled"
    @keydown="onKeydown"
    @blur="onBlur"
  />
</template>

<style scoped>
.scan-input {
  width: 100%;
  box-sizing: border-box;
  border: 2px solid #1f6fd6;
  border-radius: 8px;
  outline: none;
  background: #fff;
}
.scan-input:focus { border-color: #ff9f1a; box-shadow: 0 0 0 3px rgba(255, 159, 26, 0.25); }
</style>
