import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCourse, publicCourse, retrieve } from '../src/content.js'
import { checkOffer, leaksHidden, parseOfferText, buyerLabels } from '../src/rules.js'
import { finalizeCitations, verifyDimensions, gradeRetry } from '../src/teach.js'
import { addTurn, SessionStore } from '../src/sessions.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const c = loadCourse(path.join(root, 'content/course.json'))
const k = c.cases[0]

test('fixture rule cases R1–R5 compute exactly', () => {
  for (const tc of k.serverOnly.testCases) {
    const r = checkOffer(tc.offer, k.studentVisible, k.serverOnly)
    assert.equal(r.valid, tc.expect.valid, tc.id)
    if (r.valid) {
      assert.equal(r.seller.pass, tc.expect.sellerPass, tc.id + ' seller')
      assert.equal(r.buyer.pass, tc.expect.buyerPass, tc.id + ' buyer')
      assert.equal(r.grossProfitCents, tc.expect.grossProfitCents, tc.id + ' gp')
    } else {
      assert.equal(r.error, tc.expect.error)
      assert.equal(r.grossMargin, null)
    }
  }
})

test('gross margin 20%, not markup 25%, for 12.50 / 10.00', () => {
  const r = checkOffer({ unitPriceCents: 1250, quantity: 500, depositBasisPoints: 3000, leadDays: 20 }, k.studentVisible, k.serverOnly)
  assert.ok(r.valid)
  if (r.valid) { assert.equal(r.grossMargin, 0.2); assert.equal(r.costMarkup, 0.25); assert.equal(r.grossProfitCents, 125000) }
})

test('boundaries: 18 and 21 days pass, 17 and 22 fail; deposit 30% passes, 29% fails', () => {
  const base = { unitPriceCents: 1250, quantity: 500, depositBasisPoints: 3000 }
  const ok = (o: object) => { const r = checkOffer({ ...base, leadDays: 20, ...o } as never, k.studentVisible, k.serverOnly); return r.valid && r.seller.pass }
  assert.equal(ok({ leadDays: 18 }), true); assert.equal(ok({ leadDays: 21 }), true)
  assert.equal(ok({ leadDays: 17 }), false); assert.equal(ok({ leadDays: 22 }), false)
  assert.equal(ok({ depositBasisPoints: 2900 }), false)
})

test('invalid input is rejected, not computed', () => {
  for (const o of [{ unitPriceCents: -1 }, { quantity: 0 }, { depositBasisPoints: 10001 }, { leadDays: 1.5 }]) {
    const r = checkOffer({ unitPriceCents: 1250, quantity: 500, depositBasisPoints: 3000, leadDays: 20, ...o }, k.studentVisible, k.serverOnly)
    assert.equal(r.valid, false)
  }
})

test('public course projection never contains hidden buyer constraints', () => {
  const j = JSON.stringify(publicCourse(c))
  assert.ok(!j.includes('serverOnly'))
  assert.ok(!j.includes('buyerMaximum'))
  assert.ok(!j.includes('1280') && !j.includes('12.80'))
  assert.ok(!j.includes('exampleFinalOffer') && !j.includes('rolePolicy'))
})

test('offer parser takes the latest non-cost price', () => {
  assert.equal(parseOfferText('我们单位成本是 10 美元，可以降到 12.8 美元').unitPriceCents, 1280)
  const o = parseOfferText('每件 13.5 美元，500 件，首付款 30%，20 天交货')
  assert.deepEqual(o, { unitPriceCents: 1350, depositBasisPoints: 3000, leadDays: 20, quantity: 500 })
})

test('buyer labels hide numbers; leak check catches threshold unless student said it', () => {
  const l = buyerLabels({ unitPriceCents: 1300 }, k.serverOnly)
  assert.equal(l.price, 'needs_change')
  assert.equal(leaksHidden('我们最多只能给 12.80 美元', k.serverOnly, k.studentVisible), true)
  assert.equal(leaksHidden('12.8 美元我们可以考虑', k.serverOnly, k.studentVisible, '我降到 12.8 美元'), false)
  assert.equal(leaksHidden('价格还是偏高', k.serverOnly, k.studentVisible), false)
})

test('forged citation ids are stripped; only retrieved facts are allowed', () => {
  const allowed = [c.facts.find((f) => f.id === 'F-QUOTE-01')!]
  const r = finalizeCitations(c, '毛利率是 (p-c)/p [F-QUOTE-01]，关税 10% [F-FAKE-99] [F-ICC-02]', allowed)
  assert.deepEqual(r.citations.map((x) => x.id), ['F-QUOTE-01'])
  assert.deepEqual(r.rejected.sort(), ['F-FAKE-99', 'F-ICC-02'])
  assert.ok(!r.text.includes('F-FAKE-99'))
  const ins = finalizeCitations(c, '材料不足：本单元没有关税资料 [F-QUOTE-01]', allowed)
  assert.equal(ins.insufficient, true); assert.equal(ins.citations.length, 0)
})

test('retrieval finds the right fact for paraphrases', () => {
  assert.equal(retrieve(c, '利润率和加价率差在哪')[0]?.fact.id, 'F-QUOTE-01')
  assert.ok(retrieve(c, '首付款最少要多少').some((h) => h.fact.id === 'F-TERMS-02'))
  assert.ok(retrieve(c, 'CIP 保险要求').some((h) => h.fact.id === 'F-ICC-02'))
})

test('feedback quotes are verified against the student turn; fabricated quotes become not_observed', () => {
  const store = new SessionStore(60_000, 10); const s = store.create(); s.stage = 'practice'
  const t = addTurn(s, { role: 'student', kind: 'negotiate', text: '我们成本 10 美元，报 12.5 美元，首付 30%' })
  const v = verifyDimensions({ dimensions: [
    { id: 'D1', status: 'observed', turnId: t.turnId, quote: '我们成本 10 美元' },
    { id: 'D2', status: 'observed', turnId: t.turnId, quote: '我理解您的顾虑' },
  ] }, s)
  assert.equal(v.dimensions[0].status, 'observed')
  assert.equal(v.dimensions[1].status, 'not_observed')
  assert.equal(v.dimensions[2].status, 'not_observed')
})

test('retry grading detects markup used as margin', () => {
  const r = { type: 'margin' as const, reason: '', question: '', createdAt: '', params: {}, answer: { grossProfitCents: 100000, grossMargin: 0.2, costMarkup: 0.25 } }
  const g = gradeRetry(r, { grossProfit: 1000, grossMarginPercent: 25 })
  assert.equal(g.correct, false)
  assert.ok(g.details.some((d) => d.includes('成本加成率')))
  assert.equal(gradeRetry(r, { grossProfit: 1000, grossMarginPercent: 20 }).correct, true)
})

test('session store requires owner cookie', () => {
  const store = new SessionStore(60_000, 10); const s = store.create()
  assert.equal(store.get(s.id, 'wrong'), null)
  assert.equal(store.get(s.id, undefined), null)
  assert.equal(store.get(s.id, s.owner)?.id, s.id)
})
