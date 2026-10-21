<script setup lang="ts">
// 中文打字气泡：“陈老师正在输入”+ 三个跳动的像素点（首页提示框同款节奏）。
defineProps<{ who: string }>()
</script>
<template>
  <span class="typing" role="status"><span>{{ who }}正在输入</span><i></i><i></i><i></i></span>
</template>
<style scoped>
.typing { display: inline-flex; align-items: center; gap: 4px; font: 400 13px/1 var(--pixel); color: var(--text-2); }
.typing span { margin-right: 4px; }
.typing i { width: 6px; height: 6px; background: var(--ink); animation: hop 1s steps(2, end) infinite; }
.typing i:nth-of-type(2) { animation-delay: .2s; } .typing i:nth-of-type(3) { animation-delay: .4s; }
@keyframes hop { 50% { transform: translateY(-4px); background: var(--pink); } }
</style>
