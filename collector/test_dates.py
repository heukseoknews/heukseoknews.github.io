"""python collector/test_dates.py — 피드 날짜 해석(dates.parse)·collect.parse_date·게시판 날짜 없음 집계 테스트."""
import time

import boards
import collect
import dates

U = lambda raw, tz='Asia/Seoul': (lambda d: d and dates.to_utc_iso(d))(dates.parse(raw, tz))

# 1) 파이낸셜뉴스 실제 형식(쉼표 뒤 공백 없음) — feedparser 는 읽지 못한다
assert U('Thu,12 Nov 2026 10:01:20 +0900') == '2026-11-12T01:01:20+00:00'
# RFC 822 변형: 표준형, 공백 여러 개, 요일 없음, 요일 전체 이름, 초 없음, 소문자
assert U('Thu, 12 Nov 2026 10:01:20 +0900') == '2026-11-12T01:01:20+00:00'
assert U('Thu,  12  Nov 2026  10:01:20   +0900') == '2026-11-12T01:01:20+00:00'
assert U('12 Nov 2026 10:01:20 +0900') == '2026-11-12T01:01:20+00:00'
assert U('Thursday, 12 Nov 2026 10:01 +0900') == '2026-11-12T01:01:00+00:00'
assert U('thu, 12 nov 2026 10:01:20 gmt') == '2026-11-12T10:01:20+00:00'
# RFC 850(2자리 연도)
assert U('Thursday, 12-Nov-26 10:00:00 GMT') == '2026-11-12T10:00:00+00:00'
# 타임존 표기 변형
assert U('Thu, 12 Nov 2026 10:00:00 +09:00') == '2026-11-12T01:00:00+00:00'
assert U('Thu,12 Nov 2026 10:00:00 GMT+9') == '2026-11-12T01:00:00+00:00'
assert U('Thu, 12 Nov 2026 10:00:00 UTC+09:00') == '2026-11-12T01:00:00+00:00'
assert U('Thu, 12 Nov 2026 10:00:00 GMT+0900') == '2026-11-12T01:00:00+00:00'
assert U('Thu, 12 Nov 2026 10:00:00 KST') == '2026-11-12T01:00:00+00:00'
assert U('Thu, 12 Nov 2026 10:00:00 UTC') == '2026-11-12T10:00:00+00:00'
assert U('Thu, 12 Nov 2026 05:00:00 EST') == '2026-11-12T10:00:00+00:00'
assert U('Thu, 12 Nov 2026 10:00:00 -0000') == '2026-11-12T10:00:00+00:00'   # RFC '모름' = UTC(이전 동작)
# 타임존 없는 RFC 822 → 피드 현지 시각
assert U('Thu, 12 Nov 2026 10:00:00') == '2026-11-12T01:00:00+00:00'
assert U('Thu, 12 Nov 2026 10:00:00', 'UTC') == '2026-11-12T10:00:00+00:00'
# ISO 8601
assert U('2026-11-12T10:00:00+09:00') == '2026-11-12T01:00:00+00:00'
assert U('2026-11-12T01:00:00Z') == '2026-11-12T01:00:00+00:00'
assert U('2026-11-12T01:00:00.123Z') == '2026-11-12T01:00:00.123000+00:00'
assert U('2026-11-12T10:00:00') == '2026-11-12T01:00:00+00:00'                  # 타임존 없음 → 현지
# 숫자 날짜(국내 CMS) — feedparser 는 '2026.11.12 10:00' 을 11월 1일 00:00 으로 잘못 읽는다
assert U('2026-11-12 10:00:00') == '2026-11-12T01:00:00+00:00'
assert U('2026.11.12 10:00') == '2026-11-12T01:00:00+00:00'
assert U('2026/11/12 10:00:00', 'America/New_York') == '2026-11-12T15:00:00+00:00'
assert U('2026-11-12') == '2026-11-11T15:00:00+00:00'                            # 날짜만 → 현지 자정
# 읽지 못하는 값
for bad in ['', None, '어제', 'not a date', '2026-13-45 10:00', 'Thu, 45 Nov 2026 10:00:00 +0900']:
    assert dates.parse(bad) is None, bad

# 2) collect.parse_date: 원문을 먼저 읽고, 못 읽으면 feedparser 결과(이전 동작)
fn = {'published': 'Thu,12 Nov 2026 10:01:20 +0900'}                              # feedparser published_parsed 없음
assert collect.parse_date(fn) == '2026-11-12T01:01:20+00:00'
wrong = {'published': '2026.11.12 10:00', 'published_parsed': time.strptime('2026-11-01 00:00', '%Y-%m-%d %H:%M')}
assert collect.parse_date(wrong) == '2026-11-12T01:00:00+00:00'                   # feedparser 오판 대신 원문
only_parsed = {'published': '어제 오후', 'published_parsed': time.strptime('2026-11-20 09:00:00', '%Y-%m-%d %H:%M:%S')}
assert collect.parse_date(only_parsed) == '2026-11-20T00:00:00+00:00'             # 원문을 못 읽으면 feedparser 값(기존 규칙)
assert collect.parse_date({'published': '어제 오후'}) is None
assert collect.parse_date({'updated': 'Fri, 20 Nov 2026 09:00:00 GMT'}) == '2026-11-20T09:00:00+00:00'

# 3) 게시판: 날짜를 읽지 못한 글은 건너뛰되 stats 에 센다
html = '''<ul><li><div class="inner"><div class="subject"><a href="/no010101/1" title="보험업감독규정 개정">x</a></div><div class="day">2026-11-12</div></div></li>
<li><div class="inner"><div class="subject"><a href="/no010101/2" title="날짜 없는 글">y</a></div><div class="day">-</div></div></li></ul>'''
st = {}
rows = boards.parse_fsc(html, stats=st)
assert len(rows) == 1 and st == {'no_date': 1}
assert len(boards.parse_fsc(html)) == 1                                           # stats 없이도 이전과 같게 동작

print('test_dates: ok')
