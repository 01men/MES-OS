<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PcLayout from '@/layouts/PcLayout.vue'
import PdaLayout from '@/layouts/PdaLayout.vue'

const route = useRoute()

const layouts: Record<string, any> = {
  pc: PcLayout,
  pda: PdaLayout
}

const layoutComp = computed(() => layouts[route.meta.layout as string] ?? null)
</script>

<template>
  <router-view v-slot="{ Component }">
    <component :is="layoutComp" v-if="layoutComp">
      <component :is="Component" :key="route.fullPath" />
    </component>
    <component :is="Component" v-else />
  </router-view>
</template>
