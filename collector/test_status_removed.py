"""python collector/test_status_removed.py — 수집 중 기존 데이터 정규화(normalize_shards)로 지운 기사를 status.json normalize_removed 에 남김(최근 50건)."""
import json
import shutil
import tempfile
from pathlib import Path

import collect
from normalize import SourceAliases, TitleFilter


def art(i, title, source, url=None):
    return {'id': i, 'title': title, 'url': url or f'https://news.google.com/rss/articles/{i}', 'source': source, 'source_type': 'media',
            'published_at': '2026-11-10T00:00:00+00:00', 'collected_at': f'2026-11-10T0{i[-1]}:00:00+00:00', 'category': '미분류',
            'sub_categories': [], 'tags': [], 'score': 2, 'feed_name': 'x', 'relevant': True, 'companies': [], 'orgs': []}


tmp = Path(tempfile.mkdtemp(prefix='status-removed-'))
try:
    d = tmp / 'data'
    d.mkdir()
    rows = [art('k1', '보도자료', '금융위원회'),                                   # 노이즈 제목
            art('m1', '보험사 실적 같은 제목', 'FETV'),
            art('m2', '보험사 실적 같은 제목', 'www.fetv.co.kr', 'https://www.fetv.co.kr/news/1'),   # 정규화 뒤 m1 과 같아짐(직접 링크가 남음)
            art('s3', '그대로 남는 기사', '보험매일')]
    (d / '2026-11.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    removed: list = []
    collect.save([], d, SourceAliases(names={'www.fetv.co.kr': 'FETV'}), TitleFilter(exact=['보도자료']), removed)
    assert sorted((r['id'], r['reason'], r.get('kept_id')) for r in removed) == [('k1', 'junk_title', None), ('m1', 'merged', 'm2')], removed
    assert all(r['month'] == '2026-11' and r['title'] for r in removed)
    left = {a['id'] for a in json.loads((d / '2026-11.json').read_text(encoding='utf-8'))}
    assert left == {'m2', 's3'}, left

    # status.json: 이번 기록 + 이전 기록, 새 것 먼저, 최근 50건까지. 기록이 없으면 이전 것을 유지
    collect.write_status(d, '2026-11-10T00:00:00+00:00', {}, 0, 0, [], set(), set(), None, removed)
    st = json.loads((d / 'status.json').read_text(encoding='utf-8'))
    assert [r['id'] for r in st['normalize_removed']] == [r['id'] for r in removed] and st['normalize_removed'][0]['at'] == '2026-11-10T00:00:00+00:00'
    many = [{'month': '2026-11', 'id': f'x{i}', 'title': 't', 'source': 's', 'reason': 'junk_title'} for i in range(60)]
    collect.write_status(d, '2026-11-11T00:00:00+00:00', {}, 0, 0, [], set(), set(), None, many)
    st = json.loads((d / 'status.json').read_text(encoding='utf-8'))
    assert len(st['normalize_removed']) == collect.NORMALIZE_LOG == 50 and st['normalize_removed'][0]['id'] == 'x0'
    collect.write_status(d, '2026-11-12T00:00:00+00:00', {}, 0, 0, [], set(), set())
    assert json.loads((d / 'status.json').read_text(encoding='utf-8'))['normalize_removed'][0]['id'] == 'x0', '기록 없는 실행은 이전 기록 유지'
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('test_status_removed: ok')
