"""python collector/test_cluster.py — 같은 사건 묶기 단위 테스트(실제 수집 제목 표본, 한국어·영어, 경계 사례)."""
import copy
from datetime import datetime, timedelta, timezone

import cluster

T0 = datetime(2026, 11, 10, 0, 0, tzinfo=timezone.utc)
CFG = {**cluster.DEFAULTS, 'enabled': True}


def art(i, title, source, hours=0.0, companies=(), press=False, url=None):
    return {'id': f'a{i:03d}', 'title': title, 'source': source, 'source_type': 'press' if press else 'media',
            'url': url or f'https://example.com/{i}', 'published_at': (T0 + timedelta(hours=hours)).isoformat(),
            'score': 2, 'relevant': True, 'companies': list(companies)}


def groups(rows):
    g = {}
    for a in rows:
        g.setdefault(a.get('cluster_id') or a['id'], set()).add(a['id'])
    return sorted(sorted(v) for v in g.values())


def same(rows, x, y):
    by = {a['id']: a for a in rows}
    return bool(by[x].get('cluster_id')) and by[x].get('cluster_id') == by[y].get('cluster_id')


# 1) 정규화·토큰
assert cluster.normalize('[포토] DB생명, 봉사활동 진행 - 머니투데이', '머니투데이') == 'db생명, 봉사활동 진행'
assert cluster.normalize('한화손보, 3분기 순이익 961억 (종합)') == '한화손보, 3분기 순이익 961억'
tk = cluster.tokens('한화손보, 3분기 순이익 961억⋯전년비 34.1%↑')
assert '#961억' in tk and '#34.1%' in tk and '#3분기' in tk and '순이' in tk
assert cluster.stem('launches') == cluster.stem('launched') == cluster.stem('launch') == 'launch'
assert cluster.stem('releases') == cluster.stem('release') == cluster.stem('released')
assert 'meta' in cluster.tokens('Meta releases Muse Ember') and 'the' not in cluster.tokens('The model')

# 2) 실제 표본: 같은 사건은 묶이고, 같은 형식의 다른 회사·같은 매체 정형 제목은 묶이지 않는다
rows = [
    art(1, '현대해상, 성남시의료원에 ‘마음도서관’ 개관', '보험신보', 0, ['현대해상']),
    art(2, '현대해상, 성남시의료원에 ‘마음도서관’ 문 열어', '핀포인트뉴스', 3, ['현대해상']),
    art(3, '[보험 뉴스브리핑] 현대해상 성남시의료원 \'마음도서관\' 개관', '아시아타임즈', 7, ['현대해상']),
    art(4, '한화손보, 3분기 순이익 961억⋯전년비 34.1%↑', '이투데이', 1, ['한화손해보험']),
    art(5, '한화손보, 3분기 순익 961억원…지난해보다 34%↑', 'SBS Biz', 2, ['한화손해보험']),
    art(6, '메리츠화재, 3분기 순익 3285억원…전년 대비 29.2%↓', '더팩트', 2, ['메리츠화재']),
    art(7, '메리츠화재, 3분기 순익 3285억⋯전년比 29.2%↓', '이투데이', 4, ['메리츠화재']),
    art(8, 'Meta releases Muse Ember, a new lightweight model for agent execution', 'TechCrunch', 0, ['Meta']),
    art(9, 'Meta releases Muse Ember, a lightweight model for agent execution', 'news.lavx.hu', 3, ['Meta']),
    art(10, 'Meta Launches Muse Ember, Lightweight AI Model for Agent Execution', 'Analytics Insight', 12, ['Meta']),
    art(11, 'Case Study - Rakuten', 'Anthropic', 0, press=True),
    art(12, 'Case Study - Lilly', 'Anthropic', 0, press=True),
    art(13, 'Case Study - Walmart', 'Anthropic', 0, press=True),
    art(14, '자동차보험 \'8주룰\' 심사 본격화…손해율 개선 효과 주목', '데일리안', 5),
]
r = copy.deepcopy(rows)
s = cluster.assign(r, CFG)
assert same(r, 'a001', 'a002') and same(r, 'a001', 'a003'), groups(r)
assert same(r, 'a004', 'a005') and same(r, 'a006', 'a007'), groups(r)
assert not same(r, 'a004', 'a006'), '다른 회사 실적은 묶지 않는다(회사 거부)'
assert same(r, 'a008', 'a009') and same(r, 'a008', 'a010'), groups(r)
assert not same(r, 'a011', 'a012') and not same(r, 'a011', 'a013'), '같은 매체 정형 제목은 묶지 않는다'
assert 'cluster_id' not in next(a for a in r if a['id'] == 'a014'), '혼자인 기사에는 묶음 필드를 쓰지 않는다'
by = {a['id']: a for a in r}
assert by['a001']['cluster_id'] == 'a001' and by['a001']['cluster_size'] == 3 and by['a001']['cluster_sources'] == 3
assert s['groups'] == 4 and s['clustered'] == 10, s

# 3) 회사 거부 끄면 같은 형식의 다른 회사 실적이 묶일 수 있다(설정이 실제로 쓰이는지)
r2 = copy.deepcopy(rows)
cluster.assign(r2, {**CFG, 'company_veto': False, 'threshold': 0.2})
assert same(r2, 'a004', 'a006')

# 4) 시간 창: 72시간 밖이면 같은 제목이어도 따로
r3 = [art(1, '삼성화재, 영국 캐노피우스 경영권 인수', 'A', 0, ['삼성화재']), art(2, '삼성화재, 영국 캐노피우스 경영권 인수', 'B', 80, ['삼성화재'])]
cluster.assign(r3, CFG)
assert not same(r3, 'a001', 'a002')
r3b = copy.deepcopy(r3)
cluster.assign(r3b, {**CFG, 'window_hours': 96})
assert same(r3b, 'a001', 'a002')

# 5) 증분 안정성: 이미 묶인 id 는 다음 실행에서 바뀌지 않고, 새 기사는 기존 묶음에 붙는다. 같은 입력이면 결과가 같다(멱등)
r4 = copy.deepcopy(rows[:3])
cluster.assign(r4, CFG)
first = {a['id']: a['cluster_id'] for a in r4}
r4.append(art(20, '현대해상, 성남시의료원에 마음도서관 개관…34번째', '뉴스1', 20, ['현대해상']))
cluster.assign(r4, CFG)
assert all(a['cluster_id'] == first[a['id']] for a in r4 if a['id'] in first)
assert next(a for a in r4 if a['id'] == 'a020')['cluster_id'] == 'a001'
snap = copy.deepcopy(r4)
cluster.assign(r4, CFG)
assert r4 == snap

# 5-1) 시간 폭 상한: 묶음 첫 기사에서 max_span_hours 를 넘으면 이어 붙지 않는다(창 안이라도)
r7 = [art(k, f'현대해상, 성남시의료원에 마음도서관 개관 {k}', f'S{k}', 50 * k, ['현대해상']) for k in range(3)]
cluster.assign(r7, CFG)
assert same(r7, 'a000', 'a001') and not same(r7, 'a000', 'a002'), groups(r7)   # 0h·50h 는 묶이고 100h 는 96h 폭 밖

# 5-2) 합치기: 고정 묶음 옆에 새 묶음이 생기면 고정 묶음 id 로 합친다. 고정 묶음끼리는 합치지 않는다
f1 = [art(1, '삼성화재, 영국 캐노피우스 지분 80%로 확대', 'A', 0, ['삼성화재']), art(2, '삼성화재, 영국 캐노피우스 지분 확대 추진', 'B', 1, ['삼성화재'])]
for a in f1:
    a.update(cluster_id='a001', cluster_size=2, cluster_sources=2)
new = [art(3, '삼성화재 캐노피우스 경영권 인수 2.3조', 'C', 5, ['삼성화재']), art(4, '삼성화재, 2.3조 들여 캐노피우스 경영권 인수', 'D', 6, ['삼성화재'])]
r8 = f1 + new
cluster.assign(r8, {**CFG, 'threshold': 0.9, 'merge_threshold': 0.2})   # 기사-묶음 기준을 높여 새 묶음이 따로 생기게 한 뒤 합치기 확인
assert all(a['cluster_id'] == 'a001' for a in r8), [(a['id'], a.get('cluster_id')) for a in r8]
f2 = copy.deepcopy(new)
for a in f2:
    a.update(cluster_id='a003', cluster_size=2, cluster_sources=2)
r9 = copy.deepcopy(f1) + f2
cluster.assign(r9, {**CFG, 'merge_threshold': 0.2})
assert {a['cluster_id'] for a in r9} == {'a001', 'a003'}, '고정 묶음끼리는 합치지 않음(id 불변)'

# 6) lookback 밖의 묶이지 않은 기사는 판정하지 않는다
r5 = [art(1, '삼성화재, 영국 캐노피우스 경영권 인수', 'A', 0, ['삼성화재']), art(2, '삼성화재, 영국 캐노피우스 경영권 인수', 'B', 1, ['삼성화재'])]
cluster.assign(r5, CFG, now=T0 + timedelta(days=30))
assert not any('cluster_id' in a for a in r5)

# 7) 대표 기사: 공식 발표 > 높은 점수 > 직접 링크 > 먼저 발행
r6 = [art(1, 'Meta releases Muse Ember', 'TechCrunch', 1, ['Meta']),
      art(2, 'Introducing Muse Ember, our most efficient model', 'Meta AI', 2, ['Meta'], press=True),
      art(3, 'Meta releases Muse Ember model', 'X', 0, ['Meta'], url='https://news.google.com/x')]
for a in r6:
    a.update(cluster_id='a001', cluster_size=3, cluster_sources=3)
assert cluster.mark_leads(r6) == 1
assert [a['id'] for a in r6 if a.get('cluster_lead')] == ['a002']
r6[1]['source_type'] = 'media'
cluster.mark_leads(r6)
assert [a['id'] for a in r6 if a.get('cluster_lead')] == ['a001'], '직접 링크가 구글 링크보다 우선(점수 같을 때)'
r6[2]['score'] = 3
cluster.mark_leads(r6)
assert [a['id'] for a in r6 if a.get('cluster_lead')] == ['a003'], '점수가 높으면 우선'

# 8) 되돌리기
assert cluster.strip(r6) == 3 and not any(k in a for a in r6 for k in cluster.FIELDS)

# 9) 빈 입력
assert cluster.assign([], CFG)['groups'] == 0

print('test_cluster: ok')
