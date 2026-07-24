<script setup lang="ts">
/** 只读字段描述列表（PC 详情页常用） */
export interface DescItem {
  label: string
  value: unknown
  /** 跨列数（默认 1） */
  span?: number
}

withDefaults(
  defineProps<{
    items: DescItem[]
    /** 每行字段数 */
    column?: number
    border?: boolean
    title?: string
  }>(),
  { column: 3, border: true, title: '' }
)

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-'
  return String(v)
}
</script>

<template>
  <el-descriptions :title="title || undefined" :column="column" :border="border">
    <el-descriptions-item v-for="(it, i) in items" :key="i" :label="it.label" :span="it.span ?? 1">
      {{ fmt(it.value) }}
    </el-descriptions-item>
  </el-descriptions>
</template>
