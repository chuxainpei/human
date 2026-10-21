import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tidyText, tidyDelta } from '../src/output-rules.js'
test('输出整形：去表情、加粗、标题、列表，保留引用标记', () => {
  const raw = '## 毛利率\n**毛利率** = 毛利 ÷ 销售收入 😀\n- 第一点 [F-QUOTE-01]\n1. 第二点\n\n[链接](https://x.com)'
  const out = tidyText(raw)
  assert.ok(!/[#*😀]/u.test(out)); assert.ok(out.includes('[F-QUOTE-01]')); assert.ok(!out.includes('https://')); assert.ok(!/^\s*[-\d]/m.test(out))
  assert.equal(tidyDelta('**好**🙂'), '好')
})
