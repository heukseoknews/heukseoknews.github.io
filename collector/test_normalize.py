"""python collector/test_normalize.py"""
from normalize import SourceAliases, TitleFilter, strip_org_suffix

assert strip_org_suffix('보험정책 - 금융위원회') == '보험정책'
assert strip_org_suffix('보험모집질서 위반신고 - 금융감독원 - 금융감독원') == '보험모집질서 위반신고'
assert strip_org_suffix('실손24 안내 [금융프렌즈] - 금융위원회') == '실손24 안내 [금융프렌즈]'
assert strip_org_suffix('금융위원회 의결 개정안') == '금융위원회 의결 개정안'   # 제목 중간/앞의 기관명은 유지
assert strip_org_suffix('금융감독원 - 금융감독원') == '금융감독원 - 금융감독원'.replace(' - 금융감독원', '')
al = SourceAliases({'edaily.co.kr': '이데일리', 'mk.co.kr': '매일경제', 'hankyung.com': '한국경제'}, {'마켓인': '이데일리', '이데일리TV': '이데일리'})
assert al.resolve('마켓인', 'https://marketin.edaily.co.kr') == ('이데일리', True)   # 도메인 우선
assert al.resolve('한경매거진', 'https://magazine.hankyung.com') == ('한국경제', True)
assert al.resolve('이데일리TV') == ('이데일리', True)                               # 이름 매핑
assert al.resolve('서울경제TV', 'https://www.sentv.co.kr') == ('서울경제TV', False)  # 근거 없으면 그대로
assert al.resolve('한국경제') == ('한국경제', True)                                    # 이미 표준 이름
assert al.resolve('x', 'https://notedaily.co.kr')[1] is False                        # 접미 문자열만 같은 도메인은 불일치
print('normalize tests passed')

# 기존 월 파일 정리: 정규화로 같아진 기사 합치기(직접 링크 우선, 수집시각은 이른 쪽)
import json, tempfile
from pathlib import Path
from normalize import normalize_shards
mk = lambda id, url, src, col: {'id': id, 'title': 'T - 금융위원회', 'url': url, 'source': src, 'source_type': 'media', 'published_at': '2026-11-01T00:00:00+00:00', 'collected_at': col}
with tempfile.TemporaryDirectory() as d:
    pth = Path(d) / '2026-11.json'
    pth.write_text(json.dumps([mk('1', 'https://news.google.com/rss/articles/x', '마켓인', '2026-11-02'), mk('2', 'https://marketin.edaily.co.kr/a', '이데일리', '2026-11-03')]), encoding='utf-8')
    assert normalize_shards(Path(d), al) == 1
    rows = json.loads(pth.read_text(encoding='utf-8'))
    assert len(rows) == 1 and rows[0]['id'] == '2' and rows[0]['title'] == 'T' and rows[0]['collected_at'] == '2026-11-02'
    assert normalize_shards(Path(d), al) == 0  # 멱등
print('shard normalize tests passed')

# 제목 필터: 메뉴/목록 페이지 이름만 있는 제목 제외, 정상 제목은 유지
tf = TitleFilter(6, ['보험정책'])
assert tf.is_junk('보험정책') and tf.is_junk('보 험 정 책') and tf.is_junk('공지') and tf.is_junk('보험정책 ')
assert not tf.is_junk('보험모집질서 위반신고') and not tf.is_junk('실손24 안내')
import json as _j
real = TitleFilter.load(Path(__file__).resolve().parent.parent / 'config' / 'title_filters.json')
assert real.is_junk('보험모집질서 위반신고') and real.is_junk('보험정책') and not real.is_junk('보험모집질서 개선 토론회')
with tempfile.TemporaryDirectory() as d:
    pth = Path(d) / '2026-11.json'
    pth.write_text(json.dumps([mk('1', 'https://a.com/1', '금융위원회', '2026-11-02') | {'title': '보험정책 - 금융위원회', 'source_type': 'press'}, mk('2', 'https://a.com/2', '금융위원회', '2026-11-02') | {'title': '실손24 확대 시행'}]), encoding='utf-8')
    normalize_shards(Path(d), al, tf)
    assert [r['id'] for r in json.loads(pth.read_text(encoding='utf-8'))] == ['2']
print('title filter tests passed')
