<script setup lang="ts">
import { ref } from 'vue'
import http from '@/api/http'

/**
 * 拍照上传（PDA/手机）：
 * - <input type=file accept="image/*" capture> 调起相机
 * - 本地预览 + canvas 压缩（最长边 maxEdge，默认 1600px，JPEG）
 * - 上传使用唯一文件名；失败保留到待传列表（localStorage 持久化），可 retry
 */
const props = withDefaults(
  defineProps<{
    /** 压缩后最长边像素 */
    maxEdge?: number
    /** JPEG 质量 0-1 */
    quality?: number
    /** 上传接口（相对 /api） */
    uploadUrl?: string
    /** 选择后自动上传；false 时仅预览+压缩，由父级取 blob 自行提交 */
    autoUpload?: boolean
    /** 待传列表持久化 key（区分业务场景，避免串单） */
    storageKey?: string
  }>(),
  {
    maxEdge: 1600,
    quality: 0.8,
    uploadUrl: '/common/upload',
    autoUpload: true,
    storageKey: 'wms-photo-pending'
  }
)

const emit = defineEmits<{
  (e: 'uploaded', url: string): void
  (e: 'error', message: string): void
  (e: 'pending-change', list: PendingPhoto[]): void
}>()

export interface PendingPhoto {
  id: string
  fileName: string
  dataUrl: string
  createdAt: number
}

const fileRef = ref<HTMLInputElement>()
const previewUrl = ref('')
const uploading = ref(false)
const pending = ref<PendingPhoto[]>(loadPending())

function loadPending(): PendingPhoto[] {
  try {
    return JSON.parse(localStorage.getItem(props.storageKey) || '[]')
  } catch {
    return []
  }
}

function savePending() {
  try {
    localStorage.setItem(props.storageKey, JSON.stringify(pending.value))
  } catch {
    /* 超出配额时仅保留内存态 */
  }
  emit('pending-change', pending.value)
}

function uniqueName(ext = 'jpg'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `photo-${Date.now()}-${rand}.${ext}`
}

/** canvas 压缩：最长边压到 maxEdge，输出 JPEG Blob */
function compress(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, props.maxEdge / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))),
        'image/jpeg',
        props.quality
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('图片序列化失败'))
    r.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(head)?.[1] || 'image/jpeg'
  const bin = atob(body)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

async function doUpload(blob: Blob, fileName: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', blob, fileName)
  const res = await http.post(props.uploadUrl, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    silent: true
  } as never)
  // 后端返回 {url} 或直接字符串，按实际接口微调
  const data: any = res.data
  return typeof data === 'string' ? data : data?.url ?? ''
}

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选同一文件
  if (!file) return
  try {
    const blob = await compress(file)
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = URL.createObjectURL(blob)
    if (props.autoUpload) await uploadOrQueue(blob, uniqueName())
  } catch (err: any) {
    emit('error', err?.message ?? '图片处理失败')
  }
}

async function uploadOrQueue(blob: Blob, fileName: string) {
  uploading.value = true
  try {
    const url = await doUpload(blob, fileName)
    emit('uploaded', url)
  } catch {
    // 失败保留待传列表（离线/弱网重试）
    const dataUrl = await blobToDataUrl(blob)
    pending.value = [...pending.value, { id: fileName, fileName, dataUrl, createdAt: Date.now() }]
    savePending()
    emit('error', '上传失败，已加入待传列表')
  } finally {
    uploading.value = false
  }
}

/** 重试某条待传照片 */
async function retry(item: PendingPhoto) {
  uploading.value = true
  try {
    const url = await doUpload(dataUrlToBlob(item.dataUrl), item.fileName)
    pending.value = pending.value.filter((p) => p.id !== item.id)
    savePending()
    emit('uploaded', url)
  } catch {
    emit('error', '重试上传失败')
  } finally {
    uploading.value = false
  }
}

function trigger() {
  fileRef.value?.click()
}

defineExpose({ trigger, retry, pending })
</script>

<template>
  <div class="photo-capture">
    <input ref="fileRef" type="file" accept="image/*" capture="environment" hidden @change="onPick" />
    <button type="button" class="pda-btn pda-btn--primary" :disabled="uploading" @click="trigger">
      {{ uploading ? '上传中…' : '拍照上传' }}
    </button>
    <img v-if="previewUrl" :src="previewUrl" class="photo-capture-preview" alt="照片预览" />
    <div v-if="pending.length" class="photo-capture-pending">
      <div class="photo-capture-pending-title">待传照片（{{ pending.length }}）</div>
      <div v-for="p in pending" :key="p.id" class="photo-capture-pending-item">
        <img :src="p.dataUrl" alt="待传照片" />
        <button type="button" :disabled="uploading" @click="retry(p)">重试</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.photo-capture-preview {
  display: block; width: 100%; max-height: 280px; object-fit: contain;
  margin-top: 10px; border-radius: 8px; background: #000;
}
.photo-capture-pending { margin-top: 10px; font-size: 15px; }
.photo-capture-pending-title { color: #e8720c; font-weight: 600; margin-bottom: 6px; }
.photo-capture-pending-item {
  display: flex; align-items: center; gap: 10px; padding: 6px 0;
}
.photo-capture-pending-item img { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; }
.photo-capture-pending-item button {
  font-size: 15px; padding: 8px 16px; border: 1px solid #1f6fd6; color: #1f6fd6;
  background: #fff; border-radius: 6px;
}
</style>
