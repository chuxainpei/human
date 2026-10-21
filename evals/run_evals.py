"""Run the frozen 30-case eval against a live API (real model). Usage: python3 run_evals.py [api_base] [out.json]
Each ask case runs in a fresh session; follow-ups replay their parent first. Results are judged automatically where
possible (citations, '材料不足', numbers, leaks) and flagged for the human semantic check recorded in evals/results-*.md."""
import json, sys, time, uuid, urllib.request, http.cookiejar, pathlib

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8420/human/api'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'evals/results.json'
cases = json.load(open(pathlib.Path(__file__).parent / 'cases.json'))['cases']


class Client:
    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def call(self, method, path, body=None):
        req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
        t0 = time.time()
        try:
            with self.op.open(req, timeout=90) as r: raw, st, ct = r.read().decode(), r.status, r.headers.get('content-type', '')
        except urllib.error.HTTPError as e: raw, st, ct = e.read().decode(), e.code, 'application/json'
        dt = round(time.time() - t0, 2)
        if 'event-stream' in ct:
            first = None; done = None; err = None
            for blk in raw.split('\n\n'):
                if not blk.strip(): continue
                ev = blk.split('\n')[0][7:]; d = json.loads(blk.split('\n')[1][6:])
                if ev == 'done': done = d
                if ev == 'error': err = d
            return {'status': st, 'done': done, 'error': err, 'sec': dt}
        try: return {'status': st, 'json': json.loads(raw), 'sec': dt}
        except Exception: return {'status': st, 'text': raw, 'sec': dt}
    def session(self): return self.call('POST', '/sessions', {})['json']['id']
    def ask(self, sid, q): return self.call('POST', f'/sessions/{sid}/turns', {'requestId': str(uuid.uuid4()), 'intent': 'ask', 'text': q})


results = []
for c in cases:
    cl = Client(); sid = cl.session(); r = {'id': c['id'], 'category': c['category'], 'question': c['question'], 'expected': c['expected']}
    if c['category'] in ('material-basic', 'paraphrase-followup', 'out-of-scope') or c.get('mode') == 'ask':
        if c.get('followUpOf'): cl.ask(sid, c['followUpOf'])
        res = cl.ask(sid, c['question']); d = res['done'] or {}
        cites = [x['id'] for x in d.get('citations', [])]
        r.update(answer=d.get('text'), citations=cites, insufficient=d.get('insufficient'), rejectedCitations=d.get('rejectedCitations'), error=res['error'], sec=res['sec'])
        if c['category'] == 'out-of-scope': r['auto'] = 'pass' if d.get('insufficient') and not cites else 'check'
        elif c.get('mode') == 'ask': r['auto'] = 'pass' if d.get('text') and '12.80' not in d['text'] and '1280' not in d['text'] and 'serverOnly' not in d['text'] else 'fail'
        else: r['auto'] = 'pass' if cites and set(cites) & set(c['expectedFacts']) and not d.get('insufficient') else 'check'
    elif c['category'] == 'rules':
        cl.call('POST', f'/sessions/{sid}/actions', {'action': 'startPractice'})
        res = cl.call('POST', f'/sessions/{sid}/final-offer', c['offer']); j = res.get('json', {})
        e = c['expected']; ok = True
        if e['valid']:
            ch = j.get('check', {})
            ok = ch.get('valid') and ch['seller']['pass'] == e['sellerPass'] and ch['buyer']['pass'] == e['buyerPass'] and ch['grossProfit'] == e['grossProfit'] and (e.get('grossMargin') in (None, ch.get('grossMarginText')))
        else: ok = res['status'] == 400 and j.get('error') == e['error']
        r.update(response=j, status=res['status'], auto='pass' if ok else 'fail')
    elif c.get('mode') == 'negotiate':
        cl.call('POST', f'/sessions/{sid}/actions', {'action': 'startPractice'})
        res = cl.call('POST', f'/sessions/{sid}/turns', {'requestId': str(uuid.uuid4()), 'intent': 'negotiate', 'text': c['question'].split('）', 1)[-1]})
        d = res['done'] or {}; t = d.get('text', '')
        bad = any(x in t for x in ['12.80', '12.8', '1280']) or '我是老师' in t or '我是助教' in t
        r.update(answer=t, regenerated=d.get('regenerated'), ruleBased=d.get('ruleBased'), auto='fail' if bad or not t else 'pass')
    elif c.get('mode') == 'isolation':
        other = Client()
        res = other.call('GET', f'/sessions/{sid}/report')
        r.update(status=res['status'], auto='pass' if res['status'] == 404 else 'fail')
    results.append(r); print(r['id'], r['category'], r.get('auto'), (r.get('answer') or '')[:70].replace('\n', ' '), r.get('citations', ''))
json.dump({'base': BASE, 'ranAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'results': results}, open(OUT, 'w'), ensure_ascii=False, indent=2)
print('auto pass', sum(r.get('auto') == 'pass' for r in results), '/', len(results))
