<script setup lang="ts">
// 学习报告 v2：一扇可打印的复古“文档窗口”。屏幕上有标题栏、硬投影和像素纹理；打印时全部去掉，只留黑白文档。
import { fmtAnswer } from '../lib/format'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../lib/api'
import { state, resumeSession, openCitation, openCitationNo } from '../lib/store'
import { buildRegistry, plain } from '../lib/cites'
import RichText from '../components/RichText.vue'
import CitationDrawer from '../components/CitationDrawer.vue'
import TypingBubble from '../components/TypingBubble.vue'
import type { Citation } from '../lib/api'

const router = useRouter()
const rep = ref<Record<string, any> | null>(null)
const err = ref('')
const none = ref(false)
async function load() {
  err.value = ''
  if (!state.session && !(await resumeSession())) { none.value = true; return }
  try { rep.value = await api.report(state.session!.id) } catch (e) { err.value = (e as Error).message }
}
onMounted(load)
const printIt = () => window.print()
const roleName = (r: string) => ({ student: '你', teacher: '陈老师', buyer: 'Markus Weber', system: '课堂' } as Record<string, string>)[r] ?? r
const stageName = (s: string) => ({ intro: '认识任务', explain: '概念讲解', practice: '情景练习', feedback: '反馈', retry: '复练', done: '完成' } as Record<string, string>)[s] ?? s
const fieldName: Record<string, string> = { unitPrice: '单价', quantity: '数量', deposit: '首付款', leadDays: '交期' }
const fmt = (s?: string) => (s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—')
const marginErrText: Record<string, string> = { none: '自算毛利率正确', 'used-markup': '把成本加成率当成了毛利率', wrong: '自算毛利率有误', 'not-provided': '没有填写自算毛利率' }
const transcript = computed(() => (rep.value?.transcript ?? []) as { turnId: string; role: string; stage: string; text: string; citations?: Citation[] }[])
const registry = computed(() => buildRegistry(transcript.value, rep.value?.citations ?? []))
const lineNo = (turnId?: string | null) => { const i = transcript.value.findIndex((t) => t.turnId === turnId); return i >= 0 ? i + 1 : null }
function openCite(c: Citation, n: number) { openCitationNo.value = n; openCitation.value = c }
const observed = computed(() => (rep.value?.feedback?.dimensions ? `${rep.value.feedback.dimensions.filter((d: any) => d.status === 'observed').length} / ${rep.value.feedback.dimensions.length}` : '—'))
</script>

<template>
  <main class="report sky-bg">
    <div class="tools no-print">
      <button class="px-btn" @click="router.push('/learn')">返回课堂</button>
      <button class="px-btn is-pink" @click="printIt" :disabled="!rep">打印 / 存为 PDF</button>
      <button class="px-btn" @click="load">刷新</button>
    </div>

    <section v-if="none" class="doc empty-doc">
      <header class="bar"><i class="sq"></i><span>学习报告</span><span class="rule" aria-hidden="true"></span></header>
      <div class="paper">
        <h1>还没有可以整理的课</h1>
        <p>上完一节课，陈老师会把对话、方案核算、建议和复练整理成一份报告。</p>
        <RouterLink to="/learn?start=1" class="px-btn is-pink">开始上课</RouterLink>
      </div>
    </section>
    <p v-if="err" class="pill red">{{ err }}</p>

    <article v-if="rep" class="doc">
      <header class="bar"><i class="sq"></i><span>学习报告 · {{ rep.course.unit }}</span><span class="rule" aria-hidden="true"></span><span class="pg no-print">1 / 1</span></header>
      <div class="paper">
        <div class="head">
          <span class="label pink">嘟囔课堂 · 学习报告</span>
          <h1>{{ rep.course.unit }}</h1>
          <p class="meta">生成于 {{ fmt(rep.generatedAt) }} · 开课于 {{ fmt(rep.session.createdAt) }} · 当前环节：{{ stageName(rep.session.stage) }}</p>
        </div>
        <div class="kpis">
          <div class="kpi"><b :class="rep.check?.agreement ? 'g' : rep.finalOffer ? 'r' : ''">{{ !rep.finalOffer ? '未提交' : rep.check?.agreement ? '达成' : '未达成' }}</b><span>练习目标</span></div>
          <div class="kpi"><b>{{ rep.check?.valid ? rep.check.grossMarginText : '—' }}</b><span>方案毛利率</span></div>
          <div class="kpi"><b>{{ observed }}</b><span>表达观察</span></div>
          <div class="kpi"><b :class="rep.retry?.result ? (rep.retry.result.correct ? 'g' : 'r') : ''">{{ rep.retry?.result ? (rep.retry.result.correct ? '正确' : '有错') : '未做' }}</b><span>针对复练</span></div>
        </div>
        <p class="note">本报告来自这节课的实际记录：每个数字都由系统算出，每条“观察到”都附你的原话。</p>
        <p v-if="rep.evidenceStatus === 'insufficient'" class="pill warn">这节课没有磋商对话，表达建议暂时无法给出。</p>

        <section class="sec">
          <h2><span class="no">01</span>最终方案与核算</h2>
          <p v-if="!rep.finalOffer" class="muted">还没有提交最终方案。</p>
          <template v-else>
            <p>单价 {{ (rep.finalOffer.unitPriceCents / 100).toFixed(2) }} 美元 · {{ rep.finalOffer.quantity }} 件 · 首付款 {{ rep.finalOffer.depositBasisPoints / 100 }}% · 交付 {{ rep.finalOffer.leadDays }} 天 <span class="muted small">（提交于 {{ fmt(rep.finalOffer.submittedAt) }}）</span></p>
            <template v-if="rep.check?.valid">
              <p>销售收入 {{ rep.check.revenue }} 美元；总成本 {{ rep.check.cost }} 美元；毛利 {{ rep.check.grossProfit }} 美元；毛利率 {{ rep.check.grossMarginText }}（成本加成率 {{ rep.check.costMarkupText }}）。</p>
              <p v-if="rep.studentMarginError" class="small">你填的毛利率：{{ rep.finalOffer.studentGrossMarginPercent ?? '未填' }}{{ rep.finalOffer.studentGrossMarginPercent !== null ? '%' : '' }} → {{ marginErrText[rep.studentMarginError] }}</p>
              <table class="t"><thead><tr><th>条件</th><th>卖方规则</th><th>卖方</th><th>模拟买家</th></tr></thead><tbody>
                <tr v-for="(c, i) in rep.check.seller.checks" :key="c.field"><td>{{ fieldName[c.field] }}</td><td>{{ c.rule }}</td><td>{{ c.ok ? '✓' : '✗' }}</td><td>{{ rep.check.buyer.checks[i].ok ? '✓' : '✗' }} <span class="muted">{{ rep.check.buyer.checks[i].rule }}</span></td></tr>
              </tbody></table>
              <p>符合卖方条件：<b>{{ rep.check.seller.pass ? '是' : '否' }}</b>；符合买家条件：<b>{{ rep.check.buyer.pass ? '是' : '否' }}</b>；达成本练习目标：<b>{{ rep.check.agreement ? '是' : '否' }}</b></p>
              <p class="small muted">买家的底线条件在练习时不公开，练习结束后在这里揭晓。</p>
            </template>
          </template>
        </section>

        <section class="sec">
          <h2><span class="no">02</span>表达建议</h2>
          <p v-if="!rep.feedback" class="muted">还没有反馈。</p>
          <p v-else-if="rep.feedback.status === 'pending'" class="muted"><TypingBubble who="陈老师" /> 建议正在生成，稍后点“刷新”。</p>
          <p v-else-if="rep.feedback.status === 'error'" class="pill red">建议暂时没写出来，方案核算不受影响。</p>
          <template v-else>
            <div v-for="d in rep.feedback.dimensions" :key="d.id" class="dim">
              <p><b>{{ d.name }}</b> <span class="pill" :class="d.status === 'observed' ? 'ok' : 'grey'">{{ d.status === 'observed' ? '观察到' : '未观察到' }}</span></p>
              <blockquote v-if="d.quote">“{{ d.quote }}”<span v-if="lineNo(d.turnId)" class="muted small"> —— 对话第 {{ lineNo(d.turnId) }} 句</span></blockquote>
              <p class="small">{{ plain(d.comment) }} 建议：{{ plain(d.suggestion) }}</p>
            </div>
            <p>{{ plain(rep.feedback.summary) }}</p>
            <p class="small muted">不给综合分数；每条“观察到”都是你在对话里的原话。</p>
          </template>
        </section>

        <section class="sec">
          <h2><span class="no">03</span>针对复练</h2>
          <p v-if="!rep.retry" class="muted">这节课没有做复练。</p>
          <template v-else>
            <p class="small">{{ plain(rep.retry.reason) }}</p>
            <p><b>题目：</b>{{ plain(rep.retry.question) }}</p>
            <p v-if="rep.retry.submission"><b>你的作答：</b>{{ fmtAnswer(rep.retry.submission) }}</p>
            <p v-if="rep.retry.result"><b>结果：</b>{{ rep.retry.result.correct ? '正确' : '有错误' }} —— {{ rep.retry.result.details.join(' ') }}</p>
            <p v-if="rep.retry.answer" class="small muted">参考答案：{{ fmtAnswer(rep.retry.answer) }}</p>
          </template>
        </section>

        <section class="sec">
          <h2><span class="no">04</span>引用过的资料</h2>
          <p v-if="!registry.length" class="muted">这节课没有引用资料。</p>
          <ol class="refs">
            <li v-for="(c, i) in registry" :key="c.id"><span class="n">[{{ i + 1 }}]</span><span><b>{{ c.title }}</b>（{{ c.sourceUrl ? '公开资料' : '本节案例条件' }}）<a v-if="c.sourceUrl" :href="c.sourceUrl" class="url">{{ c.sourceUrl }}</a></span></li>
          </ol>
        </section>

        <section class="sec">
          <h2><span class="no">05</span>完整对话</h2>
          <table class="t tr"><thead><tr><th>#</th><th>环节</th><th>说话人</th><th>内容</th></tr></thead><tbody>
            <tr v-for="(t, i) in transcript" :key="t.turnId"><td>{{ i + 1 }}</td><td>{{ stageName(t.stage) }}</td><td>{{ roleName(t.role) }}</td><td><RichText :text="t.text" :registry="registry" @open="openCite" /></td></tr>
          </tbody></table>
        </section>
        <footer class="docfoot">嘟囔 · 会说话的经管课堂 · 出口报价与交易磋商</footer>
      </div>
    </article>
    <CitationDrawer />
  </main>
</template>

<style scoped>
.report { padding: 18px 24px 64px; min-height: 70vh; }
.tools { max-width: 1000px; margin: 0 auto 18px; display: flex; gap: 10px; flex-wrap: wrap; }
.doc { max-width: 1000px; margin: 0 auto; background: var(--white); border: 1px solid var(--ink); box-shadow: var(--shadow-lg); animation: win-up .45s var(--ease) both; }
.bar { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; border-bottom: 1px solid var(--ink); background: var(--pink-xl); font: 400 13px/1 var(--pixel); color: var(--ink); white-space: nowrap; }
.bar .sq { width: 10px; height: 10px; background: var(--pink); flex: none; }
.bar .rule { flex: 1; height: 11px; background: repeating-linear-gradient(to bottom, var(--ink) 0 1px, transparent 1px 3px); }
.bar .pg { color: var(--text-2); }
.paper { padding: 34px clamp(18px, 5vw, 56px) 40px; display: grid; gap: 14px; }
.head h1 { font-size: clamp(32px, 4.6vw, 54px); margin: 6px 0 4px; }
.meta { margin: 0; color: var(--text-2); font-size: 13px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--ink); }
.kpi { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-right: 1px solid var(--ink); }
.kpi:last-child { border-right: 0; }
.kpi b { font: 400 30px/1.1 var(--serif); color: var(--ink); } .kpi span { font: 400 13px/1.2 var(--pixel); color: var(--text-2); }
.kpi b.g { color: var(--green-d); } .kpi b.r { color: var(--bad); }
.note { margin: 0; font-size: 13px; color: var(--muted); }
.sec { border-top: 1px solid var(--ink); padding-top: 18px; margin-top: 8px; }
.sec h2 { display: flex; align-items: baseline; gap: 12px; font-size: 26px; margin-bottom: 10px; }
.sec h2 .no { font: 400 13px/1 var(--pixel); color: var(--ink); background: var(--butter); border: 1px solid var(--ink); padding: 4px 6px; }
.sec p { margin: 6px 0; }
.t { width: 100%; border-collapse: collapse; border: 1px solid var(--ink); margin: 10px 0; font-size: 14px; table-layout: fixed; }
.t th { background: var(--paper); font: 400 13px/1.3 var(--pixel); text-align: left; }
.t th, .t td { border: 1px solid var(--hair); padding: 7px 9px; vertical-align: top; }
.tr th:nth-child(1), .tr td:nth-child(1) { width: 44px; } .tr th:nth-child(2) { width: 84px; } .tr th:nth-child(3) { width: 120px; }
.dim { padding: 10px 14px; border: 1px solid var(--ink); margin: 10px 0; }
blockquote { margin: 8px 0; padding: 8px 12px; background: var(--butter); border-left: 3px solid var(--ink); }
.refs { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.refs li { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 6px; }
.refs .n { font: 400 13px/1.6 var(--pixel); color: #c4153a; } .url { display: block; font-size: 12px; color: var(--text-2); }
.docfoot { border-top: 1px dashed var(--ink); padding-top: 12px; margin-top: 10px; font: 400 12px/1 var(--pixel); color: var(--muted); text-align: center; }
.empty-doc .paper { justify-items: start; }
@media (max-width: 720px) {
  .report { padding: 10px 8px 48px; }
  .doc { box-shadow: 4px 4px 0 var(--ink); }
  .kpis { grid-template-columns: 1fr 1fr; } .kpi:nth-child(2) { border-right: 0; } .kpi:nth-child(-n+2) { border-bottom: 1px solid var(--ink); }
  .kpi b { font-size: 24px; }
  .t { font-size: 13px; } .t th, .t td { padding: 5px 6px; }
  .tr th:nth-child(2), .tr td:nth-child(2) { display: none; } .tr th:nth-child(3) { width: 76px; } .tr th:nth-child(1) { width: 30px; }
  .sec h2 { font-size: 22px; }
}
@media print {
  .report { padding: 0; background: #fff !important; }
  .doc { border: 0; box-shadow: none; max-width: none; animation: none; }
  .bar { display: none; }
  .paper { padding: 0; }
  .kpis, .t, .dim, .sec { border-color: #000; }
  .sec h2 .no { background: #fff; }
  blockquote { background: #fff; border-left-color: #000; }
  .kpi b, .kpi b.g, .kpi b.r { color: #000; }
  .pill { background: #fff !important; }
  .sec, .dim, tr { break-inside: avoid; }
  a { color: #000; text-decoration: none; }
}
</style>
