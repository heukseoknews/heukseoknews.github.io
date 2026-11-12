"""라벨 표를 사람이 확인하기 쉬운 마크다운으로 만든다(조사 전용).

  python scripts/audit/quality/labels_md.py > docs/article-quality-labels.md

원본은 같은 폴더의 TSV 두 개다(수정은 TSV 의 final 열에서 하고 이 스크립트로 다시 만든다).
- pairs_labeled.tsv: 같은 사건 판정 쌍. label = 판정자 A(메인 세션), label_b = 판정자 B(독립 서브에이전트, 라벨을 보지 않고 판정), final = 평가에 쓰는 값
- importance_labeled.tsv: 기사 중요도 1~5. label = A, label_b = B, final = A(평가에는 A·B 평균을 씀)
"""
from __future__ import annotations
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read(p):
    lines = [l.split('\t') for l in (HERE / p).read_text(encoding='utf-8').splitlines()]
    return [dict(zip(lines[0], r)) for r in lines[1:] if len(r) == len(lines[0])]


def md(s, n=48):
    s = ' '.join(s.split()).replace('|', '／')
    return s if len(s) <= n else s[: n - 1] + '…'


def main():
    P = []
    pairs, imp = read('pairs_labeled.tsv'), read('importance_labeled.tsv')
    P.append('# 기사 품질 라벨 표(확인용)')
    P.append('')
    P.append('`scripts/audit/quality/labels_md.py` 로 생성. 원본은 `scripts/audit/quality/pairs_labeled.tsv`·`importance_labeled.tsv`. **두 판정자 모두 모델(A: 메인 세션, B: 라벨을 보지 않은 독립 서브에이전트)이라 사람 확인이 필요하다.** 고칠 때는 TSV 의 `final` 열을 바꾸고 평가·시뮬레이션 스크립트를 다시 돌린다.')
    P.append('')
    agree = sum(p['label'] == p['label_b'] for p in pairs)
    P.append('## 1. 같은 사건 쌍 114개')
    P.append('')
    P.append('판정 기준: **Y** 같은 사건(같은 발표·같은 실적 공시의 다른 수치·공식 글과 그 보도·사건을 다시 말하는 분석 제목) / **R** 관련(후속·반응·해설·예고·같은 이야기의 다른 진전) / **N** 다른 사건(같은 형식의 다른 회사, 릴레이 캠페인의 다른 참여자, 같은 회사의 다른 소식).')
    P.append('')
    P.append(f'두 판정자 일치 {agree}/{len(pairs)}({agree / len(pairs) * 100:.0f}%), 불일치는 ⚠ 표시. final 분포: ' + ', '.join(f'{k} {v}' for k, v in sorted(Counter(p["final"] for p in pairs).items())))
    P.append('')
    P.append('표본: 72시간 안 기사 쌍을 유사도 층(S1 ≥0.6, S2 0.45~0.6, S3 0.35~0.45, S4 0.25~0.35, S5 0.15~0.25, E 유사도 낮지만 같은 회사, R 무작위)별로 무작위 추출. N = 그 층의 전체 쌍 수.')
    P.append('')
    P.append('| id | 층(N) | 기사 A | 기사 B | 시간차 | A | B | final |')
    P.append('|---|---|---|---|---|---|---|---|')
    for p in pairs:
        flag = ' ⚠' if p['label'] != p['label_b'] else ''
        P.append(f"| {p['pair_id']} | {p['stratum']}({p['N']}) | {md(p['a_title'])} · {md(p['a_source'], 10)} | {md(p['b_title'])} · {md(p['b_source'], 10)} | {p['hours_apart']}h | {p['label']} | {p['label_b']} | **{p['final']}**{flag} |")
    P.append('')
    P.append('## 2. 기사 중요도 94건')
    P.append('')
    P.append('기준(1~5): 5 반드시 볼 것(제도·회계·감독 변경, 대형 M&A, 주요 모델 출시) · 4 볼 만함(주요사 실적·전략, 중요 상품·규제 동향) · 3 참고(일반 상품·업계 동향) · 2 낮음(홍보·인사·행사·주가) · 1 무관. 보험 채널은 보험계리 실무자, AI 채널은 AI 실무자 관점. 현재 ★을 보지 않고 제목·출처만 보고 판정.')
    P.append('')
    ex = sum(x['label'] == x['label_b'] for x in imp)
    w1 = sum(abs(int(x['label']) - int(x['label_b'])) <= 1 for x in imp)
    P.append(f'두 판정자 완전 일치 {ex}/{len(imp)}({ex / len(imp) * 100:.0f}%), ±1 이내 {w1}/{len(imp)}. 표본: 채널·현재 ★ 층화(★4·5가 드물어 많이 뽑음).')
    P.append('')
    P.append('| id | 채널 | 제목 | 출처 | A | B |')
    P.append('|---|---|---|---|---|---|')
    for x in imp:
        P.append(f"| {x['item_id']} | {x['channel']} | {md(x['title'], 60)} | {md(x['source'], 12)} | {x['label']} | {x['label_b']} |")
    sys.stdout.write('\n'.join(P) + '\n')


if __name__ == '__main__':
    main()
