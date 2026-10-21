<script setup lang="ts">
// 404 / 出错页：同一套复古窗口语言，给出回到首页、继续上课两条路。
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Win from '../components/Win.vue'
import PixelField from '../components/PixelField.vue'
import { state } from '../lib/store'
const route = useRoute()
const base = import.meta.env.BASE_URL
const isErr = computed(() => route.query.e === '1')
</script>
<template>
  <main class="nf sky-bg">
    <PixelField :cols="60" :rows="14" :density="0.05" :colors="['#ffffff', '#ffb4c5', '#d0c9ed', '#d8edff']" />
    <div class="nf__in">
      <Win :label="isErr ? '出了点小状况' : '找不到这一页'" tone="pink" lift enter closable minimizable @close="$router.push('/entry')">
        <div class="body">
          <div class="code" aria-hidden="true">{{ isErr ? '出错' : '404' }}</div>
          <h1>{{ isErr ? '这一步没走通' : '这一页不在课表上' }}</h1>
          <p>{{ isErr ? '刷新一下通常就好了；你的课还在，回到课堂可以接着上。' : '可能是链接写错了，或者这一页已经换了地方。陈老师还在讲台上等你。' }}</p>
          <div class="btns">
            <RouterLink v-if="state.session" to="/learn" class="px-btn is-pink">回到课堂</RouterLink>
            <RouterLink v-else to="/learn?start=1" class="px-btn is-pink">开始上课</RouterLink>
            <a class="px-btn" :href="base">回到首页</a>
          </div>
        </div>
      </Win>
    </div>
  </main>
</template>
<style scoped>
.nf { position: relative; min-height: 72vh; display: grid; place-items: center; padding: 48px 16px; overflow: hidden; border-bottom: 1px solid var(--line); }
.nf__in { position: relative; width: min(560px, 100%); }
.body { display: grid; gap: 12px; justify-items: start; padding: 8px 4px; }
.code { font: 400 clamp(64px, 12vw, 120px)/1 var(--pixel); color: var(--pink); text-shadow: 4px 4px 0 var(--ink); -webkit-font-smoothing: none; }
h1 { font-size: clamp(26px, 4vw, 36px); margin: 0; }
p { margin: 0; }
.btns { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
</style>
