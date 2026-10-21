<script setup lang="ts">
// 底部 Dock：最小化的窗口排在这里，点一下还原（首页窗口最小化到坞条的同款行为）。
defineProps<{ items: { id: string; label: string; tone: string }[] }>()
const emit = defineEmits<{ restore: [id: string] }>()
</script>
<template>
  <nav v-if="items.length" class="dock no-print" aria-label="已最小化的窗口">
    <span class="dock__l">已收起</span>
    <button v-for="it in items" :key="it.id" type="button" class="dock__b" :class="`t-${it.tone}`" @click="emit('restore', it.id)"><i></i>{{ it.label }}</button>
  </nav>
</template>
<style scoped>
.dock { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 1500; display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--white); border: 1px solid var(--ink); box-shadow: var(--shadow); animation: win-up .35s var(--ease) both; }
.dock__l { font: 400 12px/1 var(--pixel); color: var(--muted); padding: 0 4px; }
.dock__b { display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px; font-size: 13px; }
.dock__b i { width: 9px; height: 9px; background: var(--ink); }
.t-purple i { background: var(--purple-d); } .t-green i { background: var(--green-d); } .t-orange i { background: var(--orange); } .t-pink i { background: var(--pink); }
</style>
