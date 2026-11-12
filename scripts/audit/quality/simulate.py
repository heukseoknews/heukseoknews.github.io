"""3단계 적용 시뮬레이션 — 플래그를 켠 상태로 기존 data 전체에 새 결과를 계산해 변경 전후를 비교한다(data/ 에 쓰지 않음).

  .venv/bin/python scripts/audit/quality/simulate.py > docs/article-quality-simulation.md

운영 코드(collector/quality.py → cluster.py·score_v2.py)를 그대로 쓰고, 기사 목록은 메모리 사본만 다룬다.
1) 전체 기간 일괄 적용(lookback 제한 없음): ★ 분포 전후, 카테고리별, 묶음 통계·대표 기사, 크게 바뀐 기사, 의심 사례
2) 백테스트: 실제 수집 실행 시각(collected_at) 순서대로 증분 적용을 재연 — 실행당 시간, cluster_id 변경(안정성), 일괄 결과와 일치도
3) 라벨 표본으로 묶기 정밀도·재현율, 중요도 순위 일치도(v1 대 v2)
4) '상위 20' 목록의 같은 사건 중복(★ 높은 순, v1 대 v2+대표만)
"""
from __future__ import annotations
import copy
import json
import random
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / 'collector'))
import channel  # noqa: E402
import quality  # noqa: E402
from cluster import ts  # noqa: E402

CHANNELS = ('insurance', 'ai')
FULL = {'lookback_days': 100000, 'idf_days': 100000}


def load(ch):
    return [a for p in sorted((ROOT / 'data' / ch).glob('????-??.json')) for a in json.loads(p.read_text(encoding='utf-8'))]


def md(s, n=60):
    s = ' '.join(str(s).split()).replace('|', '／')
    return s if len(s) <= n else s[: n - 1] + '…'


def pct(a, b):
    return f'{a / b * 100:.0f}%' if b else '—'


def rank(x):
    s = sorted(range(len(x)), key=lambda i: x[i]); r = [0.0] * len(x); i = 0
    while i < len(x):
        j = i
        while j + 1 < len(x) and x[s[j + 1]] == x[s[i]]:
            j += 1
        for k in range(i, j + 1):
            r[s[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(x, y):
    return statistics.correlation(rank(x), rank(y))


def read_tsv(p):
    lines = [l.split('\t') for l in p.read_text(encoding='utf-8').splitlines()]
    return [dict(zip(lines[0], r)) for r in lines[1:] if len(r) == len(lines[0])]


def dist_table(P, rows, key, title):
    n = len(rows)
    c = Counter(a.get(key) for a in rows)
    P(f'| {title} | ' + ' | '.join(f'{c.get(s, 0)} ({pct(c.get(s, 0), n)})' for s in range(1, 6)) + f' | {n} |')


def main():
    out = []
    P = out.append
    labels = read_tsv(HERE / 'pairs_labeled.tsv')
    imp = read_tsv(HERE / 'importance_labeled.tsv')
    P('# 기사 품질 적용 시뮬레이션(3단계)')
    P('')
    P(f'생성 {datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")} · `scripts/audit/quality/simulate.py` · 플래그를 켠 상태로 **메모리에서만** 계산(data/ 변경 없음). 운영 코드(`collector/quality.py`)를 그대로 사용.')
    P('')
    for ch in CHANNELS:
        cd = channel.use(ch)
        base = load(ch)
        rows = copy.deepcopy(base)
        t0 = time.perf_counter()
        summ = quality.compute(rows, cd, force=(True, True), cluster_overrides=FULL)
        t_full = time.perf_counter() - t0
        by = {a['id']: a for a in rows}
        rel = [a for a in rows if a.get('relevant', True)]
        P(f'## {ch} — 기사 {len(rows)}건(관련 {len(rel)}건)')
        P('')
        P(f'전체 기간 일괄 계산 시간 **{t_full:.2f}초** (묶기+점수+대표 선택, 파이썬 표준 라이브러리만).')
        P('')
        # ---- ★ 분포 ----
        P('### ★ 분포 전후')
        P('')
        P('| 구분 | ★1 | ★2 | ★3 | ★4 | ★5 | 합계 |')
        P('|---|---|---|---|---|---|---|')
        dist_table(P, rows, 'score', '현재 score(전체)')
        dist_table(P, rows, 'score_v2', 'score_v2(전체)')
        dist_table(P, rel, 'score', '현재 score(관련 기사)')
        dist_table(P, rel, 'score_v2', 'score_v2(관련 기사)')
        leads = [a for a in rel if not a.get('cluster_id') or a.get('cluster_lead')]
        dist_table(P, leads, 'score_v2', 'score_v2(관련·대표만 = 목록 기준)')
        P('')
        P('카테고리별 평균 ★(관련 기사):')
        P('')
        P('| 카테고리 | 건수 | 현재 평균 | v2 평균 | v2 ★4+ 비율 |')
        P('|---|---|---|---|---|')
        cats = defaultdict(list)
        for a in rel:
            cats[a['category']].append(a)
        for k, v in sorted(cats.items(), key=lambda x: -len(x[1])):
            P(f'| {k} | {len(v)} | {statistics.mean(a["score"] for a in v):.2f} | {statistics.mean(a["score_v2"] for a in v):.2f} | {pct(sum(a["score_v2"] >= 4 for a in v), len(v))} |')
        P('')
        # ---- 묶음 ----
        groups = defaultdict(list)
        for a in rows:
            if a.get('cluster_id'):
                groups[a['cluster_id']].append(a)
        sizes = Counter(min(len(v), 20) for v in groups.values())
        P('### 묶음 통계')
        P('')
        P(f'- 묶음 {len(groups)}개, 묶인 기사 {sum(len(v) for v in groups.values())}건({pct(sum(len(v) for v in groups.values()), len(rows))}). '
          f'목록에 보일 항목 수(대표+혼자인 기사) {len(rows)} → **{len(rows) - sum(len(v) - 1 for v in groups.values())}**건.')
        P('- 크기 분포: ' + ', '.join(f'{k if k < 20 else "20+"}건 {v}개' for k, v in sorted(sizes.items())))
        P('- 대표 기사 규칙: 공식 발표(press) > 관련 있음 > 높은 score_v2 > 직접 링크(구글 중간 링크 아님) > 먼저 발행 > id. `cluster_lead: true` 는 묶음당 1건.')
        span = [(max(ts(a) for a in v) - min(ts(a) for a in v)) / 3600 for v in groups.values()]
        P(f'- 묶음 시간 폭: 중앙값 {statistics.median(span):.1f}시간, 최대 {max(span):.0f}시간' if span else '- 묶음 없음')
        P('')
        P('매체 수가 많은 묶음 상위 12개:')
        P('')
        P('| 매체 수 | 기사 수 | score_v2 | 현재 score 범위 | 대표 기사 | 대표 출처 |')
        P('|---|---|---|---|---|---|')
        for v in sorted(groups.values(), key=lambda v: (-v[0]['cluster_sources'], v[0]['cluster_id']))[:12]:
            lead = next(a for a in v if a.get('cluster_lead'))
            sc = sorted({a['score'] for a in v})
            P(f'| {v[0]["cluster_sources"]} | {len(v)} | {lead["score_v2"]} | {sc[0]}~{sc[-1]} | {md(lead["title"])} | {md(lead["source"], 16)} |')
        P('')
        # ---- 의심 사례 ----
        P('### 의심 사례')
        P('')
        multi = [v for v in groups.values() if len({c for a in v for c in a.get('companies') or []}) >= 2]
        P(f'**① 회사 태그가 2개 이상 섞인 묶음 {len(multi)}개** (회사 거부는 태그가 하나도 안 겹칠 때만 막는다 — 인수 대상 회사처럼 함께 나오는 경우가 대부분)')
        P('')
        for v in sorted(multi, key=lambda v: -len(v))[:8]:
            comp = Counter(c for a in v for c in a.get('companies') or [])
            P(f'- {len(v)}건 · {", ".join(f"{k}({n})" for k, n in comp.most_common(4))} · 예: {md(v[0]["title"], 50)}')
        P('')
        wide = [v for v in groups.values() if (max(ts(a) for a in v) - min(ts(a) for a in v)) > 48 * 3600]
        P(f'**② 48시간 넘게 이어진 묶음 {len(wide)}개** (후속 보도까지 한 묶음이 된 경우)')
        P('')
        for v in sorted(wide, key=lambda v: -len(v))[:6]:
            v2 = sorted(v, key=ts)
            P(f'- {len(v)}건 · 첫: {md(v2[0]["title"], 40)} → 끝: {md(v2[-1]["title"], 40)}')
        P('')
        pr = [v for v in groups.values() if v[0]['cluster_sources'] >= 10 and next(a for a in v if a.get('cluster_lead'))['score_v2'] <= 2]
        P(f'**③ 매체 10곳 이상인데 v2 ★2 이하 {len(pr)}개** (홍보·행사로 판정되어 보도 규모 가산을 받지 않은 묶음)')
        P('')
        for v in pr[:8]:
            P(f'- {v[0]["cluster_sources"]}곳 · {md(next(a for a in v if a.get("cluster_lead"))["title"], 60)}')
        P('')
        up = [a for a in rel if a['score_v2'] - a['score'] >= 2]
        down = [a for a in rel if a['score'] - a['score_v2'] >= 2]
        rnd = random.Random(20261112)
        for name, lst in (('④ v2가 2단계 이상 오른 기사', up), ('⑤ v2가 2단계 이상 내린 기사', down)):
            P(f'**{name} {len(lst)}건** (무작위 12건)')
            P('')
            P('| 현재 | v2 | 카테고리 | 매체 수 | 제목 | 출처 |')
            P('|---|---|---|---|---|---|')
            for a in sorted(rnd.sample(lst, min(12, len(lst))), key=lambda a: -a['score_v2']):
                P(f'| {a["score"]} | {a["score_v2"]} | {md(a["category"], 10)} | {a.get("cluster_sources", 1)} | {md(a["title"], 56)} | {md(a["source"], 12)} |')
            P('')
        five = [a for a in leads if a['score_v2'] == 5]
        P(f'**⑥ v2 ★5 대표 기사 {len(five)}건** (무작위 12건)')
        P('')
        for a in rnd.sample(five, min(12, len(five))):
            P(f'- [{a["category"]}] {md(a["title"], 64)} · {md(a["source"], 12)} · 매체 {a.get("cluster_sources", 1)}')
        P('')
        # ---- 상위 20 중복 ----
        P('### 상위 20 목록의 같은 사건 중복')
        P('')
        P('최근 7일 관련 기사를 ★ 높은 순(같으면 최신 순)으로 20건 뽑았을 때, 같은 묶음(일괄 결과 기준)에 속한 기사가 몇 건 겹치는지.')
        P('')
        latest = max(ts(a) for a in rows)
        recent = [a for a in rel if ts(a) >= latest - 7 * 86400]
        top_v1 = sorted(recent, key=lambda a: (-a['score'], -ts(a)))[:20]
        top_v2 = sorted([a for a in recent if not a.get('cluster_id') or a.get('cluster_lead')], key=lambda a: (-a['score_v2'], -a.get('cluster_sources', 1), -ts(a)))[:20]
        dup = lambda L: len(L) - len({a.get('cluster_id') or a['id'] for a in L})
        P(f'- 현재(score, 묶기 없음): 중복 **{dup(top_v1)}건**, 고유 사건 {20 - dup(top_v1)}개')
        P(f'- v2(score_v2, 대표만): 중복 **{dup(top_v2)}건**')
        P('')
        P('| 순위 | 현재 상위 20 | v2 상위 20(대표) |')
        P('|---|---|---|')
        for i in range(20):
            x = top_v1[i] if i < len(top_v1) else None
            y = top_v2[i] if i < len(top_v2) else None
            P(f'| {i + 1} | {f"★{x["score"]} {md(x["title"], 44)}" if x else ""} | {f"★{y["score_v2"]}·{y.get("cluster_sources", 1)}곳 {md(y["title"], 44)}" if y else ""} |')
        P('')
        # ---- 백테스트(증분 재연) ----
        runs = sorted({a['collected_at'][:16] for a in base})
        live = copy.deepcopy(base)
        live.sort(key=lambda a: a['collected_at'])
        firsts, changed, times = {}, set(), []
        k = 0
        cur: list[dict] = []
        for r in runs:
            while k < len(live) and live[k]['collected_at'][:16] <= r:
                cur.append(live[k]); k += 1
            t1 = time.perf_counter()
            quality.compute(cur, cd, now=datetime.fromisoformat(r + ':59+00:00'), force=(True, True))
            times.append(time.perf_counter() - t1)
            for a in cur:
                cid = a.get('cluster_id')
                if a['id'] in firsts and firsts[a['id']] is not None and cid != firsts[a['id']]:
                    changed.add(a['id'])
                if firsts.get(a['id']) is None:
                    firsts[a['id']] = cid
        fb = {a['id']: a.get('cluster_id') for a in rows}
        lb = {a['id']: a.get('cluster_id') for a in live}
        pairs_b = {(x, y) for v in groups.values() for i, x in enumerate(sorted(a['id'] for a in v)) for y in sorted(a['id'] for a in v)[i + 1:]}
        g2 = defaultdict(list)
        for i, c in lb.items():
            if c:
                g2[c].append(i)
        pairs_l = {(x, y) for v in g2.values() for i, x in enumerate(sorted(v)) for y in sorted(v)[i + 1:]}
        inter = len(pairs_b & pairs_l)
        P('### 백테스트: 실제 수집 순서로 증분 적용 재연')
        P('')
        P(f'수집 실행 {len(runs)}회(collected_at 기준)를 순서대로 재연. 매 실행은 lookback {json.loads((cd / "cluster.json").read_text(encoding="utf-8"))["lookback_days"]}일 안의 묶이지 않은 기사만 새로 판정하고, 이미 묶인 cluster_id 는 고정.')
        P('')
        P(f'- 실행당 시간: 평균 {statistics.mean(times) * 1000:.0f}ms, 최대 {max(times) * 1000:.0f}ms (합계 {sum(times):.1f}초)')
        P(f'- 한 번 묶인 뒤 cluster_id 가 바뀐 기사: **{len(changed)}건** / 묶인 적 있는 기사 {sum(1 for v in firsts.values() if v)}건')
        P(f'- 재연 결과 대 일괄 결과(같은 묶음 쌍 기준): 일치 {inter}쌍, 일괄에만 {len(pairs_b) - inter}쌍, 재연에만 {len(pairs_l) - inter}쌍'
          f' → 재연이 일괄 묶음 쌍의 {pct(inter, len(pairs_b))}를 재현. 차이는 처리 순서(늦게 수집된 기사), IDF 기간(30일 대 전체), lookback 밖 기사 때문이다.')
        notin = sum(1 for i, c in fb.items() if c and not lb.get(i))
        P(f'- 일괄에서는 묶였지만 재연에서는 혼자인 기사 {notin}건')
        P('')
        # ---- 라벨 지표 ----
        P('### 라벨 표본 지표(운영 코드)')
        P('')
        for mode, D in (('일괄', by), ('증분 재연', {a['id']: a for a in live})):
            c = Counter()
            for lb_ in labels:
                if lb_['channel'] != ch:
                    continue
                a, b = D[lb_['a_id']], D[lb_['b_id']]
                same = bool(a.get('cluster_id')) and a.get('cluster_id') == b.get('cluster_id')
                c[(same, lb_['final'])] += 1
            pred = sum(v for (p, _), v in c.items() if p)
            P(f'- 묶기({mode}): 정밀도 {pct(c[(True, "Y")] + c[(True, "R")], pred)}(Y+R/예측), 엄격 정밀도 {pct(c[(True, "Y")], pred)}, '
              f'재현율 {pct(c[(True, "Y")], c[(True, "Y")] + c[(False, "Y")])} · 표본 {sum(c.values())}쌍(Y {c[(True, "Y")] + c[(False, "Y")]})')
        L = [x for x in imp if x['channel'] == ch]
        ref = [(int(x['label']) + int(x['label_b'])) / 2 for x in L]
        refb = [int(x['label_b']) for x in L]
        v1 = [by[x['id']]['score'] for x in L]
        v2 = [by[x['id']]['score_v2'] for x in L]
        mae = lambda s, r: sum(abs(p - q) for p, q in zip(s, r)) / len(r)
        P(f'- 중요도 순위 일치(스피어만, 두 판정 평균 기준): 현재 **{spearman(v1, ref):.2f}** → v2 **{spearman(v2, ref):.2f}** · '
          f'두 번째 판정자만 기준: {spearman(v1, refb):.2f} → {spearman(v2, refb):.2f} · 평균 절대 오차 {mae(v1, ref):.2f} → {mae(v2, ref):.2f} (표본 {len(L)}건)')
        hi = [i for i, r in enumerate(ref) if r >= 4]
        lo = [i for i, r in enumerate(ref) if r <= 2]
        P(f'- 사람이 4 이상으로 본 기사 {len(hi)}건 중 ★4+: 현재 {sum(v1[i] >= 4 for i in hi)}건 → v2 {sum(v2[i] >= 4 for i in hi)}건 · '
          f'사람이 2 이하로 본 기사 {len(lo)}건 중 ★3+: 현재 {sum(v1[i] >= 3 for i in lo)}건 → v2 {sum(v2[i] >= 3 for i in lo)}건')
        P('')
        P('중요도 라벨과 v2가 1.5 이상 어긋난 사례:')
        P('')
        P('| 사람(평균) | 현재 | v2 | 제목 |')
        P('|---|---|---|---|')
        for x, r, a, b in sorted(zip(L, ref, v1, v2), key=lambda z: z[3] - z[1]):
            if abs(b - r) >= 1.5:
                P(f'| {r:g} | {a} | {b} | {md(x["title"], 60)} |')
        P('')
        _ = summ
    sys.stdout.write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main()
