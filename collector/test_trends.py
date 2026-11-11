"""python collector/test_trends.py"""
from trends import compute, week_start

# KST 경계: 일요일 23:30 KST(=14:30Z)는 그 주, 월요일 00:30 KST(=15:30Z 일요일)는 다음 주
assert week_start('2026-11-01T14:30:00+00:00') == '2026-10-26'  # 일 23:30 KST
assert week_start('2026-11-01T15:30:00+00:00') == '2026-11-02'  # 월 00:30 KST
assert week_start('2026-11-04T10:00:00+00:00') == '2026-11-02'

kw = [{'name': 'K-ICS', 'terms': ['k-ics', 'kics']}, {'name': '금리', 'terms': ['금리']}]
arts = [
    {'title': 'K-ICS 완화…금리 영향', 'published_at': '2026-11-03T01:00:00+00:00'},
    {'title': 'KICS 비율 발표', 'published_at': '2026-11-04T01:00:00+00:00'},
    {'title': '무관한 기사', 'published_at': '2026-10-28T01:00:00+00:00'},
]
w = compute(arts, kw)
assert [x['week_start'] for x in w] == ['2026-10-26', '2026-11-02']
assert w[1]['counts'] == {'K-ICS': 2, '금리': 1} and w[1]['total'] == 2
assert w[0]['counts'] == {'K-ICS': 0, '금리': 0}
print('trends tests passed')
