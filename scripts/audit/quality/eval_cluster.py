"""같은 사건 묶기 방법 비교(조사 전용, data/ 읽기만).

  python scripts/audit/quality/eval_cluster.py [--labels scripts/audit/quality/pairs_labeled.tsv] [--md]

1) 라벨 표본(Y 같은 사건 / R 관련 / N 다른 사건)으로 방법·임계값별 정밀도·재현율
   - 정밀도 = (Y+R)/예측 양성 (R 은 묶여도 오류로 보지 않음), 엄격 정밀도 = Y/예측 양성
   - 재현율 = 묶인 Y / 전체 Y
   - '쌍' 판정은 두 기사 사이 직접 유사도, '묶음' 판정은 연결 요소(전이)까지 포함한 같은 묶음 여부
   - 표본은 유사도 층화 추출이라 층 가중치(N/n)로 환산한 전체 쌍 기준 값도 같이 낸다
2) 전체 data 에서 묶음 통계(묶인 기사 비율, 최대 묶음 크기)와 실행 시간
"""
from __future__ import annotations
import argparse
import time
from collections import Counter, defaultdict
from pathlib import Path

import qlib

HERE = Path(__file__).resolve().parent


def read_labels(path: Path) -> list[dict]:
    lines = [l.rstrip('\n').split('\t') for l in path.read_text(encoding='utf-8').splitlines()]
    head = lines[0]
    return [dict(zip(head, r)) for r in lines[1:] if r and len(r) == len(head)]


# ---------- 방법 정의: (이름, 쌍 판정 함수(s) -> bool) ----------

def methods():
    M = []
    M.append(('EXACT 정규화 제목 일치', lambda s: s['j2'] >= 0.999))
    for t in (0.3, 0.35, 0.4, 0.45, 0.5, 0.6):
        M.append((f'J2 글자2-gram Jaccard≥{t}', lambda s, t=t: s['j2'] >= t))
    for t in (0.25, 0.3, 0.4):
        M.append((f'J3 글자3-gram Jaccard≥{t}', lambda s, t=t: s['j3'] >= t))
    for t in (0.4, 0.5, 0.6):
        M.append((f'MINHASH(J2 근사,64해시)≥{t}', lambda s, t=t: s['mh'] >= t))
    for t in (0.3, 0.35, 0.4, 0.45, 0.5, 0.55):
        M.append((f'TFIDF 코사인≥{t}', lambda s, t=t: s['cos'] >= t))
    for k in (2, 3, 4):
        M.append((f'ENT 개체 공유+희소어≥{k}', lambda s, k=k: s['ent'] >= 1 and s['rare'] >= k))
    for k in (3, 4, 5):
        M.append((f'KW 희소어 공유≥{k}(개체 무관)', lambda s, k=k: s['rare'] >= k))
    for t in (0.35, 0.4, 0.45, 0.5):
        M.append((f'TFIDF≥{t} + 회사 불일치 거부', lambda s, t=t: s['cos'] >= t and not s['veto']))
    for t in (0.25, 0.3, 0.35, 0.4, 0.45, 0.5):
        M.append((f'CENTROID 중심 코사인≥{t} + 회사 거부', ('centroid', t, None)))
    for t in (0.25, 0.3, 0.35):
        M.append((f'CENTROID≥{t} + 회사 거부 + 같은 매체≥0.6', ('centroid', t, 0.6)))
    for hi, lo, k in ((0.5, 0.3, 3), (0.45, 0.3, 3), (0.45, 0.25, 3), (0.4, 0.25, 3), (0.45, 0.3, 2), (0.4, 0.3, 3)):
        M.append((f'HYB 코사인≥{hi} 또는 (≥{lo} 그리고 개체·희소어≥{k})',
                  lambda s, hi=hi, lo=lo, k=k: s['cos'] >= hi or (s['cos'] >= lo and (s['ent'] >= 1 or s['rare'] >= k + 1) and s['rare'] >= k)))
    return M


def sims_for(F: qlib.Features, i: int, j: int, with_mh: bool = True) -> dict:
    s = F.sims(i, j)
    if with_mh:
        s['mh'] = qlib.mh_sim(F.mh(i), F.mh(j))
    return s


def evaluate(labels, data, md=False):
    M = methods()
    # 채널별 특징 + 방법별 연결 요소
    per = {}
    timing = defaultdict(float)
    for ch, (A, F) in data.items():
        idx = {a['id']: k for k, a in enumerate(A)}
        t0 = time.perf_counter()
        all_s = {(i, j): sims_for(F, i, j) for i, j in F.pairs_in_window()}
        t_feat = time.perf_counter() - t0
        comps = {}
        for name, fn in M:
            t1 = time.perf_counter()
            if isinstance(fn, tuple):
                comps[name] = qlib.centroid_clusters(F, fn[1], same_source_t=fn[2])
            else:
                comps[name] = qlib.components(len(A), [p for p, s in all_s.items() if fn(s)])
            timing[(ch, name)] = time.perf_counter() - t1
        per[ch] = (A, F, idx, all_s, comps, t_feat)

    rows = []
    for name, fn in M:
        cnt = {'pair': Counter(), 'clu': Counter()}
        wcnt = {'pair': Counter(), 'clu': Counter()}
        for lb in labels:
            A, F, idx, all_s, comps, _ = per[lb['channel']]
            if lb.get(LABEL_COL) not in ('Y', 'R', 'N'):
                continue
            lb = {**lb, 'label': lb[LABEL_COL]}
            if lb['a_id'] not in idx or lb['b_id'] not in idx:
                continue
            i, j = sorted((idx[lb['a_id']], idx[lb['b_id']]))
            s = all_s.get((i, j)) or sims_for(F, i, j)
            w = int(lb['N']) / strata_n[(lb['channel'], lb['stratum'])]
            same = comps[name][i] == comps[name][j]
            for mode, pred in (('pair', same if isinstance(fn, tuple) else fn(s)), ('clu', same)):
                key = (pred, lb['label'])
                cnt[mode][key] += 1
                wcnt[mode][key] += w
        res = {'name': name}
        for mode in ('pair', 'clu'):
            for tag, c in (('', cnt[mode]), ('w', wcnt[mode])):
                tp_y, tp_r, fp = c[(True, 'Y')], c[(True, 'R')], c[(True, 'N')]
                fn_y = c[(False, 'Y')]
                pred = tp_y + tp_r + fp
                res[f'{mode}{tag}_P'] = (tp_y + tp_r) / pred if pred else float('nan')
                res[f'{mode}{tag}_Ps'] = tp_y / pred if pred else float('nan')
                res[f'{mode}{tag}_R'] = tp_y / (tp_y + fn_y) if tp_y + fn_y else float('nan')
        # 전체 데이터 묶음 통계
        for ch, (A, F, idx, all_s, comps, t_feat) in per.items():
            g = qlib.groups(comps[name])
            sizes = [len(v) for v in g.values()]
            res[f'{ch}_clustered'] = sum(x for x in sizes if x > 1) / len(A)
            res[f'{ch}_groups'] = sum(1 for x in sizes if x > 1)
            res[f'{ch}_max'] = max(sizes)
            res[f'{ch}_ms'] = (t_feat + timing[(ch, name)]) * 1000
        rows.append(res)
    return rows, per


def fmt(x, pct=True):
    return '—' if x != x else (f'{x * 100:.0f}%' if pct else f'{x:.0f}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels', default=str(HERE / 'pairs_labeled.tsv'))
    ap.add_argument('--col', default='final', help='라벨 열(final=확정, label_b=두 번째 판정자)')
    a = ap.parse_args()
    global LABEL_COL
    LABEL_COL = a.col
    labels = read_labels(Path(a.labels))
    global strata_n
    strata_n = Counter((lb['channel'], lb['stratum']) for lb in labels)
    data = {}
    for ch in ('insurance', 'ai'):
        A = qlib.load(ch)
        data[ch] = (A, qlib.Features(A))
    rows, per = evaluate(labels, data)
    print(f'라벨 {len(labels)}쌍: ' + ', '.join(f'{k} {v}' for k, v in sorted(Counter(lb["label"] for lb in labels).items())))
    print()
    print('| 방법 | 쌍 P | 쌍 R | 묶음 P | 묶음 엄격P | 묶음 R | 가중 묶음 P | 가중 묶음 R | 보험 묶인 비율 | 보험 묶음 수 | 보험 최대 | AI 최대 |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in rows:
        print(f"| {r['name']} | {fmt(r['pair_P'])} | {fmt(r['pair_R'])} | {fmt(r['clu_P'])} | {fmt(r['clu_Ps'])} | {fmt(r['clu_R'])} | "
              f"{fmt(r['cluw_P'])} | {fmt(r['cluw_R'])} | {fmt(r['insurance_clustered'])} | {r['insurance_groups']} | {r['insurance_max']} | {r['ai_max']} |")
    print()
    bench()


def bench():
    """방법별 처음부터 끝까지(토큰화 → 후보 쌍 → 판정 → 묶음) 실행 시간, 보험 전체 data 기준. 3회 중 최솟값."""
    import sys as _s
    _s.path.insert(0, str(qlib.ROOT / 'collector'))
    import cluster as prod
    A = qlib.load('insurance')
    n = len(A)

    def j2():
        g = [qlib.char_grams(a['title'], a['source'], 2) for a in A]
        F = qlib.Features.__new__(qlib.Features); F.arts, F.window = A, 72 * qlib.HOURS
        return qlib.components(n, [(i, j) for i, j in F.pairs_in_window() if qlib.jaccard(g[i], g[j]) >= 0.4])

    def tfidf():
        toks = [qlib.tokens(a['title'], a['source']) for a in A]
        tf = qlib.Tfidf(toks)
        F = qlib.Features.__new__(qlib.Features); F.arts, F.window = A, 72 * qlib.HOURS
        return qlib.components(n, [(i, j) for i, j in F.pairs_in_window() if qlib.Tfidf.cos(tf.vecs[i], tf.vecs[j]) >= 0.4])

    def minhash_lsh():
        g = [qlib.char_grams(a['title'], a['source'], 2) for a in A]
        sig = [qlib.minhash(x) for x in g]
        buckets = defaultdict(list)
        for i, s_ in enumerate(sig):
            for b in range(16):
                buckets[(b, tuple(s_[b * 4:(b + 1) * 4]))].append(i)
        cand = {(min(i, j), max(i, j)) for v in buckets.values() for i in v for j in v if i != j}
        return qlib.components(n, [(i, j) for i, j in cand if abs(A[i]['_t'] - A[j]['_t']) <= 72 * qlib.HOURS and qlib.mh_sim(sig[i], sig[j]) >= 0.4])

    def centroid():
        rows = [{k: v for k, v in a.items() if not k.startswith('cluster') and k != '_t'} for a in A]
        return prod.assign(rows, {**prod.DEFAULTS, 'lookback_days': 100000, 'idf_days': 100000})

    print(f'실행 시간(보험 {n}건 전체, 72시간 창, 3회 중 최솟값):')
    print()
    print('| 방법 | 초 |')
    print('|---|---|')
    for name, fn in (('J2 Jaccard≥0.4(창 안 모든 쌍)', j2), ('TFIDF 코사인≥0.4(창 안 모든 쌍)', tfidf),
                     ('MINHASH 64해시·LSH 16밴드≥0.4', minhash_lsh), ('채택: 중심 벡터 묶기+회사 거부+합치기(collector/cluster.py)', centroid)):
        best = min(_timed(fn) for _ in range(3))
        print(f'| {name} | {best:.2f} |')


def _timed(fn):
    t = time.perf_counter(); fn(); return time.perf_counter() - t


strata_n: Counter = Counter()
LABEL_COL = 'final'

if __name__ == '__main__':
    main()
