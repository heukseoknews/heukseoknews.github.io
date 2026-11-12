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
    index = data / 'index.json'
    index_orig = json.dumps({'updated_at': '2026-11-10T06:00:00+00:00', 'months': [{'month': '2026-11', 'count': 3, 'bytes': shard.stat().st_size}]}, ensure_ascii=False, indent=1) + '\n'
    index.write_text(index_orig, encoding='utf-8')

    # 1) 플래그를 끈 설정 사본(되돌린 상태): 아무것도 하지 않는다
    for ch in ('insurance', 'ai'):
        off = tmp / f'off_{ch}'
        shutil.copytree(ROOT / 'channels' / ch, off)
        for name, path in (('cluster.json', None), ('score.json', 'v2')):
            d = json.loads((off / name).read_text(encoding='utf-8'))
            (d[path] if path else d)['enabled'] = False
            (off / name).write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
        cd = channel.use(ch, off)
        assert quality.enabled(cd) == (False, False)
        assert quality.run(data, cd) is None
        assert shard.read_text(encoding='utf-8') == original and index.read_text(encoding='utf-8') == index_orig
    # 실제 채널 설정: 2026-11-12 부터 두 채널 모두 켜짐(docs/data-contract.md)
    assert all(quality.enabled(ROOT / 'channels' / ch) == (True, True) for ch in ('insurance', 'ai'))

    # 1-1) dry-run: 플래그를 켠 설정이어도 파일은 쓰지 않고 요약·검사만
    cfg0 = tmp / 'cfg0'
    shutil.copytree(ROOT / 'channels' / 'insurance', cfg0)
    for name, path in (('cluster.json', None), ('score.json', 'v2')):
        d = json.loads((cfg0 / name).read_text(encoding='utf-8'))
        (d[path] if path else d)['enabled'] = True
        (cfg0 / name).write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    channel.use('insurance', cfg0)
    dr = quality.run(data, cfg0, dry_run=True, all_days=True)
    assert dr['files_changed'] == 0 and dr['would_change'] == ['2026-11.json'] and shard.read_text(encoding='utf-8') == original
    ck = dr['check']
    assert ck['problems'] == [] and ck['groups'] == 1 and ck['max_group'] == 2 and ck['listed'] == 2, ck
    assert ck['score_v2_all'] == {2: 2, 5: 1} and ck['score_all'] == {2: 2, 5: 1}, ck
    # 검사가 실제로 잡는지: 대표 2건·크기 불일치
    bad = [dict(a, cluster_id='x', cluster_size=3, cluster_sources=2, cluster_lead=True) for a in rows[:2]]
    probs = quality.check(bad)['problems']
    assert any('대표 2건' in p for p in probs) and any('cluster_size' in p for p in probs), probs

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
    ix = json.loads(index.read_text(encoding='utf-8'))
    assert ix['months'][0]['bytes'] == shard.stat().st_size and ix['updated_at'] == '2026-11-10T06:00:00+00:00', 'index 크기만 갱신'
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
    assert index.read_text(encoding='utf-8') == index_orig, '되돌리면 index 도 원래 바이트'
finally:
    channel.use('insurance')
    shutil.rmtree(tmp, ignore_errors=True)

print('test_quality: ok')
