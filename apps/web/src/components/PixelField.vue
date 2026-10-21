<script setup lang="ts">
// 像素点阵装饰。
// 自研：随机挑选格子以 6s 周期淡入淡出；纯 CSS 动画，aria-hidden；减少动态时静止。
const props = withDefaults(defineProps<{ cols?: number; rows?: number; density?: number; colors?: string[] }>(), { cols: 28, rows: 10, density: 0.16, colors: () => ['#ff6183', '#ffb4c5', '#d0c9ed', '#38f261', '#ffda95'] })
let seed = 7
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const cells = Array.from({ length: props.cols * props.rows }, (_, n) => n).filter(() => rnd() < props.density)
  .map((n) => ({ n, x: n % props.cols, y: Math.floor(n / props.cols), c: props.colors[Math.floor(rnd() * props.colors.length)], d: (rnd() * 6).toFixed(2) }))
</script>
<template>
  <div class="px" aria-hidden="true" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }">
    <i v-for="c in cells" :key="c.n" :style="{ gridColumn: c.x + 1, gridRow: c.y + 1, background: c.c, animationDelay: `-${c.d}s` }"></i>
  </div>
</template>
<style scoped>
.px { position: absolute; inset: 0; display: grid; pointer-events: none; }
.px i { animation: fade 6s linear infinite; opacity: 0; }
@keyframes fade { 0%, 100% { opacity: 0; } 20%, 55% { opacity: .9; } 75% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .px i { animation: none; opacity: .5; } }
</style>
