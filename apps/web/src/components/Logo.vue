<script setup lang="ts">
// 嘟囔 像素标：7×7 网格拼出的对话气泡（带尾巴与三点“嘟囔声”），图形为自有设计。
withDefaults(defineProps<{ size?: number; word?: boolean; invert?: boolean }>(), { size: 22, word: true, invert: false })
const P = [
  '.#####.',
  '#.....#',
  '#.#.#.#',
  '#.....#',
  '.####.#',
  '.....##',
  '......#',
]
const cells: { x: number; y: number; dot: boolean }[] = []
P.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') cells.push({ x, y, dot: y === 2 && x > 0 && x < 6 }) }))
</script>
<template>
  <span class="logo" :class="{ invert }">
    <svg :width="size" :height="size" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
      <rect v-for="c in cells" :key="c.x + '-' + c.y" :x="c.x" :y="c.y" width="1" height="1" :class="c.dot ? 'dot' : 'ink'" />
    </svg>
    <b v-if="word">嘟囔</b>
  </span>
</template>
<style scoped>
.logo { display: inline-flex; align-items: center; gap: 8px; }
.ink { fill: var(--ink); } .dot { fill: var(--pink); }
.invert .ink { fill: #fff; }
b { font-family: var(--pixel); font-size: 24px; line-height: 1; letter-spacing: .04em; color: var(--ink); font-weight: 400; -webkit-font-smoothing: none; }
.invert b { color: #fff; }
</style>
