"""scripts/local/llm_score.py 단위 테스트(Ollama 없이 가짜 응답). 실행: python3 tests/test_llm_score.py
대상 선택, 기대값 계산, 중복 건너뛰기, 형식 오류·기대값 없음 처리, 원자적 쓰기, 기존 기사 파일 불변, 버전 분리, --merge 규칙, UTF-8·LF."""
import contextlib
import hashlib
import io
import json
import math
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'local'))
import llm_score as L  # noqa: E402

NOW = datetime.now(timezone.utc)
iso = lambda d: d.isoformat()


def lp(token, p):
    return {'token': token, 'logprob': math.log(p) if p > 0 else -99.0}


class Fake:
    """Ollama 가짜. 제목에 FORMAT → JSON 아님, NOLP → logprobs 없음(항상), NOLP1 → 첫 호출만 logprobs 없음, NET → 통신 오류."""
    def __init__(self):
        self.calls = []; self.seen = {}
    def version(self): return '0.30.8'
    def model_digest(self, m): return 'sha256:test' if m == L.MODEL else None
    def loaded(self): return []
    def unload(self, m): self.calls.append(('unload', m))
    def chat(self, body):
        title = body['messages'][1]['content']
        self.calls.append(('chat', title)); n = self.seen[title] = self.seen.get(title, 0) + 1
        if 'NET' in title: raise L.OllamaError('down')
        if 'FORMAT' in title: return {'message': {'content': 'not json'}, 'prompt_eval_count': 400}
        content = json.dumps({'score': 3})
        if 'NOLP' in title and not ('NOLP1' in title and n > 1):
            return {'message': {'content': content}}
        toks = [{'token': '{"', 'logprob': 0, 'top_logprobs': []},
                {'token': '3', 'logprob': math.log(0.7), 'top_logprobs': [lp('3', 0.7), lp('4', 0.2), lp('2', 0.1), lp('34', 0.5), lp('x', 0.3)]},
                {'token': '}', 'logprob': 0, 'top_logprobs': []}]
        return {'message': {'content': content}, 'logprobs': toks, 'prompt_eval_count': 30, 'prompt_eval_duration': 1e6, 'load_duration': 0}


def art(i, title, days_ago=0.5, relevant=True, source='한국경제'):
    a = {'id': i, 'title': title, 'source': source, 'collected_at': iso(NOW - timedelta(days=days_ago)), 'published_at': iso(NOW - timedelta(days=days_ago))}
    if relevant is not None: a['relevant'] = relevant
    return a


def make_root(td: Path) -> Path:
    m = NOW.strftime('%Y-%m'); old = (NOW - timedelta(days=40)).strftime('%Y-%m')
    for ch, arts in {'insurance': {m: [art('i1', '보험사 실적 발표'), art('i2', '숨김 기사', relevant=False), art('i3', '오래된 기사', days_ago=10),
                                       art('i4', 'FORMAT 이상한 응답'), art('i5', 'NOLP 확률 없음'), art('i6', 'NOLP1 한 번만 없음'), art('i7', '관련 필드 없음', relevant=None)],
                                   old: [art('i9', '지난달 기사', days_ago=40)]},
                     'ai': {m: [art('a1', 'New model released', source='Ars Technica')]}}.items():
        for month, rows in arts.items():
            p = td / 'data' / ch / f'{month}.json'; p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    return td


def tree_hash(root: Path) -> dict:
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*.json')) if '/llm/' not in p.as_posix()}


quiet = lambda: contextlib.redirect_stdout(io.StringIO())
P = L.load_prompts()
M = NOW.strftime('%Y-%m')

# ───── 프롬프트 설정 ─────
assert set(P) >= {'insurance', 'ai', 'finance'}
for ch in ('insurance', 'ai'):
    c = P[ch]
    assert c['prompt_version'] == 'v1-e2ev' and c['provisional'] is False and len(c['examples']) == 8
    assert all(e['score'] == {0: 0, 1: 1, 2: 3, 3: 5}[e['label']] for e in c['examples']), '매핑 0·1·2·3 → 0·1·3·5'
    s = L.system_prompt(c)
    assert s.startswith('너는 뉴스 큐레이터다.') and '예시(사람이 매긴 점수)' in s
assert P['finance']['provisional'] is True and P['finance']['examples'] == [] and '예시' not in L.system_prompt(P['finance'])
b = L.chat_body(P['insurance'], {'title': '제목X', 'source': '매체Y'})
assert b['messages'][0]['content'] == L.system_prompt(P['insurance']), '고정 부분이 맨 앞'
assert b['messages'][-1]['content'] == '제목: 제목X\n매체: 매체Y', '기사 제목은 맨 뒤'
assert b['options']['temperature'] == 0 and b['logprobs'] is True and b['format']['properties']['score']['enum'] == [0, 1, 2, 3, 4, 5]

# ───── 기대값: 첫 숫자 토큰 자리의 한 자리 0~5 후보만 정규화 ─────
s, ev, probs = L.parse_response(Fake().chat(L.chat_body(P['ai'], {'title': 't', 'source': 's'})))
assert s == 3 and abs(ev - (3 * 0.7 + 4 * 0.2 + 2 * 0.1)) < 1e-9, ev
assert set(probs) == {2, 3, 4} and abs(sum(probs.values()) - 1) < 1e-9
assert L.parse_response({'message': {'content': '{"score": 3}'}}) == (3, None, None), 'logprobs 없음'
assert L.parse_response({'message': {'content': '{"score": 9}'}})[0] is None, '범위 밖'
assert L.parse_response({'message': {'content': '{"score": true}'}})[0] is None
assert L.parse_response({'message': {'content': '[1]'}})[0] is None
assert L.parse_response({'message': {'content': '{"score": 1}'}, 'logprobs': [{'token': ' 1', 'top_logprobs': [lp(' 1', 0.5), lp('0', 0.5)]}]})[1] == 0.5, '앞뒤 공백 토큰'

# ───── 주소: OLLAMA_HOST 만 ─────
assert L.ollama_base('') == 'http://localhost:11434' and L.ollama_base('0.0.0.0') == 'http://localhost:11434'
assert L.ollama_base('127.0.0.1:11435') == 'http://127.0.0.1:11435' and L.ollama_base('https://box:1/') == 'https://box:1'

with tempfile.TemporaryDirectory() as td:
    root = make_root(Path(td) / 'repo'); before = tree_hash(root)
    since = NOW - timedelta(days=3)

    # ───── 대상 선택: 관련(필드 없으면 관련)·기간·채널 묶음 ─────
    t = L.select_targets(root, P, ['insurance', 'ai'], since)
    ids = [a['id'] for _, _, a in t]
    assert set(ids) == {'i1', 'i4', 'i5', 'i6', 'i7', 'a1'}, ids
    assert [c for c, _, _ in t] == sorted([c for c, _, _ in t], key=['insurance', 'ai'].index), '같은 채널끼리 연속'
    assert {a['id'] for _, _, a in L.select_targets(root, P, ['insurance'], NOW - timedelta(days=60))} >= {'i3', 'i9'}

    # ───── 드라이런(CLI): 샘플만 채점, 아무것도 쓰지 않음 ─────
    f = Fake()
    with quiet():
        assert L.main(['--channel', 'insurance,ai'], root=root, client=f) == 0
    assert not list(root.rglob('llm')), '드라이런은 llm 폴더를 만들지 않음'
    assert any(c[0] == 'chat' for c in f.calls) and ('unload', L.MODEL) in f.calls, '샘플 채점 후 API 로 내림'
    f = Fake()
    with quiet():
        L.main(['--sample', '0'], root=root, client=f)
    assert not f.calls, '--sample 0 은 모델 호출 없음'

    # ───── --apply: 저장·상태별 처리·기존 파일 불변 ─────
    f = Fake()
    with quiet():
        rc = L.main(['--apply', '--channel', 'insurance,ai'], root=root, client=f)
    assert rc == 1, '형식 오류가 있으면 종료 코드 1'
    assert tree_hash(root) == before, '기사 파일(data/<채널>/YYYY-MM.json)은 바이트 그대로'
    store = json.loads((root / 'data' / 'insurance' / 'llm' / f'{M}.json').read_text(encoding='utf-8'))
    assert set(store) == {'i1', 'i5', 'i6', 'i7'}, store.keys()   # i4(형식 오류)는 저장 안 함
    r = store['i1'][0]
    assert r['score_ev'] == round(3 * 0.7 + 4 * 0.2 + 2 * 0.1, 3) and r['score_int'] == 3
    assert {k: r[k] for k in ('model', 'model_digest', 'ollama_version', 'prompt_version', 'provisional')} == \
        {'model': L.MODEL, 'model_digest': 'sha256:test', 'ollama_version': '0.30.8', 'prompt_version': 'v1-e2ev', 'provisional': False}
    assert r['scored_at'].endswith('Z')
    assert 'score_ev' not in store['i5'][0] and store['i5'][0]['score_int'] == 3, '기대값 못 구하면 정수만'
    assert f.seen['제목: NOLP 확률 없음\n매체: 한국경제'] == 2, '기대값 없음은 한 번 재시도'
    assert f.seen['제목: FORMAT 이상한 응답\n매체: 한국경제'] == 1, '형식 오류는 재시도하지 않고 건너뜀'
    assert 'score_ev' in store['i6'][0], '재시도에서 기대값을 얻으면 정상'
    assert json.loads((root / 'data' / 'ai' / 'llm' / f'{M}.json').read_text(encoding='utf-8'))['a1'][0]['prompt_version'] == 'v1-e2ev'

    # ───── 중복 건너뛰기: 같은 (id, model, prompt_version) 은 다시 계산 안 함 ─────
    left = {a['id'] for _, _, a in L.select_targets(root, P, ['insurance', 'ai'], since)}
    assert left == {'i4'}, left
    f2 = Fake()
    with quiet():
        L.main(['--apply', '--channel', 'insurance,ai'], root=root, client=f2)
    assert [c for c in f2.calls if c[0] == 'chat'] == [('chat', '제목: FORMAT 이상한 응답\n매체: 한국경제')]

    # ───── 버전 분리: 프롬프트 버전이 바뀌면 덧붙임(덮어쓰기 없음) ─────
    P2 = json.loads(json.dumps(P)); P2['insurance']['prompt_version'] = 'v2-test'
    t2 = L.select_targets(root, P2, ['insurance'], since)
    assert {a['id'] for _, _, a in t2} == {'i1', 'i4', 'i5', 'i6', 'i7'}
    with quiet():
        L.run_scoring(root, Fake(), P2, t2, L.MODEL, apply=True, log=lambda *_: None)
    store = json.loads((root / 'data' / 'insurance' / 'llm' / f'{M}.json').read_text(encoding='utf-8'))
    assert [x['prompt_version'] for x in store['i1']] == ['v1-e2ev', 'v2-test'], store['i1']
    assert L.add_record(store, 'i1', dict(store['i1'][0], score_int=0)) is False and store['i1'][0]['score_int'] == 3

    # ───── 원자적 쓰기: 실패하면 기존 파일 그대로, 임시 파일 남지 않음 ─────
    p = root / 'data' / 'insurance' / 'llm' / f'{M}.json'; raw = p.read_bytes()
    orig = L.os.replace
    L.os.replace = lambda *a: (_ for _ in ()).throw(OSError('disk full'))
    try:
        L.write_json_atomic(p, {'x': [1]}); raise AssertionError('should fail')
    except OSError:
        pass
    finally:
        L.os.replace = orig
    assert p.read_bytes() == raw and not [x for x in p.parent.iterdir() if x.name.endswith('.tmp')]

    # ───── UTF-8·LF: 한글 그대로(ensure_ascii=False), CRLF 없음 ─────
    q = root / 'data' / 'insurance' / 'llm' / 'utf8-test.json'
    L.write_json_atomic(q, {'가': [{'메모': '한글 보존'}]})
    bts = q.read_bytes()
    assert '한글 보존'.encode('utf-8') in bts and b'\r\n' not in bts and bts.endswith(b'\n')
    q.unlink()
    assert tree_hash(root) == before

    # ───── --merge: 새 것만 더하고 같은 (id, model, prompt_version) 은 기존 유지 ─────
    other = Path(td) / 'other.json'
    other.write_text(json.dumps({
        'i1': [dict(store['i1'][0], score_int=0, score_ev=0.5),                     # 같은 버전 → 기존 유지
               dict(store['i1'][0], model='other-model:1b', score_ev=4.25)],         # 다른 모델 → 추가
        'i3': [dict(store['i1'][0], scored_at='2026-01-01T00:00:00Z')],              # 아직 점수 없음 → 추가
        'i9': [dict(store['i1'][0])],                                                # 지난달 기사 → 그 달 파일로
        'zz': [dict(store['i1'][0])],                                                # 모르는 id
        'i7': [{'model': 'm', 'prompt_version': 'v', 'score_int': 9}],               # 잘못된 기록
    }, ensure_ascii=False), encoding='utf-8')
    snap = {x: x.read_bytes() for x in root.rglob('llm/*.json')}
    s = L.merge(root, [other], apply=False)
    assert (s['added'], s['kept_existing'], s['unknown_id'], s['invalid']) == (3, 1, 1, 1), s
    assert {x: x.read_bytes() for x in root.rglob('llm/*.json')} == snap, '합치기 드라이런은 쓰지 않음'
    with quiet():
        assert L.main(['--merge', str(other), '--apply'], root=root, client=Fake()) == 0
    store = json.loads(p.read_text(encoding='utf-8'))
    assert store['i1'][0]['score_int'] == 3 and store['i1'][0]['score_ev'] != 0.5, '기존 값 유지'
    assert [x['model'] for x in store['i1']] == [L.MODEL, L.MODEL, 'other-model:1b']
    assert 'i3' in store
    old = (NOW - timedelta(days=40)).strftime('%Y-%m')
    assert 'i9' in json.loads((root / 'data' / 'insurance' / 'llm' / f'{old}.json').read_text(encoding='utf-8')), '기사 월 파일 기준'
    s = L.merge(root, [other], apply=True)
    assert s['added'] == 0 and s['kept_existing'] == 4, '두 번 합쳐도 변화 없음'
    assert tree_hash(root) == before, '합치기도 기사 파일은 그대로'

    # ───── 벤치마크: 저장 없음, 첫 건 따로, 대조군(채널 프롬프트 번갈아) ─────
    snap = {x: x.read_bytes() for x in root.rglob('llm/*.json')}
    out = io.StringIO(); f = Fake()
    with contextlib.redirect_stdout(out):
        assert L.main(['--benchmark', '3', '--since', '60'], root=root, client=f) == 0
    txt = out.getvalue()
    assert '첫 건' in txt and '하루 600건 예상' in txt and '앞부분 재사용' in txt, txt
    assert {x: x.read_bytes() for x in root.rglob('llm/*.json')} == snap and tree_hash(root) == before

# ───── 통신 오류: 한 번 재시도 후 건너뜀 ─────
f = Fake()
assert L.score_one(f, P['ai'], {'title': 'NET', 'source': 's'})[2] == 'error' and f.seen['제목: NET\n매체: s'] == 2

# ───── 이식성: 셸 명령·하드코딩 경로 없음 ─────
src = (ROOT / 'scripts' / 'local' / 'llm_score.py').read_text(encoding='utf-8')
for bad in ('caffeinate', "'bash'", 'shell=True', 'ollama stop', '/Users/', 'C:\\\\'):
    assert bad not in src, bad
print('llm_score tests passed')
