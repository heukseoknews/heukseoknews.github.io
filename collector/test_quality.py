"""python collector/test_quality.py — 품질 후처리 플래그·기록·되돌리기 테스트(임시 폴더만 사용)."""
import json
import shutil
import tempfile
from pathlib import Path

import channel
import quality

ROOT = Path(__file__).resolve().parent.parent
tmp = Path(tempfile.mkdtemp(prefix='quality-test-'))
try:
    rows = [
        {'id': 'a1', 'title': '현대해상, 성남시의료원에 ‘마음도서관’ 개관', 'url': 'https://e.com/1', 'source': '보험신보', 'source_type': 'media',
         'published_at': '2026-11-10T00:00:00+00:00', 'collected_at': '2026-11-10T01:00:00+00:00', 'category': '손해보험', 'sub_categories': [],
         'tags': [], 'score': 2, 'feed_name': 'x', 'relevant': True, 'companies': ['현대해상'], 'orgs': []},
        {'id': 'a2', 'title': '현대해상, 성남시의료원에 ‘마음도서관’ 문 열어', 'url': 'https://e.com/2', 'source': '핀포인트뉴스', 'source_type': 'media',
         'published_at': '2026-11-10T03:00:00+00:00', 'collected_at': '2026-11-10T04:00:00+00:00', 'category': '손해보험', 'sub_categories': [],
         'tags': [], 'score': 2, 'feed_name': 'x', 'relevant': True, 'companies': ['현대해상'], 'orgs': []},
        {'id': 'a3', 'title': '계리가정보고서 도입 등 보험업감독규정 개정안 금융위원회 의결', 'url': 'https://e.com/3', 'source': '금융위원회', 'source_type': 'press',
         'published_at': '2026-11-10T05:00:00+00:00', 'collected_at': '2026-11-10T06:00:00+00:00', 'category': '제도·회계·건전성', 'sub_categories': [],
         'tags': [], 'score': 5, 'feed_name': 'x', 'relevant': True, 'companies': [], 'orgs': []},
    ]
    data = tmp / 'data'
    data.mkdir()
    shard = data / '2026-11.json'
    original = json.dumps(rows, ensure_ascii=False, indent=1) + '\n'
    shard.write_text(original, encoding='utf-8')

    # 1) 실제 채널 설정(플래그 꺼짐): 아무것도 하지 않는다
    for ch in ('insurance', 'ai'):
        cd = channel.use(ch)
        assert quality.enabled(cd) == (False, False), f'{ch}: 기본값은 꺼짐'
        assert quality.run(data, cd) is None
        assert shard.read_text(encoding='utf-8') == original

    # 2) 플래그를 켠 설정 사본: 선택 필드만 덧붙고 기존 필드는 그대로
    cfg = tmp / 'cfg'
    shutil.copytree(ROOT / 'channels' / 'insurance', cfg)
    c = json.loads((cfg / 'cluster.json').read_text(encoding='utf-8')); c['enabled'] = True
    (cfg / 'cluster.json').write_text(json.dumps(c, ensure_ascii=False), encoding='utf-8')
    s = json.loads((cfg / 'score.json').read_text(encoding='utf-8')); s['v2']['enabled'] = True
    (cfg / 'score.json').write_text(json.dumps(s, ensure_ascii=False), encoding='utf-8')
    channel.use('insurance', cfg)
    summary = quality.run(data, cfg)
    assert summary['files_changed'] == 1 and summary['cluster']['groups'] == 1, summary
    out = {a['id']: a for a in json.loads(shard.read_text(encoding='utf-8'))}
    for a in rows:
        assert all(out[a['id']][k] == v for k, v in a.items()), '기존 필드는 바뀌지 않는다'
    assert out['a1']['cluster_id'] == out['a2']['cluster_id'] == 'a1' and out['a1']['cluster_size'] == 2 and out['a1']['cluster_sources'] == 2
    assert sum(1 for a in out.values() if a.get('cluster_lead')) == 1 and 'cluster_id' not in out['a3']
    assert out['a3']['score_v2'] == 5 and out['a1']['score_v2'] == out['a2']['score_v2'] == 2
    # 다시 돌려도 같다(멱등)
    snap = shard.read_text(encoding='utf-8')
    assert quality.run(data, cfg)['files_changed'] == 0 and shard.read_text(encoding='utf-8') == snap

    # 3) 시뮬레이션(force): 파일을 건드리지 않고 메모리에서만
    mem = json.loads(original)
    res = quality.compute(mem, ROOT / 'channels' / 'insurance', force=(True, True))
    assert 'cluster' in res and all('score_v2' in a for a in mem)
    assert shard.read_text(encoding='utf-8') == snap

    # 4) 되돌리기: 선택 필드를 지우면 원래 파일과 바이트가 같다
    assert quality.strip_all(data) == 3
    assert shard.read_text(encoding='utf-8') == original
finally:
    channel.use('insurance')
    shutil.rmtree(tmp, ignore_errors=True)

print('test_quality: ok')
