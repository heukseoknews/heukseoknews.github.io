"""같은 사건 판정용 기사 쌍 표본 추출(조사 전용, data/ 읽기만).

  python scripts/audit/quality/make_pairs.py > /tmp/pairs_new.tsv

발행 시각 72시간 안의 모든 기사 쌍에서 유사도 구간별(층화) 무작위 추출한다. 각 층의 모집단 크기(N)를 같이 적어
표본 정밀도·재현율을 전체 쌍 기준으로 환산할 수 있게 한다(가중치 = N/n).
층: s = max(TF-IDF 코사인, 글자 2-gram Jaccard)
  S1 s>=0.6 · S2 0.45~0.6 · S3 0.35~0.45 · S4 0.25~0.35 · S5 0.15~0.25
  E  s<0.15 이지만 같은 회사·기관 태그 공유(재현율 점검) · R  그 밖의 무작위 쌍(음성 확인)
출력 열: pair_id, channel, stratum, N, a_id, b_id, a_title, a_source, b_title, b_source, hours_apart, label(빈칸)
"""
from __future__ import annotations
import random
import sys

import qlib

STRATA = [('S1', 0.6, 9.0), ('S2', 0.45, 0.6), ('S3', 0.35, 0.45), ('S4', 0.25, 0.35), ('S5', 0.15, 0.25)]
PLAN = {'insurance': {'S1': 12, 'S2': 14, 'S3': 14, 'S4': 14, 'S5': 10, 'E': 8, 'R': 4},
        'ai': {'S1': 6, 'S2': 7, 'S3': 7, 'S4': 7, 'S5': 5, 'E': 4, 'R': 2}}


def stratum(s: dict) -> str:
    m = max(s['cos'], s['j2'])
    for name, lo, hi in STRATA:
        if lo <= m < hi:
            return name
    return 'E' if s['ent'] else 'R'


def main(seed: int = 20261112):
    rnd = random.Random(seed)
    out = ['\t'.join(['pair_id', 'channel', 'stratum', 'N', 'a_id', 'b_id', 'a_title', 'a_source', 'b_title', 'b_source', 'hours_apart', 'label'])]
    for ch, plan in PLAN.items():
        A = qlib.load(ch)
        F = qlib.Features(A)
        buckets: dict[str, list] = {k: [] for k in plan}
        for i, j in F.pairs_in_window():
            if A[i]['title'] == A[j]['title']:
                st = 'S1'
            else:
                st = stratum(F.sims(i, j))
            if st == 'R':  # 무작위 음성 층은 저장량을 줄이려 일부만 보관(모집단 크기는 따로 셈)
                buckets.setdefault('_Rn', [0])[0] += 1
                if rnd.random() < 0.002:
                    buckets['R'].append((i, j))
                continue
            buckets[st].append((i, j))
        n_r = buckets.pop('_Rn', [0])[0]
        for st, k in plan.items():
            pool = buckets[st]
            N = n_r if st == 'R' else len(pool)
            for n, (i, j) in enumerate(rnd.sample(pool, min(k, len(pool)))):
                a, b = A[i], A[j]
                pid = f'{ch[:3]}-{st}-{n + 1:02d}'
                row = [pid, ch, st, str(N), a['id'], b['id'], a['title'], a['source'], b['title'], b['source'],
                       f"{abs(a['_t'] - b['_t']) / 3600:.1f}", '']
                out.append('\t'.join(x.replace('\t', ' ') for x in row))
    sys.stdout.write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main()
