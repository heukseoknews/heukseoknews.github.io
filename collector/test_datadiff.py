"""python collector/test_datadiff.py — 데이터 다시 쓰기 공통 비교(datadiff.compare)와 --reclassify·--rescore 의 --dry-run."""
import json
import shutil
import tempfile
from pathlib import Path

import channel
import collect
import datadiff


def art(i, title, source='보험매일', **kw):
    a = {'id': i, 'title': title, 'url': f'https://e.com/{i}', 'source': source, 'source_type': 'media',
         'published_at': '2026-11-10T00:00:00+00:00', 'collected_at': '2026-11-10T01:00:00+00:00', 'category': '미분류',
         'sub_categories': [], 'tags': [], 'score': 2, 'feed_name': '보험매일', 'relevant': True, 'companies': [], 'orgs': []}
    return {**a, **kw}


# 1) 분류: 변경 / 삭제 / id 변경(같은 제목+출처가 다른 id 로 남음) / 사본 삭제 / 추가
before = {'2026-11': [art('a1', '변경되는 기사'), art('a2', '지워지는 기사'), art('a3', '링크가 바뀐 기사'), art('a4', '두 달에 있던 기사')],
          '2026-10': [art('a4', '두 달에 있던 기사')]}
after = {'2026-11': [art('a1', '변경되는 기사', category='손해보험', score_v2=3), art('a3x', '링크가 바뀐 기사'), art('a5', '새 기사')],
         '2026-10': [art('a4', '두 달에 있던 기사')]}
d = datadiff.compare(before, after)
assert (d['changed'], d['removed'], d['id_changed'], d['copies_removed'], d['added']) == (1, 1, 1, 1, 2), d
assert d['changed_fields'] == {'category': 1, 'score_v2': 1} and d['changed_quality_only'] == 0
assert d['samples']['id_changed'][0]['id'] == 'a3' and d['samples']['id_changed'][0]['new_id'] == 'a3x'
assert d['samples']['removed'][0]['id'] == 'a2' and d['files']['2026-11']['count'] == [4, 3] and '2026-10' not in d['files']
assert datadiff.compare(before, before)['changed'] == 0 and datadiff.headline(d).startswith('변경 1')
q = datadiff.compare({'m': [art('b', 't')]}, {'m': [art('b', 't', cluster_id='c', score_v2=2)]})
assert q['changed'] == 1 and q['changed_quality_only'] == 1

# 2) --reclassify / --rescore: dry-run 은 파일을 쓰지 않고, 적용과 같은 비교 결과를 돌려준다
tmp = Path(tempfile.mkdtemp(prefix='datadiff-'))
try:
    cfg = tmp / 'cfg'
    shutil.copytree(channel.config_path('insurance'), cfg)
    channel.use('insurance', cfg)
    data = tmp / 'data'
    data.mkdir()
    rows = [art('r1', '삼성화재 3분기 순이익 증가'), art('r2', '오늘의 날씨', category='손해보험', score=4), art('r3', '보험사 지급여력비율 K-ICS 하락', score=5)]
    (data / '2026-11.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    collect.reindex(data, cfg)
    snap = {p.name: p.read_bytes() for p in data.glob('*.json')}

    dr = collect.reclassify(data, cfg, dry_run=True)
    assert {p.name: p.read_bytes() for p in data.glob('*.json')} == snap, '--reclassify --dry-run 은 파일을 쓰지 않는다'
    assert dr['dry_run'] and dr['changed'] == 3 and dr['diff']['removed'] == 0 and dr['diff']['id_changed'] == 0, dr
    assert dr['diff']['changed'] == 3 and 'category' in dr['diff']['changed_fields'] and 'score_v2' in dr['diff']['changed_fields']

    rs = collect.rescore(data, config_dir=cfg, dry_run=True)
    assert {p.name: p.read_bytes() for p in data.glob('*.json')} == snap, '--rescore --dry-run 은 파일을 쓰지 않는다'
    assert rs['dry_run'] and rs['changed'] >= 1 and rs['diff']['changed'] >= rs['changed']

    ap = collect.reclassify(data, cfg)
    assert not ap['dry_run'] and ap['changed'] == 3 and ap['diff']['changed'] == dr['diff']['changed']
    out = {a['id']: a for a in json.loads((data / '2026-11.json').read_text(encoding='utf-8'))}
    assert out['r2']['relevant'] is False and out['r1']['category'] != '미분류' and all('score_v2' in a for a in out.values())
    assert collect.reclassify(data, cfg, dry_run=True)['changed'] == 0, '다시 돌리면 할 일 없음'
finally:
    channel.use('insurance')
    shutil.rmtree(tmp, ignore_errors=True)

print('test_datadiff: ok')
