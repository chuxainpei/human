import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './styles.css'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: (to, _from, saved) => saved ?? (to.hash ? { el: to.hash, behavior: 'smooth' } : { top: 0 }),
  routes: [
    // 首页是静态页（dist/index.html），应用内跳到 / 时整页加载它，保留 #锚点
    { path: '/', component: () => import('./pages/EntryPage.vue'), beforeEnter: (to) => { window.location.assign(import.meta.env.BASE_URL + (to.hash || '')); return false } },
    { path: '/entry', component: () => import('./pages/EntryPage.vue'), meta: { title: '课程入口' } },
    { path: '/learn', component: () => import('./pages/LearnPage.vue'), meta: { title: '学习工作台' } },
    { path: '/report', component: () => import('./pages/ReportPage.vue'), meta: { title: '学习报告' } },
    { path: '/:p(.*)*', component: () => import('./pages/NotFoundPage.vue'), meta: { title: '找不到这一页' } },
  ],
})
router.afterEach((to) => { document.title = `${to.meta.title ?? ''} · 嘟囔` })
// 懒加载的页面块加载失败（如发布后旧页面）：转到友好的出错页
router.onError(() => { if (!location.pathname.endsWith('/oops')) router.replace({ path: '/oops', query: { e: '1' } }) })
// v-reveal：进入视口时上浮显现。
// 用法 v-reveal 或 v-reveal="120"（毫秒延迟，用于错落出现）。减少动态时直接显示。
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const io = 'IntersectionObserver' in window && !reduced
  ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io!.unobserve(e.target) } }), { rootMargin: '0px 0px -8% 0px' })
  : null
createApp(App).use(router).directive('reveal', {
  mounted(el: HTMLElement, b) { if (!io) return; el.classList.add('rv'); if (b.value) el.style.setProperty('--rd', b.value + 'ms'); io.observe(el) },
  unmounted(el: HTMLElement) { io?.unobserve(el) },
}).mount('#app')
