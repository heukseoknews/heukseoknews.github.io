"""학습 중요도(★) 점검 — 조사 전용(점수 로직을 수정하지 않는다).

[주의] 2026-11-05 점검 시점(점수 산식 변경 전)의 classify.py/categories.json 기준이다.
이후 점수 산식이 config/score.json 으로 옮겨져 이 스크립트는 그대로 실행되지 않을 수 있다(기록용).

  python scripts/audit/score_audit.py > docs/score-audit.md

collector/classify.py 의 규칙·매처를 읽기 전용으로 불러 저장된 기사(data/*.json)의 점수 근거를 다시 계산한다.
계산 결과가 저장된 score/category 와 같은지 먼저 검증하고(불일치 건수 보고), 분포·샘플·오판 의심 사례·개선안 시뮬레이션을 마크다운으로 출력한다.
"""
import difflib, glob, json, random, re, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'collector'))
from classify import _squash, load  # noqa: E402  (읽기 전용)

cl = load()
ARTICLES = [x for f in sorted(glob.glob(str(ROOT / 'data' / '????-??.json'))) for x in json.loads(Path(f).read_text(encoding='utf-8'))]


def explain(a: dict) -> dict:
    """classify.py 와 같은 절차로 카테고리별 점수·매칭 키워드를 재계산한다."""
    title, feed = a['title'], a.get('feed_name')
    text, sq = title.casefold(), _squash(title)
    scores, hits = {}, {}
    for cat, items in cl.rules.items():
        found = [(mt, w, mt.find(text, sq)) for mt, w in items]
        found = [f for f in found if f[2] >= 0]
        kept = []
        for mt, w, pos in found:
            if any(o is not mt and _squash(mt.keyword) != _squash(o.keyword) and _squash(mt.keyword) in _squash(o.keyword) for o, _, _ in found):
                continue
            kept.append((mt.keyword, w))
        if kept:
            scores[cat] = sum(w for _, w in kept)
            hits[cat] = kept
    res = cl.classify(title, feed)
    cat = res['category']
    top = max(scores.values()) if scores else 0
    imp = [m.keyword for m in cl.important if m.find(text, sq) >= 0]
    low = [m.keyword for m in cl.low if m.find(text, sq) >= 0]
    return {'category': cat, 'score': res['score'], 'top': top, 'hits': hits.get(cat, []) if cat in hits else [], 'imp': imp, 'low': low,
            'all_cat_scores': scores}


def md(s: str, n=58) -> str:
    s = re.sub(r'\s+', ' ', s).replace('|', '／')
    return s if len(s) <= n else s[:n - 1] + '…'


def kw(hits):
    return ', '.join(f'{k}({w})' for k, w in hits) or '—'


for a in ARTICLES:
    a['_e'] = explain(a)
mismatch = [a for a in ARTICLES if a['_e']['score'] != a['score'] or a['_e']['category'] != a['category']]
N = len(ARTICLES)
stars = Counter(a['score'] for a in ARTICLES)

out = []
P = out.append
P('# 학습 중요도(★) 기준 점검')
P('')
P(f'점검일 {datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")} · 대상 {N}건(`data/*.json`) · **조사 전용: 점수 로직은 수정하지 않았다.** 반영은 검토 후 별도 지시.')
P('')
P(f'검증: 현재 규칙으로 재계산한 점수·카테고리가 저장값과 다른 기사 **{len(mismatch)}건**' + (' (재계산 로직이 운영 분류기와 동일함을 확인)' if not mismatch else ' — 아래 분석은 현재 규칙 기준 재계산값을 사용'))
P('')

# 1. 산식
P('## 1. 현재 점수 산식')
P('')
P('`collector/classify.py` `Classifier.classify` (제목만 사용, 본문·출처·기관 구분·게재 매체 수는 사용하지 않음):')
P('')
P('```')
P('top  = 대표 카테고리의 가중 키워드 점수 합 (strong 3 / company 2 / normal 1 / weighted 개별값, 같은 카테고리에서 더 긴 키워드에 포함되는 짧은 키워드는 제외)')
P('score = 2 + (top >= 3) + (top >= 6) + (제목에 important 키워드가 하나라도 있음)      # 최대 5')
P('        금리·대출 계열(low_importance: 대출금리/보금자리론/예금금리/신용대출)이 있으면 score = min(score, 2)')
P('        사회보험 제외 키워드에 걸려 미분류가 되면 score = 2 (키워드 점수 무시)')
P('```')
P('')
P('- 바닥 점수가 2라서 실제 분포는 ★2~★5뿐이다(★1은 나올 수 없음).')
P('- `important` 키워드(+1): ' + ', '.join(f'`{m.keyword}`' for m in cl.important))
P('- 태그 개수, 카테고리 종류, 출처 유형(감독당국 `press` 여부), 같은 사건의 매체 수는 점수에 **반영되지 않는다**.')
P('')
P('카테고리별 strong(3점) 키워드 — 점수를 3으로 끌어올리는 핵심 어휘:')
P('')
P('| 카테고리 | strong 키워드 |')
P('|---|---|')
import json as _j
cfg = _j.loads((ROOT / 'config' / 'categories.json').read_text(encoding='utf-8'))
for cat, spec in cfg['categories'].items():
    P(f"| {cat} | {', '.join(spec.get('strong', []))} |")
P('')

# 2. 분포
P('## 2. 별점 분포')
P('')
P('| ★ | 건수 | 비율 |')
P('|---|---|---|')
for s in range(1, 6):
    P(f'| ★{s} | {stars.get(s, 0)} | {stars.get(s, 0) / N:.1%} |')
P('')
P('카테고리 × 별점 (건수):')
P('')
cats = ['제도·회계·건전성', '생명보험', '손해보험', '금융시장·자산운용', '보험경영·판매', '위험관리·재보험', '사회·인구·기술 변화', '미분류']
P('| 카테고리 | ★2 | ★3 | ★4 | ★5 | 합계 | ★4+ 비율 |')
P('|---|---|---|---|---|---|---|')
for c in cats:
    row = Counter(a['score'] for a in ARTICLES if a['category'] == c)
    tot = sum(row.values())
    P(f"| {c} | {row.get(2, 0)} | {row.get(3, 0)} | {row.get(4, 0)} | {row.get(5, 0)} | {tot} | {((row.get(4, 0) + row.get(5, 0)) / tot if tot else 0):.0%} |")
P('')
by_type = defaultdict(Counter)
for a in ARTICLES:
    by_type[a['source_type']][a['score']] += 1
P('출처 유형별: ' + ' / '.join(f"{t}: " + ', '.join(f'★{s} {c.get(s, 0)}' for s in range(2, 6)) for t, c in by_type.items()))
P('')
imp_cnt = sum(1 for a in ARTICLES if a['_e']['imp'])
P(f'`important` 키워드가 걸린 기사: {imp_cnt}건({imp_cnt / N:.0%}). top 점수 분포: ' + ', '.join(f'top={k}: {v}건' for k, v in sorted(Counter(min(a['_e']['top'], 9) for a in ARTICLES).items())))
P('')

# 3. 샘플
P('## 3. 별점별 무작위 샘플 (각 15건, seed 고정)')
P('')
rnd = random.Random(20261105)
for s in range(2, 6):
    pool = [a for a in ARTICLES if a['score'] == s]
    pick = rnd.sample(pool, min(15, len(pool)))
    P(f'### ★{s} (전체 {len(pool)}건 중 {len(pick)}건)')
    P('')
    P('| 제목 | 출처 | 카테고리 | 점수 근거 |')
    P('|---|---|---|---|')
    for a in pick:
        e = a['_e']
        basis = f"top={e['top']}: {kw(e['hits'])}" + (f"; important: {', '.join(e['imp'])}" if e['imp'] else '') + (f"; 금리계열 상한: {', '.join(e['low'])}" if e['low'] else '')
        P(f"| {md(a['title'])} | {md(a['source'], 12)} | {a['category'][:7]} | {md(basis, 70)} |")
    P('')

# 4. 오판 의심
MARKET = re.compile(r'환율|증시|채권|국채|코스피|코스닥|연준|Fed|달러|엔화|유가|금리|주가|시황|마감')
INS = re.compile(r'보험|생보|손보|연금|지급여력|계리|IFRS|K-ICS|재보험|CSM|GA|설계사')
CORE = re.compile(r'계리가정|감독규정|보험부채|IFRS ?17|IFRS ?18|K-ICS|kics|지급여력|CSM|책임준비금|보험업법|계약서비스마진|경영실태평가|할인율|위험률|보험계리', re.I)

P('## 4. 오판 의심 사례')
P('')
c1 = [a for a in ARTICLES if a['score'] >= 3 and MARKET.search(a['title']) and not INS.search(a['title'])]
P(f'### ① 보험계리와 무관한데 점수가 높은 것 — 시장·금리 속보 중 보험 단어가 없고 ★3 이상: {len(c1)}건')
P('')
P('| ★ | 제목 | 출처 | 카테고리 | 근거 |')
P('|---|---|---|---|---|')
for a in sorted(c1, key=lambda x: (-x['score'], x['published_at']))[:20]:
    e = a['_e']
    P(f"| ★{a['score']} | {md(a['title'])} | {md(a['source'], 10)} | {a['category'][:7]} | {md(kw(e['hits']), 40)} |")
P('')
c2 = [a for a in ARTICLES if CORE.search(a['title']) and a['score'] <= 3]
P(f'### ② 계리 업무에 중요한데 점수가 낮은 것 — 핵심 용어(계리가정·감독규정·보험부채·IFRS17·K-ICS·지급여력·CSM·책임준비금·보험업법 등) 포함 + ★3 이하: {len(c2)}건 (핵심 용어 포함 전체 {sum(1 for a in ARTICLES if CORE.search(a["title"]))}건)')
P('')
P('| ★ | 제목 | 출처 | 카테고리 | 근거 |')
P('|---|---|---|---|---|')
for a in sorted(c2, key=lambda x: (x['score'], x['published_at']))[:20]:
    e = a['_e']
    P(f"| ★{a['score']} | {md(a['title'])} | {md(a['source'], 10)} | {a['category'][:7]} | {md(kw(e['hits']), 40)}{'; important: ' + ', '.join(e['imp']) if e['imp'] else ''} |")
P('')
# ③ 같은 사건
norm = lambda t: re.sub(r'\s+', '', re.sub(r'[^\w가-힣]', '', t))
clusters, used = [], set()
arts = sorted(ARTICLES, key=lambda x: x['published_at'])
for i, a in enumerate(arts):
    if i in used:
        continue
    grp = [a]
    for j in range(i + 1, len(arts)):
        if j in used:
            continue
        if difflib.SequenceMatcher(None, norm(a['title']), norm(arts[j]['title'])).ratio() > 0.62:
            grp.append(arts[j]); used.add(j)
    if len(grp) > 1:
        clusters.append(grp)
diff = [g for g in clusters if max(x['score'] for x in g) - min(x['score'] for x in g) >= 1]
P(f'### ③ 같은 사건인데 매체마다 점수가 다른 것 — 제목 유사도 묶음 {len(clusters)}개 중 점수가 다른 묶음 **{len(diff)}개**')
P('')
for g in sorted(diff, key=lambda g: -(max(x['score'] for x in g) - min(x['score'] for x in g)))[:10]:
    P(f"- 점수 {min(x['score'] for x in g)}~{max(x['score'] for x in g)}:")
    for x in g:
        e = x['_e']
        P(f"  - ★{x['score']} {md(x['source'], 10)} · {md(x['title'], 52)} — {x['category'][:7]} ({md(kw(e['hits']), 36)})")
P('')
c4 = [a for a in ARTICLES if a['source_type'] == 'press' and a['score'] <= 2]
press_all = [a for a in ARTICLES if a['source_type'] == 'press']
P(f'### ④ 감독당국 공식 보도자료인데 점수가 낮은 것 — press {len(press_all)}건 중 ★2: {len(c4)}건')
P('')
P('| ★ | 제목 | 출처 | 카테고리 | 근거 |')
P('|---|---|---|---|---|')
for a in sorted(press_all, key=lambda x: (x['score'], x['published_at']))[:12]:
    P(f"| ★{a['score']} | {md(a['title'])} | {md(a['source'], 8)} | {a['category'][:7]} | {md(kw(a['_e']['hits']), 40)} |")
P('')
# ⑤ 키워드 이중 집계(손보 ⊂ 실손보험)
def false_sonbo(a):
    sq = _squash(a['title'])
    return '손보' in sq and '손보' not in sq.replace('실손보험', '').replace('손해보험', '')


def rescore_without_false(a):
    e = a['_e']
    if a['category'] == '미분류':  # 사회보험 제외 등으로 미분류가 된 기사는 분류기가 키워드 점수를 무시하고 2점 고정
        return e['score']
    top = e['top'] - (3 if false_sonbo(a) and any(k == '손보' for k, _ in e['hits']) else 0)
    sc = 2 + (top >= 3) + (top >= 6) + (1 if e['imp'] else 0)
    if e['low']:
        sc = min(sc, 2)
    return min(5, sc)


fs = [a for a in ARTICLES if false_sonbo(a)]
star5 = [a for a in ARTICLES if a['score'] == 5]
P(f'### ⑤ 추가 발견 — 키워드 이중 집계: `손보`가 `실손보험` 안에서 일치')
P('')
P(f"`손보`(손해보험 strong 3점)는 한글 부분일치라 '실[손보]험' 처럼 **`실손보험`이라는 단어 안에서도 일치**한다. `실손`(3점)과 합쳐 3+3=6점이 되어 `실손보험` 기사는 사실상 모두 top≥6(+1)이 된다. 긴 키워드 우선 규칙(`금리` ⊂ `기준금리`)은 `실손보험`이 키워드 목록에 없어 적용되지 않는다.")
P('')
P(f"- 영향: `손보`가 실손보험 안에서만 일치한 기사 **{len(fs)}건**, 전부 ★5로 계산됨. 현재 ★5 {len(star5)}건 중 **{len([a for a in star5 if false_sonbo(a)])}건이 이 이중 집계 때문**이다(진짜 5점은 IFRS17 2건, 계리가정+감독규정 1건, 실손+손보사 1건).")
if fs:
    P(f"- 이 이중 집계를 제거하면 같은 기사들은 ★{', ★'.join(sorted({str(rescore_without_false(a)) for a in fs}))}가 된다(`실손` 3점 + `important: 실손보험` +1).")
P('')

# 사용자가 언급한 사례
P('### 화면에서 보인 대표 사례')
P('')
P('| 구분 | ★ | 제목 | 출처 | 카테고리 | 근거 |')
P('|---|---|---|---|---|---|')
named = [('환율 속보', r'원/?달러 환율|환율'), ('계리가정 감독', r'계리가정 감독'), ('보험주 마감시황', r'보험주 마감시황')]
for label, pat in named:
    m = [a for a in ARTICLES if re.search(pat, a['title'])][:2]
    for a in m:
        P(f"| {label} | ★{a['score']} | {md(a['title'])} | {md(a['source'], 10)} | {a['category'][:7]} | {md(kw(a['_e']['hits']), 40)}{'; important: ' + ', '.join(a['_e']['imp']) if a['_e']['imp'] else ''} |")
P('')

# 5. 원인
P('## 5. 원인 분석')
P('')
mkt_strong = [a for a in ARTICLES if a['category'] == '금융시장·자산운용' and a['_e']['top'] >= 3]
mkt4 = [a for a in ARTICLES if a['category'] == '금융시장·자산운용' and a['score'] >= 4]
core_hit = [a for a in ARTICLES if CORE.search(a['title'])]
P(f"1. **시장 속보가 계리 핵심 기사와 같은 등급을 받는다(핵심 문제).** 금융시장·자산운용의 strong 키워드(환율·증시·채권·연준·기준금리 등)는 시장 속보에 흔해서 이 카테고리 {len(mkt_strong)}건이 키워드 3점 이상(★3+)이다. 한 제목에 strong 키워드가 둘 이상 겹치면(예: `금리동결`+`연준`+`뉴욕증시` = 9점) top≥6이 되어 ★4까지 올라가, {len(mkt4)}건의 금융시장 기사가 계리가정 감독 기사(★4)와 같은 별 개수다.")
P('2. **점수가 \"키워드가 몇 개 겹쳤는가\"에 비례한다.** `GA`, `생보`, `종신보험`처럼 한 제목에 strong 키워드가 여러 개 들어가는 상품·판매 기사가 계리 핵심어 하나짜리 기사보다 높게 나온다(예: `GA시책` 8점 → ★4, `계리가정` 단독 3점+금감원 1점 → ★4).')
P(f"3. **계리 핵심어 자체는 대체로 잘 잡힌다.** 핵심 용어(계리가정·감독규정·보험부채·IFRS17·K-ICS·지급여력·CSM 등) 포함 기사 {len(core_hit)}건 중 important 가산이 걸린 것은 {sum(1 for a in core_hit if a['_e']['imp'])}건이고 ★3 이하는 1건뿐이다(`경영실태평가`가 important 목록에 없음). 즉 '핵심어인데 점수가 낮은' 문제는 현재 데이터에서는 거의 없다.")
P('4. **감독당국 공식 여부는 점수에 없지만, 현재 데이터에서는 문제가 드러나지 않았다.** press 3건은 ★3·★5·★5다. 다만 노이즈 제목 필터 이후 press 표본이 3건뿐이라 결론을 내기엔 이르다(감독당국 게시판 수집이 추가되면 다시 점검 필요).')
P('5. **같은 사건의 매체별 편차는 이번 데이터에서 찾지 못했다**(제목 유사도 0.62 이상 묶음 22개 모두 점수 동일). 점수가 제목의 키워드만으로 정해지므로 같은 키워드가 들어간 기사는 같은 점수를 받는 구조다. 제목이 많이 다르게 쓰인 같은 사건은 이 방법으로 묶이지 않아 놓쳤을 수 있다.')
P('6. **태그·카테고리·출처는 점수에 영향이 없다.** 보험주 시황(`마감시황`)처럼 보험 단어는 있으나 학습 가치가 낮은 기사도 별도 감점이 없어 회사명(2점)에 따라 ★2로 정해진다. 금리 계열 기사만 ★2 상한이 있다.')
P('7. **⑤의 키워드 이중 집계 버그**로 `실손보험` 기사가 ★5로 부풀려진다(현재 ★5의 6/10).')
P('')

# 6. 시뮬레이션
P('## 6. 개선안과 예상 효과 (시뮬레이션만, 미반영)')
P('')
CORE_KW = [m for m in cl.important if m.keyword in ('K-ICS', 'kics', 'IFRS17', 'IFRS 17', '지급여력', '보험부채', 'CSM', '계리가정', '보험업법', '손해율', '재보험')]
EXTRA_CORE = re.compile(r'감독규정|IFRS ?18|책임준비금|계약서비스마진|경영실태평가|할인율|위험률|보험계리|인가|지급여력', re.I)
MARKET_KW = re.compile(r'환율|증시|채권|국채|코스피|코스닥|연준|Fed|달러|엔화|유가|주가|마감시황|시황')


def adj_top(a):  # 안 0 적용 후 키워드 점수(이중 집계 제외). 안 A~C 는 이 값을 쓴다
    e = a['_e']
    return e['top'] - (3 if false_sonbo(a) and any(k == '손보' for k, _ in e['hits']) else 0)


def sim_a(a):  # 안 A: 핵심어 2단계 + 시장 속보 상한
    e = a['_e']; t = a['title']
    if a['category'] == '미분류':
        return e['score']
    s = 2 + (adj_top(a) >= 3) + (adj_top(a) >= 6)
    core = bool(CORE.search(t)) or bool(e['imp'] and any(k in ('K-ICS', 'kics', 'IFRS17', 'IFRS 17', '지급여력', '보험부채', 'CSM', '계리가정', '보험업법') for k in e['imp']))
    s += 2 if core else (1 if e['imp'] else 0)
    if MARKET_KW.search(t) and not INS.search(t):
        s = min(s, 2)
    if e['low']:
        s = min(s, 2)
    return max(2, min(5, s))


BASE = {'제도·회계·건전성': 3, '위험관리·재보험': 3, '생명보험': 2, '손해보험': 2, '보험경영·판매': 2, '사회·인구·기술 변화': 2, '금융시장·자산운용': 1, '미분류': 1}


def sim_b(a):  # 안 B: 카테고리 기본점 + 감독당국 가산 + 핵심어 가산
    e = a['_e']; t = a['title']
    s = BASE.get(a['category'], 1) + (1 if adj_top(a) >= 3 else 0) + (1 if adj_top(a) >= 6 else 0)
    s += 1 if (CORE.search(t) or e['imp']) else 0
    s += 1 if a['source_type'] == 'press' else 0
    if e['low']:
        s = min(s, 2)
    return max(1, min(5, s))


def sim_c(a, cluster_size):  # 안 C: 안 A + 공식 가산 + 사건 확산도(같은 사건 매체 수)
    s = sim_a(a)
    s += 1 if a['source_type'] == 'press' else 0
    s += 1 if cluster_size >= 3 else 0
    return min(5, s)


size_of = {}
for g in clusters:
    for x in g:
        size_of[x['id']] = len(g)
sims = {'현재': lambda a: a['_e']['score'], '안 0': rescore_without_false, '안 A': sim_a, '안 B': sim_b, '안 C': lambda a: sim_c(a, size_of.get(a['id'], 1))}
P('| 안 | 내용 | 구현 복잡도 | ★1 | ★2 | ★3 | ★4 | ★5 | ① 시장 속보 ★3+ | ② 핵심어 ★3 이하 | 핵심어 ★4+ | ④ 공식 ★2 |')
P('|---|---|---|---|---|---|---|---|---|---|---|---|')
desc = {
    '현재': ('현재 산식', '—'),
    '안 0': ('이중 집계만 제거(`손보` ⊂ `실손보험`) — 산식은 그대로', '매우 낮음 (키워드 하나를 `실손보험` 앞에서 제외)'),
    '안 A': ('(안 0 포함) 핵심어를 2단계로 나눠 가산(+2/+1)하고, 보험 단어 없는 시장·시황 속보는 ★2 상한', '낮음 (config 키워드 목록 2개 + 상한 규칙)'),
    '안 B': ('(안 0 포함) 카테고리 기본점(제도·위험 3, 금융시장 1 등) + 감독당국 공식 +1 + 핵심어 +1', '중간 (카테고리별 기본점 설정, 별점 1~5 사용)'),
    '안 C': ('안 A(안 0 포함) + 공식 +1 + 같은 사건을 다룬 매체가 3곳 이상이면 +1(제목 유사도 묶음)', '높음 (수집 후 묶음 계산, 사건 단위 점수 공유)'),
}
for name, fn in sims.items():
    sc = {a['id']: fn(a) for a in ARTICLES}
    dist = Counter(sc.values())
    k1 = sum(1 for a in ARTICLES if sc[a['id']] >= 3 and MARKET.search(a['title']) and not INS.search(a['title']))
    k2 = sum(1 for a in ARTICLES if CORE.search(a['title']) and sc[a['id']] <= 3)
    k4 = sum(1 for a in ARTICLES if a['source_type'] == 'press' and sc[a['id']] <= 2)
    kc = sum(1 for a in ARTICLES if CORE.search(a['title']) and sc[a['id']] >= 4)
    P(f"| {name} | {desc[name][0]} | {desc[name][1]} | {dist.get(1, 0)} | {dist.get(2, 0)} | {dist.get(3, 0)} | {dist.get(4, 0)} | {dist.get(5, 0)} | {k1} | {k2} | {kc}/{sum(1 for a in ARTICLES if CORE.search(a['title']))} | {k4} |")
P('')
P('(① ② ④는 위 4절의 의심 사례 건수와 같은 기준. 숫자가 작을수록 의심 사례가 줄어든 것이다. 시뮬레이션은 현재 데이터 기준이며 정답 라벨로 검증한 것이 아니다.)')
P('')
P('### 비교와 권고')
P('')
P('- **안 0**: 산식은 그대로 두고 이중 집계 버그만 고친다. 버그로 부풀려진 ★5 6건이 사라질 뿐 ①(시장 속보)은 그대로라서 단독으로는 부족하지만 **어떤 안을 택하든 먼저 고쳐야 한다**(점수 측정 오류).')
P('- **안 A**: 가장 작은 변경으로 ①(시장 속보 ★3+)을 29건에서 2건으로 줄이고, 계리 핵심어 기사는 ★4+가 늘어(표의 \'핵심어 ★4+\' 열) 시장 속보와 확실히 구분된다. 카테고리·출처는 건드리지 않아 설명이 쉽다. 한계: 감독당국 공식 보도자료의 점수는 그대로고, 같은 사건의 매체별 편차는 남는다.')
P('- **안 B**: 감독당국·제도 카테고리가 자연스럽게 높아진다(④는 현재 데이터에서 이미 0건이라 효과를 확인할 수 없다). 대신 ★1이 생기고 금융시장 기사 전반이 낮아져 "금리 결정" 같은 중요한 시장 소식도 낮게 나올 수 있다(카테고리 기본점이 키워드보다 앞서는 구조).')
P('- **안 C**: ③(같은 사건 편차)까지 다루지만 매체 수는 "화제성"이지 "계리 중요도"가 아니라 오히려 연예·사건 기사를 올릴 위험이 있고 구현이 복잡하다.')
P('- **권고**: 먼저 **안 0**(버그 수정)을 하고, **안 A**를 적용한 뒤 감독당국 가산(+1)만 안 B에서 가져와 붙이는 조합을 검토한다. 반영 전에 정답 샘플(`tests/classify_samples.json`)에 "중요도" 라벨(높음/보통/낮음) 60건 정도를 붙여 안 A의 순위 일치도를 숫자로 확인하는 것이 안전하다.')
P('')
print('\n'.join(out))
