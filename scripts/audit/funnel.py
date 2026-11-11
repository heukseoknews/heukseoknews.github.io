"""수집 퍼널·소스 표·데이터 통계를 data/status.json 과 data/*.json 에서 뽑는다(읽기 전용, docs/architecture.md 의 숫자 근거).

  python scripts/audit/funnel.py            # 마크다운 표를 표준출력으로

퍼널: 피드 항목 → (링크·날짜 없음) → (오래된 글 차단) → (노이즈 제목) → (출처 차단) → 소스별 후보(kept) → 소스 간 중복 제거 → candidates → 기존 저장분과 중복 → 신규 저장(added).
kept 에는 관련도 낮음(relevant=false)이 포함된다(버리지 않고 저장). 출처 차단 건수는 소스별이 아니라 실행 전체 합계만 status.json 에 남는다.
"""
import glob, json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
st = json.loads((ROOT / 'data' / 'status.json').read_text(encoding='utf-8'))
arts = [a for f in sorted(glob.glob(str(ROOT / 'data' / '????-??.json'))) for a in json.loads(Path(f).read_text(encoding='utf-8'))]
run, src = st['last_run'], st['sources']
KIND = {'rss': 'RSS', 'search': '구글 뉴스 검색', 'board': 'HTML 게시판'}

print('## 퍼널(최근 실행)')
print(f"- 실행 시작 {run['started_at']} / 종료 {run['finished_at']}")
tot = Counter()
for s in src.values():
    if not s['ok']:
        continue
    k = s['skipped']
    tot['entries'] += s['entries']; tot['nolink'] += k.get('no_link', 0) + k.get('no_date', 0); tot['old'] += k.get('too_old', 0)
    tot['junk'] += k.get('junk_title', 0); tot['kept'] += s['kept']; tot['low'] += k.get('low_relevance', 0)
blocked = sum(run.get('blocked', {}).values())
tot['blocked'] = blocked
dedupe = tot['kept'] - run['candidates']
print()
print('| 단계 | 건수 | 비고 |\n|---|---:|---|')
print(f"| 소스가 준 항목(피드 항목 합) | {tot['entries']} | 성공한 소스만 |")
print(f"| − 링크·날짜 없음 | {tot['nolink']} | |")
print(f"| − 오래된 글 차단(검색 피드 180일) | {tot['old']} | max_age_days |")
print(f"| − 노이즈 제목(title_filters) | {tot['junk']} | |")
print(f"| − 출처 차단(blocked_sources) | {blocked} | {', '.join(f'{k} {v}' for k, v in run.get('blocked', {}).items())} |")
print(f"| = 소스별 후보(kept 합) | {tot['kept']} | 이 중 관련도 낮음 {tot['low']}건 포함 |")
print(f"| − 소스 간 중복 제거(제목+출처, 직접 링크 우선) | {dedupe} | |")
print(f"| = 후보(candidates) | {run['candidates']} | |")
print(f"| − 이미 저장된 기사와 중복 | {run['candidates'] - run['added']} | |")
print(f"| = 신규 저장(added) | {run['added']} | |")
print(f"\n(검산: {tot['entries']} − {tot['nolink']} − {tot['old']} − {tot['junk']} − {blocked} = {tot['entries'] - tot['nolink'] - tot['old'] - tot['junk'] - blocked}, kept 합 {tot['kept']})")

print('\n## 소스별')
print('| 소스 | 종류 | 상태 | 피드 항목 | 링크·날짜 없음 | 오래된 글 | 노이즈 제목 | 후보(kept) | 관련도 낮음 | 상한(100/50) | 쿼리 분할 필요 | 저장분 중 이 소스 |')
print('|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|')
stored = Counter(a['feed_name'] for a in arts)
for n, s in src.items():
    k = s['skipped']
    state = '성공' if s['ok'] else ('참고: ' + s['note'] if s.get('note') else '실패: ' + (s.get('error') or ''))
    print(f"| {n} | {KIND.get(s.get('kind'), s.get('kind'))} | {state} | {s['entries']} | {k.get('no_link', 0) + k.get('no_date', 0)} | {k.get('too_old', 0)} | {k.get('junk_title', 0)} | {s['kept']} | {k.get('low_relevance', 0)} | {'도달' if s['at_limit'] else '-'} | {'예' if s.get('needs_split') else '-'} | {stored.get(n, 0)} |")

print('\n## 저장 데이터 통계')
rel = [a for a in arts if a.get('relevant', True)]
print(f"- 전체 {len(arts)}건, 관련 {len(rel)}건, 관련도 낮음 {len(arts) - len(rel)}건")
print('- 월 파일: ' + ', '.join(f"{p.stem} {p.stat().st_size // 1024}KB" for p in sorted((ROOT / 'data').glob('????-??.json'))))
print('- 카테고리(관련): ' + ', '.join(f'{c} {n}' for c, n in Counter(a['category'] for a in rel).most_common()))
print('- 출처 구분: ' + ', '.join(f'{c} {n}' for c, n in Counter(a['source_type'] for a in arts).most_common()))
print(f"- companies 매칭 {sum(1 for a in arts if a.get('companies'))}건, orgs 매칭 {sum(1 for a in arts if a.get('orgs'))}건, 구글 링크 {sum(1 for a in arts if 'news.google.com' in a['url'])}건")
print('- ★ 분포(관련): ' + ', '.join(f'★{k} {v}' for k, v in sorted(Counter(a['score'] for a in rel).items())))
print('- 필드별 채움: ' + ', '.join(f"{k} {sum(1 for a in arts if k in a)}" for k in ['relevant', 'companies', 'orgs', 'department', 'sub_categories']))
print('- 상위 출처(언론사): ' + ', '.join(f'{c} {n}' for c, n in Counter(a['source'] for a in arts if a['source_type'] == 'media').most_common(10)))
