<script setup lang="ts">
// 出处抽屉：桌面从右侧滑出，手机从底部升起。只显示序号与标题，不显示内部编号。
import { onBeforeUnmount, onMounted } from 'vue'
import { openCitation, openCitationNo } from '../lib/store'
const close = () => { openCitation.value = null }
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
<template>
  <div v-if="openCitation" class="scrim no-print" @click.self="close">
    <aside class="drawer" role="dialog" aria-modal="true" :aria-label="`出处 ${openCitationNo || ''}：${openCitation.title}`">
      <header class="bar"><span class="tag"><i></i>出处<template v-if="openCitationNo"> [{{ openCitationNo }}]</template></span><span class="rule" aria-hidden="true"></span><button class="box" @click="close" aria-label="关闭出处"><svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" /></svg></button></header>
      <div class="body">
        <span class="pill" :class="openCitation.sourceUrl ? 'ok' : 'amber'">{{ openCitation.sourceUrl ? '公开资料' : '本节案例条件' }}</span>
        <h3>{{ openCitation.title }}</h3>
        <p class="text">{{ openCitation.text }}</p>
        <blockquote v-if="openCitation.quote" lang="en">原文摘录：{{ openCitation.quote }}</blockquote>
        <p v-if="openCitation.sourceUrl" class="small"><a :href="openCitation.sourceUrl" target="_blank" rel="noopener">打开原始网页</a></p>
        <p v-else class="small muted">这是本节练习的案例条件，只在这次练习中适用。</p>
      </div>
    </aside>
  </div>
</template>
<style scoped>
.scrim { position: fixed; inset: 0; background: rgba(20, 2, 6, 0.32); display: flex; justify-content: flex-end; z-index: 2600; }
.drawer { width: min(460px, 100%); height: 100%; overflow-y: auto; background: var(--white); border-left: 1px solid var(--ink); box-shadow: -8px 0 0 0 var(--ink); animation: slide .3s var(--ease) both; display: flex; flex-direction: column; }
@keyframes slide { from { transform: translateX(48px); opacity: 0; } to { transform: none; opacity: 1; } }
.bar { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--ink); background: var(--mint); flex: none; }
.tag { display: inline-flex; align-items: center; gap: 7px; font: 400 13px/1 var(--pixel); color: var(--ink); white-space: nowrap; } .tag i { width: 10px; height: 10px; background: var(--green-d); }
.rule { flex: 1; height: 11px; background: repeating-linear-gradient(to bottom, var(--ink) 0 1px, transparent 1px 3px); }
.box { width: 22px; height: 22px; padding: 0; display: grid; place-items: center; background: var(--white); box-shadow: none; } .box svg { width: 10px; height: 10px; stroke: var(--ink); stroke-width: 1.4; }
.body { padding: 18px 20px 28px; display: grid; gap: 12px; align-content: start; }
.body h3 { margin: 0; font-size: 22px; }
.text { white-space: pre-wrap; margin: 0; } blockquote { margin: 0; padding: 8px 10px; background: var(--butter); border-left: 3px solid var(--ink); font-size: 13px; }
@media (max-width: 1099px) {
  .scrim { align-items: flex-end; }
  .drawer { width: 100%; height: auto; max-height: 72dvh; border-left: 0; border-top: 1px solid var(--ink); box-shadow: 0 -6px 0 0 var(--ink); animation: rise .32s var(--ease) both; }
  @keyframes rise { from { transform: translateY(60px); opacity: 0; } to { transform: none; opacity: 1; } }
}
</style>
