"""게시판 추출기·관련도 판정·차단 목록·상태 표시 단위 테스트(네트워크 없음). 실행: python collector/test_boards.py"""
import json, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import collect
from boards import parse_fsc, parse_fss, day_to_utc

FSC = '''<ul><li><div class="inner"><div class="count">1</div><div class="cont"><div class="subject">
<a href="/no010101/88104?srchCtgry=&amp;curPage=&amp;srchKey=" title="보험사 지급여력 제도 개선 방안">x</a></div>
<div class="info"><span>담당부서 : 보험과</span><span>조회수 : 9</span></div>
<div class="file"><a href="/comm/getFile?srvcId=BBSTY1&amp;upperNo=88104&amp;fileNo=5">261108 보도자료.hwpx</a></div></div>
<div class="day">2026-11-09</div></div></li>
<li><div class="inner"><div class="cont"><div class="subject"><a href="/no010101/88100?x=1">코리아 핀테크 위크 개막</a></div>
<div class="info"><span>담당부서 : 디지털금융총괄과</span></div></div><div class="day">2026-11-08</div></div></li></ul>'''
FSS = '''<table><tbody><tr><td class="num">20989</td><td class="title"><a href="/fss/bbs/B0000188/view.do?nttId=249804&amp;menuNo=200218&amp;pageIndex=1">2026년 10월 가계대출 동향(잠정)</a></td>
<td>은행리스크감독국/보험감독국</td><td> 2026-11-11 </td><td><a href="/fss/cmmn/file/fileDown.do?atchFileId=a">파일.pdf</a></td></tr>
<tr><td>공지</td><td class="title"><a href="/fss/bbs/B0000188/view.do?menuNo=200218">nttId 없는 링크</a></td><td>x</td><td>2026-11-10</td></tr></tbody></table>'''

fsc = parse_fsc(FSC)
assert [x['url'] for x in fsc] == ['https://www.fsc.go.kr/no010101/88104', 'https://www.fsc.go.kr/no010101/88100'], '금융위 영구 링크(쿼리 제거)'
assert fsc[0]['title'] == '보험사 지급여력 제도 개선 방안' and fsc[0]['department'] == '보험과' and fsc[1]['department'] == '디지털금융총괄과'
assert fsc[0]['published'] == day_to_utc(2026, 11, 9) == '2026-11-09T00:00:00+00:00', '한국 시간 09:00 = UTC 00:00'
fss = parse_fss(FSS)
assert len(fss) == 1 and fss[0]['url'] == 'https://www.fss.or.kr/fss/bbs/B0000188/view.do?nttId=249804&menuNo=200218', '금감원 영구 링크(pageIndex 제거), nttId 없는 행 제외'
assert fss[0]['published'] == day_to_utc(2026, 11, 11) and fss[0]['department'].startswith('은행리스크')
assert parse_fsc('<html>구조 바뀜</html>') == [] and parse_fss('') == []

# 관련도: 담당부서 '보험과'는 항상 relevant, 보험 단어 없는 감독당국 글은 관련도 낮음(버리지 않음, 미분류)
collect.RELEVANT_DEPTS.add('보험과')
rel, c = collect.judge('코리아 핀테크 위크 개막', 'press', '금융위원회 게시판', None)
assert rel is False and c['category'] == '미분류' and c['sub_categories'] == []
rel, c = collect.judge('전자금융 관련 개선 방안', 'press', '금융위원회 게시판', '보험과')
assert rel is True, '보험과 글은 항상 관련 있음'
rel, c = collect.judge('실손보험 청구 간소화 확대', 'press', '금융위원회 게시판', None)
assert rel is True and c['category'] != '미분류'
a = collect.make_article('코리아 핀테크 위크 개막', 'https://www.fsc.go.kr/no010101/88100', '금융위원회', 'press', fsc[1]['published'], 'now', '금융위원회 게시판', '디지털금융총괄과')
assert a['relevant'] is False and a['department'] == '디지털금융총괄과' and a['category'] == '미분류'

# 같은 글: 공식 게시판 링크가 구글 중간 링크보다 우선, 관련 있음이 관련도 낮음보다 우선
from normalize import prefer
g = {**a, 'url': 'https://news.google.com/rss/articles/abc', 'source_type': 'press'}
assert prefer(g, a) is a and prefer(a, g) is a
lo, hi = {**a, 'relevant': False}, {**a, 'relevant': True}
assert prefer(lo, hi) is hi

# 차단 목록
b = collect.Blocked({'Vietnam.vn': '잡음'})
assert b.is_blocked('vietnam.VN') and not b.is_blocked('한국경제')

# 상태: RSS 503 + 게시판 성공이면 '참고'로 표시(실패 목록에서 제외), 쿼리 상한 도달은 분할 필요 표시
with tempfile.TemporaryDirectory() as d:
    res = {'금융위원회 RSS': {'ok': False, 'error': 'HTTPError: 503'}, '금융위원회 게시판': {'ok': True, 'kept': 3, 'entries': 20, 'source': '금융위원회', 'blocked': {'Vietnam.vn': 2}},
           '보험 쿼리': {'ok': True, 'kept': 100, 'entries': 100}, '금융감독원 게시판': {'ok': False, 'error': 'ValueError: 구조 변경 의심', 'source': '금융감독원'}}
    names = ['금융위원회 RSS', '보험 쿼리', '금융위원회 게시판', '금융감독원 게시판']
    collect.write_status(Path(d), '2026-11-11T00:00:00+00:00', res, 1, 0, names, {'보험 쿼리'}, {'금융위원회 게시판', '금융감독원 게시판'})
    st = json.loads((Path(d) / 'status.json').read_text(encoding='utf-8'))
    assert st['sources']['금융위원회 RSS']['note'] == '점검 중(게시판으로 대체 수집)'
    assert st['last_run']['failed'] == ['금융감독원 게시판'] and st['last_run']['noted'] == ['금융위원회 RSS'], '구조 변경 의심은 실패로 남음'
    assert st['sources']['보험 쿼리']['needs_split'] is True and st['sources']['금융위원회 게시판']['kind'] == 'board'
    assert st['last_run']['blocked'] == {'Vietnam.vn': 2}

# reclassify 안전: relevant 없는 예전 기사는 true 로 이전, 관련도 낮은 기사는 재실행해도 그대로
with tempfile.TemporaryDirectory() as d:
    old = {'id': '1', 'title': '실손보험 청구 간소화', 'url': 'https://x/1', 'source': '보험매일', 'source_type': 'media', 'published_at': '2026-11-01T00:00:00+00:00', 'collected_at': 'c', 'category': '손해보험', 'sub_categories': [], 'tags': [], 'score': 3, 'feed_name': '보험매일'}
    low = {**collect.make_article('코리아 핀테크 위크 개막', 'https://www.fsc.go.kr/no010101/9', '금융위원회', 'press', '2026-11-01T00:00:00+00:00', 'c', '금융위원회 게시판'), }
    (Path(d) / '2026-11.json').write_text(json.dumps([old, low], ensure_ascii=False), encoding='utf-8')
    for _ in range(2):
        collect.reclassify(Path(d))
        rows = json.loads((Path(d) / '2026-11.json').read_text(encoding='utf-8'))
        assert rows[0]['relevant'] is True and rows[1]['relevant'] is False and rows[1]['category'] == '미분류'
# 검색 피드 기사 나이 상한(max_age_days): 오래된 글은 저장하지 않고, 상한이 없으면 모두 저장
RSS = '''<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>실손보험 청구 간소화 - 한국경제</title><link>https://example.com/new</link><pubDate>Mon, 09 Nov 2026 01:00:00 GMT</pubDate></item>
<item><title>실손보험 옛 기사 - 한국경제</title><link>https://example.com/old</link><pubDate>Wed, 01 Mar 2017 01:00:00 GMT</pubDate></item></channel></rss>'''
class FakeResp:
    content = RSS.encode()
    def raise_for_status(self): pass
collect.requests.get = lambda *a, **k: FakeResp()
row = ('테스트 검색', 'https://example.com/rss', 'media', None)
out, st = collect.collect_source(row, '2026-11-11T00:00:00+00:00', max_age_days=180)
assert [a['url'] for a in out] == ['https://example.com/new'] and st['skipped']['too_old'] == 1
out, st = collect.collect_source(row, '2026-11-11T00:00:00+00:00')
assert len(out) == 2 and 'too_old' not in st['skipped']
print('boards tests passed')
