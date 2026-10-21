"""Latency & stop measurements on the live API: N ask generations, time to first delta (TTFT) and total, p50/p95.
Usage: python3 latency.py [api_base] [n] [out.json]"""
import json, statistics, sys, time, uuid, urllib.request, http.cookiejar
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8420/human/api'
N = int(sys.argv[2]) if len(sys.argv) > 2 else 30
OUT = sys.argv[3] if len(sys.argv) > 3 else 'latency.json'
Q = ['毛利率怎么算？', '成本加成率和毛利率有什么区别？', '首付款最低多少？', '交期要求是什么？', 'CIP 的保险要求是什么？', '最终方案要写清哪些条件？', '本案例的单位成本是多少？', 'Incoterms 2020 有几个术语？', '磋商时会看我哪些表现？', '费用写在 Incoterms 的哪一条？']
op = urllib.request.build_opener(urllib.request.ProxyHandler({} if '127.0.0.1' in BASE or 'localhost' in BASE else None), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
op.addheaders = [('User-Agent', 'Mozilla/5.0 latency-check')]
sid = json.loads(op.open(urllib.request.Request(BASE + '/sessions', data=b'{}', headers={'content-type': 'application/json'})).read())['id']
rows = []
for i in range(N):
    body = json.dumps({'requestId': str(uuid.uuid4()), 'intent': 'ask', 'text': Q[i % len(Q)]}).encode()
    t0 = time.time(); first = None; ok = False
    with op.open(urllib.request.Request(BASE + f'/sessions/{sid}/turns', data=body, headers={'content-type': 'application/json'}), timeout=60) as r:
        buf = b''
        while True:
            ch = r.read1(4096) if hasattr(r, 'read1') else r.read(4096)
            if not ch: break
            buf += ch
            if first is None and b'event: delta' in buf: first = time.time() - t0
            if b'event: done' in buf: ok = True
    rows.append({'i': i, 'q': Q[i % len(Q)], 'ttftMs': round(first * 1000) if first else None, 'totalMs': round((time.time() - t0) * 1000), 'ok': ok})
    print(rows[-1])
tt = sorted(r['ttftMs'] for r in rows if r['ttftMs']); tot = sorted(r['totalMs'] for r in rows)
pct = lambda a, p: a[min(len(a) - 1, int(round(p * (len(a) - 1))))]
summary = {'n': N, 'ok': sum(r['ok'] for r in rows), 'ttft_p50_ms': pct(tt, 0.5), 'ttft_p95_ms': pct(tt, 0.95), 'total_p50_ms': pct(tot, 0.5), 'total_p95_ms': pct(tot, 0.95), 'measuredAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'base': BASE}
print(summary)
json.dump({'summary': summary, 'rows': rows}, open(OUT, 'w'), ensure_ascii=False, indent=2)
