"""키워드 충돌 전수 점검(읽기 전용: 규칙·점수를 수정하지 않는다).

  python scripts/audit/keyword_collisions.py

config/categories.json(분류·점수 키워드)과 config/score.json(핵심어·보험 단어·금리 상한 키워드)의 모든 키워드를 대상으로:
 A. 포함 충돌   — 한 키워드가 다른 키워드의 일부(예: '금리' ⊂ '기준금리', '손보' ⊂ '손보사')
 B. 경계 겹침   — 한 키워드의 끝과 다른 키워드의 앞이 겹쳐 합쳐진 글자열에서 둘 다 일치(예: '실손'+'손보' → '실[손보]험')
 C. 분류 영향   — 같은 겹침 제거를 분류(카테고리 선택)에도 적용하면 대표 카테고리가 바뀌는 기사(확인만, 분류는 수정하지 않음)
점수(★)는 이미 겹침 제거를 쓰고, 분류 규칙은 수정하지 않는다.
"""
import glob, json, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'collector'))
from classify import TIERS, _squash, classify, load  # noqa: E402

cl = load()
CFG = json.loads((ROOT / 'config' / 'categories.json').read_text(encoding='utf-8'))
SC = json.loads((ROOT / 'config' / 'score.json').read_text(encoding='utf-8'))
ARTICLES = [x for f in sorted(glob.glob(str(ROOT / 'data' / '????-??.json'))) for x in json.loads(Path(f).read_text(encoding='utf-8'))]
SQ = [(a, _squash(a['title'])) for a in ARTICLES]

# 키워드 수집: (이름, 목록 이름, 종류, 점수)
kws = []
for cat, spec in CFG['categories'].items():
    for tier, w in TIERS.items():
        for k in spec.get(tier, []):
            kws.append((k, f'분류·{cat}', tier, w))
    for k, w in spec.get('weighted', {}).items():
        kws.append((k, f'분류·{cat}', 'weighted', w))
for g in SC['core_terms']['groups']:
    for k in g:
        kws.append((k, '핵심어', 'core', None))
for k in SC['market_cap']['insurance_terms']:
    kws.append((k, '시장상한·보험단어', 'ins', None))
for k in SC['low_importance']['keywords']:
    kws.append((k, '금리상한', 'low', None))

ascii_like = lambda k: re.fullmatch(r'[a-z0-9\- ]+', k.casefold()) is not None
sub_kws = [(k, lst, t, w) for k, lst, t, w in kws if not ascii_like(k)]
print('# 키워드 충돌 점검')
print()
print(f'대상 키워드 {len(kws)}개(한글·부분일치 {len(sub_kws)}개, 영문 단어경계 {len(kws) - len(sub_kws)}개). 영문 키워드는 단어 경계로 비교해 부분 충돌이 없다.')
print()

# A. 포함 충돌
print('## A. 포함 충돌 (A ⊂ B)')
print()
print('같은 분류 목록 안에서는 분류·점수 모두 "긴 키워드 우선"으로 처리된다(이중 계산 없음). 다른 목록 사이의 포함은 목록이 달라 별개 신호로 합산되거나 가산된다.')
print()
print('| 짧은 키워드 | 포함하는 키워드 | 짧은 쪽 목록 → 긴 쪽 목록 | 처리 |')
print('|---|---|---|---|')
seen = set()
for a, la, ta, wa in sub_kws:
    for b, lb, tb, wb in sub_kws:
        if a == b or _squash(a) == _squash(b):
            continue
        if _squash(a) in _squash(b) and (a, b, la, lb) not in seen:
            seen.add((a, b, la, lb))
            same = la == lb
            if same:
                note = '같은 목록 — 긴 키워드 우선(해결됨)'
            elif la.startswith('분류') and lb.startswith('분류'):
                note = '다른 카테고리 — 카테고리별 점수에 각각 반영(분류에는 영향, 점수는 대표 카테고리만)'
            elif la == '핵심어' and lb.startswith('분류'):
                note = '핵심어 가산(+1/+2)과 키워드 점수가 같은 단어에 함께 걸림(의도된 가산)'
            else:
                note = '서로 다른 용도(상한/보험단어 판정 등)'
            print(f'| {a} | {b} | {la} → {lb} | {note} |')
print()

# B. 경계 겹침 (같은 목록·같은 분류 안에서 점수가 합산되는 쌍만 이론 목록)
print('## B. 경계 겹침 (A의 끝 == B의 앞) — 같은 분류 카테고리 안의 쌍')
print()
print('띄어쓰기를 제거한 제목에서 `A+B` 합친 글자열(예: 실손+손보 → `실손보`)이 나오고 두 키워드가 구간을 공유하면 점수가 두 번 들어간다. 점수는 구간 겹침 제거로 해결됨. 아래는 이론상 쌍 수와 **실제 데이터에서 발생한 쌍**.')
print()
pairs = []
by_list = defaultdict(list)
for k, lst, t, w in sub_kws:
    if lst.startswith('분류'):
        by_list[lst].append((k, w))
for lst, items in by_list.items():
    for a, wa in items:
        for b, wb in items:
            sa, sb = _squash(a), _squash(b)
            if sa == sb or sa in sb or sb in sa:
                continue
            for n in range(min(len(sa), len(sb)) - 1, 0, -1):
                if sa.endswith(sb[:n]):
                    pairs.append((lst, a, b, sa + sb[n:]))
                    break
print(f'이론상 쌍(같은 목록, 끝-앞 겹침 ≥1글자): **{len(pairs)}개**')
print()
print('| 목록 | A | B | 합친 글자열 | 실제 기사 수 | 예시 |')
print('|---|---|---|---|---|---|')
hits = []
for lst, a, b, c in pairs:
    arts = [x for x, sq in SQ if c in sq]
    if arts:
        hits.append((lst, a, b, c, arts))
for lst, a, b, c, arts in sorted(hits, key=lambda h: -len(h[4])):
    print(f"| {lst} | {a} | {b} | `{c}` | {len(arts)} | {arts[0]['title'][:34].replace('|', '／')} |")
if not hits:
    print('| (데이터에서 발생한 쌍 없음) | | | | | |')
print()

# C. 분류 영향(확인만)
print('## C. 같은 겹침 제거를 분류에 적용하면? (확인만 — 분류는 수정하지 않음)')
print()
changed = []
for a, sq in SQ:
    text = a['title'].casefold()
    alt = {cat: cl.star_top(text, sq, cat) for cat in cl.rules}
    alt = {c: v for c, v in alt.items() if v > 0}
    if alt:
        top = max(alt.values())
        cat = [c for c in cl.priority if alt.get(c) == top][0]
    else:
        cat = a['category'] if a['category'] == '미분류' else None
    cur = classify(a['title'], a.get('feed_name'))['category']
    if cat is not None and cat != cur and cur != '미분류' and cat != '미분류':
        changed.append((a, cur, cat))
print(f'겹침 제거를 카테고리 점수에 적용했을 때 **대표 카테고리가 바뀌는 기사: {len(changed)}건 / {len(ARTICLES)}건**')
for a, cur, cat in changed[:15]:
    print(f"- {cur} → {cat}: {a['title'][:60]}")
print()
print('분류 규칙에는 같은 구조의 문제가 있다(가능성): `손보`가 `실손보험` 안에서도 일치해 손해보험 점수가 부풀 수 있다. 다만 `실손`이 이미 손해보험 strong 이라 대표 카테고리는 같다 — 위 건수가 그 영향의 전부다.')
