<script setup lang="ts">
// 外壳：粉色公告条 + 两组带硬投影的分段导航 + 页脚（标签页签分栏、满幅粉色像素带、像素大字标、扫雷彩蛋）——品牌为“嘟囔”。
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { state } from './lib/store'
import PixelField from './components/PixelField.vue'
import Win from './components/Win.vue'
import Minesweeper from './components/Minesweeper.vue'
import Logo from './components/Logo.vue'
const route = useRoute()
const showNote = ref(true)
const inClass = computed(() => !!state.session)
const home = import.meta.env.BASE_URL
const focus = computed(() => route.path === '/learn')
</script>
<template>
  <div v-if="showNote && !focus" class="announce no-print" role="note">
    <b>全新：</b>嘟囔·陈老师上线——能讲、能答、能陪你谈判的经管课老师。<RouterLink to="/learn?start=1" class="more">去试课</RouterLink>
    <button class="x" aria-label="关闭公告" @click="showNote = false"><svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" /></svg></button>
  </div>
  <header class="nav no-print" :class="{ 'is-focus': focus }">
    <nav class="seg" aria-label="主导航">
      <a :href="home + ''" class="brand" aria-label="嘟囔 首页"><Logo :size="21" /></a>
      <a :href="home + '#abilities'" class="hide-m"><span class="sq"></span>产品</a>
      <a :href="home + '#scenes'" class="hide-m"><span class="sq"></span>课堂</a>
      <a :href="home + '#methods'" class="hide-m"><span class="sq"></span>学法</a>
      <a :href="home + '#vision'" class="hide-m">理念</a>
      <RouterLink v-if="inClass && !focus" to="/learn"><span class="sq"></span>回到课堂</RouterLink>
    </nav>
    <nav class="seg" aria-label="快捷入口">
      <RouterLink v-if="inClass && route.path !== '/report'" to="/report" class="hide-m">学习报告</RouterLink>
      <RouterLink v-if="!focus" to="/learn?start=1" class="hot">开始上课</RouterLink>
      <a v-else :href="home" class="hot">课程首页</a>
    </nav>
  </header>
  <RouterView />
  <footer v-if="!focus" class="sitefoot no-print">
    <div class="cols5">
      <div class="fc"><span class="ft"><i></i>课堂</span><RouterLink to="/learn?start=1">开始上课</RouterLink><RouterLink v-if="inClass" to="/report">学习报告</RouterLink><RouterLink to="/entry">课程入口</RouterLink><span>出口报价与交易磋商</span></div>
      <div class="fc"><span class="ft"><i></i>了解嘟囔</span><a :href="home + '#anatomy'">陈老师的构成</a><a :href="home + '#abilities'">课堂能力</a><a :href="home + '#vision'">我们的想法</a></div>
      <div class="fc"><span class="ft"><i></i>学法</span><span>概念讲解</span><span>有出处的答疑</span><span>情景谈判</span><span>反馈与复练</span></div>
    </div>
    <div class="band">
      <PixelField :cols="56" :rows="10" :density="0.2" :colors="['#ffffff', '#ffb4c5', '#ff8ba6', '#ffe3ea']" />
      <div class="word"><Logo :size="88" :word="false" invert /><span>嘟囔</span></div>
      <div class="msw"><Win label="扫雷 · 彩蛋" tone="ink" minimizable lift><Minesweeper /></Win></div>
    </div>
    <p class="copy">© 2026 嘟囔</p>
  </footer>
</template>
<style scoped>
.announce { position: relative; }
@media (max-width: 1099px) { .nav.is-focus { position: relative; } }
.more { margin-left: 6px; font-weight: 600; }
.x { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; padding: 0; display: grid; place-items: center; background: transparent; border: 1px solid var(--ink); }
.x svg { width: 10px; height: 10px; stroke: var(--ink); stroke-width: 1.4; }
.router-link-exact-active:not(.brand):not(.hot) { background: var(--paper-2); }
.sitefoot { border-top: 1px solid var(--line); background: var(--white); }
.cols5 { display: grid; grid-template-columns: repeat(3, 1fr); }
.fc { display: grid; align-content: start; gap: 6px; padding: 0 18px 24px; border-right: 1px solid var(--line); font-size: 13px; color: var(--text-2); }
.fc:last-child { border-right: 0; }
.fc a { color: var(--text); text-decoration: none; } .fc a:hover { text-decoration: underline; }
.ft { justify-self: start; display: inline-flex; align-items: center; gap: 8px; margin: 0 0 10px -18px; padding: 5px 12px; background: var(--ink); color: #fff; font-family: var(--pixel); font-size: 12px; }
.ft i { width: 9px; height: 9px; background: #fff; }
.band { position: relative; background: var(--pink); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); min-height: 320px; overflow: hidden; display: flex; align-items: flex-end; }
.word { position: relative; display: flex; align-items: center; gap: 22px; padding: 0 28px 24px; }
.word span { font-family: var(--pixel); font-size: clamp(96px, 14vw, 192px); line-height: 1; color: #fff; -webkit-font-smoothing: none; text-shadow: 6px 6px 0 var(--ink); }
.msw { position: absolute; right: 28px; top: 24px; width: 262px; }
.copy { margin: 0; padding: 12px 18px; font-family: var(--pixel); font-size: 12px; color: var(--muted); text-align: center; }
@media (max-width: 760px) {
  .cols5 { grid-template-columns: 1fr 1fr; } .fc { border-bottom: 1px solid var(--line); } .fc:nth-child(2n) { border-right: 0; }
  .band { flex-direction: column; align-items: stretch; min-height: 0; } .msw { position: relative; right: auto; top: auto; width: auto; margin: 18px; } .word { padding: 0 16px 18px; } .word span { font-size: 96px; }
}
</style>
