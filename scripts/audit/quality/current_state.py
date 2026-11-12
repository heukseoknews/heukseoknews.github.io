"""1단계 현황 측정 — 현재 ★(score) 분포와 사람 판정과 어긋나는 사례(조사 전용, data/ 읽기만).

  python scripts/audit/quality/current_state.py > docs/article-quality-current.md
"""
from __future__ import annotations
import random
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import qlib  # noqa: E402
from labels_md import read  # noqa: E402


def md(s, n=60):
    s = ' '.join(str(s).split()).replace('|', '／')
    return s if len(s) <= n else s[: n - 1] + '…'


def pct(a, b):
    return f'{a / b * 100:.0f}%' if b else '—'


# 규칙 기반 의심 패턴(제목 일부 일치). 현황 진단용이며 점수 산식에 쓰는 목록은 score.json v2.low_value 다.
PR = ['봉사', '기부', '캠페인', '사회공헌', '브랜드평판', '마감시황', '주가', '포토', '쉼터', '도서관', '데모데이', '웹예능', '일손']
BIG = ['인수', '경영권', '순익', '순이익', '실적', '감독규정', '개정안', '의결', '제재', '과징금']


def main():
    P = []
    imp = read('importance_labeled.tsv')
    P.append('# 기사 품질 현황(1단계 측정)')
    P.append('')
    P.append(f'생성 {datetime.now().astimezone().strftime("%Y-%m-%d")} · `scripts/audit/quality/current_state.py` · data/ 읽기 전용. 현재 ★ = 저장된 `score`(제목 키워드 산식, channels/<채널>/score.json).')
    P.append('')
    for ch in ('insurance', 'ai'):
        A = qlib.load(ch)
        rel = [a for a in A if a.get('relevant', True)]
        P.append(f'## {ch} — {len(A)}건(관련 {len(rel)}건, 기간 {A[0]["published_at"][:10]} ~ {A[-1]["published_at"][:10]})')
        P.append('')
        P.append('| 구분 | ★1 | ★2 | ★3 | ★4 | ★5 |')
        P.append('|---|---|---|---|---|---|')
        for name, L in (('전체', A), ('관련 기사', rel), ('공식 발표(press)', [a for a in A if a['source_type'] == 'press'])):
            c = Counter(a['score'] for a in L)
            P.append(f'| {name} {len(L)}건 | ' + ' | '.join(f'{c.get(s, 0)} ({pct(c.get(s, 0), len(L))})' for s in range(1, 6)) + ' |')
        P.append('')
        P.append('카테고리 × ★(관련 기사):')
        P.append('')
        P.append('| 카테고리 | ★2 | ★3 | ★4 | ★5 | ★2 비율 |')
        P.append('|---|---|---|---|---|---|')
        cats = defaultdict(Counter)
        for a in rel:
            cats[a['category']][a['score']] += 1
        for k, c in sorted(cats.items(), key=lambda x: -sum(x[1].values())):
            n = sum(c.values())
            P.append(f'| {k} | {c[2]} | {c[3]} | {c[4]} | {c[5]} | {pct(c[2], n)} |')
        P.append('')
        # 같은 사건 반복: 정규화 제목 2-gram 유사도로 대략 측정(정밀 측정은 eval_cluster.py)
        F = qlib.Features(A)
        lab = qlib.centroid_clusters(F, 0.3, same_source_t=0.6)
        g = qlib.groups(lab)
        big = sorted((v for v in g.values() if len(v) > 1), key=len, reverse=True)
        P.append(f'같은 사건 반복(중심 벡터 묶기 기준): 2건 이상 묶음 {len(big)}개에 기사 {sum(map(len, big))}건({pct(sum(map(len, big)), len(A))}). 가장 큰 묶음:')
        P.append('')
        for v in big[:6]:
            P.append(f'- {len(v)}건 · 매체 {len({A[i]["source"] for i in v})}곳 · ★{sorted({A[i]["score"] for i in v})} · {md(A[v[0]]["title"], 56)}')
        P.append('')
        # 규칙 기반 의심 사례
        rnd = random.Random(7)
        pr = [a for a in rel if a['score'] >= 3 and any(w in a['title'] for w in PR)]
        big2 = [a for a in rel if a['score'] <= 2 and any(w in a['title'] for w in BIG)]
        if ch == 'insurance':
            P.append(f'**홍보·행사·주가 성격인데 ★3 이상: {len(pr)}건** (예시)')
            P.append('')
            for a in rnd.sample(pr, min(8, len(pr))):
                P.append(f'- ★{a["score"]} [{a["category"]}] {md(a["title"], 64)}')
            P.append('')
            P.append(f'**M&A·실적·제도 성격인데 ★2: {len(big2)}건** (예시)')
            P.append('')
            for a in rnd.sample(big2, min(8, len(big2))):
                P.append(f'- ★{a["score"]} [{a["category"]}] {md(a["title"], 64)}')
            P.append('')
        # 사람 판정과 어긋남
        L = [x for x in imp if x['channel'] == ch]
        by = {a['id']: a for a in A}
        ref = [(int(x['label']) + int(x['label_b'])) / 2 for x in L]
        v1 = [by[x['id']]['score'] for x in L]
        P.append(f'**사람 판정(두 판정 평균)과 현재 ★이 1.5 이상 어긋난 기사** (표본 {len(L)}건 중, 평균 절대 오차 {statistics.mean(abs(a - b) for a, b in zip(v1, ref)):.2f})')
        P.append('')
        P.append('| 사람 | 현재 ★ | 제목 | 출처 |')
        P.append('|---|---|---|---|')
        for x, r, s in sorted(zip(L, ref, v1), key=lambda z: z[2] - z[1]):
            if abs(s - r) >= 1.5:
                P.append(f'| {r:g} | {s} | {md(x["title"], 60)} | {md(x["source"], 12)} |')
        P.append('')
    sys.stdout.write('\n'.join(P) + '\n')


if __name__ == '__main__':
    main()
