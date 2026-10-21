// 打字轮播（首页标题与提示框同款）：逐字打出 → 停留 → 逐字删除 → 下一句。返回当前文字（可用作输入框占位符）。
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
export function useTyped(lines: Ref<string[]> | string[], o: { typeMs?: number; holdMs?: number; eraseMs?: number } = {}) {
  const text = ref('')
  const get = () => (Array.isArray(lines) ? lines : lines.value)
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  let timer: ReturnType<typeof setTimeout> | undefined, i = 0, k = 0, erasing = false
  const tick = () => {
    const arr = get(); if (!arr.length) { timer = setTimeout(tick, 500); return }
    const line = arr[i % arr.length]
    if (!erasing) {
      k++; text.value = line.slice(0, k)
      if (k >= line.length) { erasing = true; timer = setTimeout(tick, o.holdMs ?? 2200); return }
      timer = setTimeout(tick, (o.typeMs ?? 85) + Math.random() * 50)
    } else {
      k--; text.value = line.slice(0, k)
      if (k <= 0) { erasing = false; i++; timer = setTimeout(tick, 350); return }
      timer = setTimeout(tick, o.eraseMs ?? 35)
    }
  }
  onMounted(() => { if (reduced) text.value = get()[0] ?? ''; else tick() })
  onBeforeUnmount(() => clearTimeout(timer))
  return text
}
