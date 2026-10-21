<script setup lang="ts">
// 打字机轮播。
// 自研实现：逐字打出 → 停留 → 逐字删除 → 下一句；减少动态时直接显示第一句。
import { onBeforeUnmount, onMounted, ref } from 'vue'
const props = withDefaults(defineProps<{ lines: string[]; typeMs?: number; holdMs?: number; eraseMs?: number }>(), { typeMs: 90, holdMs: 1800, eraseMs: 40 })
const text = ref('')
let timer: ReturnType<typeof setTimeout> | undefined, i = 0, k = 0, erasing = false
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
function tick() {
  const line = props.lines[i % props.lines.length]
  if (!erasing) {
    k++; text.value = line.slice(0, k)
    if (k >= line.length) { erasing = true; timer = setTimeout(tick, props.holdMs); return }
    timer = setTimeout(tick, props.typeMs + Math.random() * 60)
  } else {
    k--; text.value = line.slice(0, k)
    if (k <= 0) { erasing = false; i++; timer = setTimeout(tick, 380); return }
    timer = setTimeout(tick, props.eraseMs)
  }
}
onMounted(() => { if (reduced) text.value = props.lines[0]; else tick() })
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template><span class="typed" :aria-label="lines.join('；')"><span aria-hidden="true">{{ text }}</span><i class="caret" aria-hidden="true"></i></span></template>
<style scoped>
.caret { display: inline-block; width: 2px; height: 1.05em; margin-left: .12em; vertical-align: -.14em; background: var(--pink); animation: caret 1s steps(1, end) infinite; }
@keyframes caret { 50% { opacity: 0; } }
</style>
