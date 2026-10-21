<script setup lang="ts">
// 回答正文：文字 + 可点的出处上标 [n]。
import { computed } from 'vue'
import type { Citation } from '../lib/api'
import { segments } from '../lib/cites'
const props = withDefaults(defineProps<{ text: string; registry: Citation[]; streaming?: boolean }>(), { streaming: false })
const emit = defineEmits<{ open: [c: Citation, n: number] }>()
const segs = computed(() => segments(props.text, props.registry, props.streaming))
</script>
<template>
  <span class="rich"><template v-for="(s, i) in segs" :key="i"><template v-if="s.t === 'text'">{{ s.v }}</template><sup v-else class="sup"><button type="button" class="cite-n" :aria-label="`出处 ${s.n}：${s.c.title}`" :title="s.c.title" @click="emit('open', s.c, s.n)">[{{ s.n }}]</button></sup></template></span>
</template>
<style scoped>
.rich { white-space: pre-wrap; }
.sup { line-height: 0; vertical-align: super; font-size: .72em; margin: 0 1px; }
.cite-n { padding: 0 3px; min-height: 0; border: 0; background: transparent; box-shadow: none; color: #c4153a; font: 400 12px/1.2 var(--pixel); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.cite-n:hover { background: var(--pink-xl) !important; }
@media print { .cite-n { color: #000; text-decoration: none; } }
</style>
