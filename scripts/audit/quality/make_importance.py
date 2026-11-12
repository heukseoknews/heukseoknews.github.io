"""중요도 판정용 기사 표본 추출(조사 전용, data/ 읽기만).

  python scripts/audit/quality/make_importance.py > /tmp/importance_new.tsv

채널·현재 ★별 층화 무작위 추출(★4·5가 드물어서 층화). 사람이 판정할 때 현재 ★을 보지 않도록 출력에는 점수를 넣지 않는다
(평가 스크립트가 id 로 현재 값을 다시 읽는다).
라벨(1~5): 5 반드시 볼 것(업계 전체에 영향: 제도·회계·감독 변경, 대형 M&A, 주요 모델 출시)
           4 볼 만함(주요사 실적·전략, 중요 상품·규제 동향) · 3 참고(일반 상품 출시·업계 동향)
           2 낮음(단순 홍보·인사·행사·주가) · 1 무관(채널 주제와 관계없음·광고성)
"""
from __future__ import annotations
import random
import sys

import qlib

PLAN = {'insurance': {('rel', 2): 18, ('rel', 3): 14, ('rel', 4): 10, ('rel', 5): 6, ('irr', None): 8},
        'ai': {('rel', 2): 10, ('rel', 3): 12, ('rel', 4): 8, ('rel', 5): 4, ('irr', None): 4}}


def main(seed: int = 1112):
    rnd = random.Random(seed)
    print('\t'.join(['item_id', 'channel', 'id', 'title', 'source', 'source_type', 'label']))
    for ch, plan in PLAN.items():
        A = qlib.load(ch)
        for (kind, s), k in plan.items():
            pool = [a for a in A if (a.get('relevant', True) and a['score'] == s) if kind == 'rel'] if kind == 'rel' else [a for a in A if not a.get('relevant', True)]
            for n, a in enumerate(rnd.sample(pool, min(k, len(pool)))):
                print('\t'.join([f'{ch[:3]}-{kind}{s or ""}-{n + 1:02d}', ch, a['id'], a['title'].replace('\t', ' '), a['source'], a['source_type'], '']))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
