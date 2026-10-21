// 把复练答案/作答对象写成中文可读文本（不再直接显示 JSON）。
const LABEL: Record<string, string> = { grossProfit: '毛利', grossMargin: '毛利率', grossMarginPercent: '毛利率', costMarkup: '成本加成率', failing: '不满足的条件', explanation: '文字解释' }
const FIELD: Record<string, string> = { price: '单价', unitPriceCents: '单价', deposit: '首付款', depositBasisPoints: '首付款', leadDays: '交期', quantity: '数量' }
export function fmtAnswer(v: unknown): string {
  if (!v || typeof v !== 'object') return String(v ?? '')
  return Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && x !== null && x !== '')
    .map(([k, x]) => {
      const val = Array.isArray(x) ? (x.length ? x.map((f) => FIELD[String(f)] ?? String(f)).join('、') : '无（全部满足）') : String(x)
      const unit = k === 'grossMarginPercent' && !/%$/.test(val) ? '%' : k === 'grossProfit' && /^\d/.test(val) ? ' 美元' : ''
      return `${LABEL[k] ?? k}：${val}${unit}`
    }).join('；')
}
