"""python collector/test_normalize_sources.py — 저장된 기사 출처 이름 정규화 옵션(--normalize-sources): dry-run·적용·합쳐짐."""
import json
import shutil
import tempfile
from pathlib import Path

import channel
import collect

ROOT = Path(__file__).resolve().parent.parent


def art(i, title, source, kind='media'):
    return {'id': i, 'title': title, 'url': f'https://e.com/{i}', 'source': source, 'source_type': kind,
            'published_at': '2026-11-10T00:00:00+00:00', 'collected_at': f'2026-11-10T0{i[-1]}:00:00+00:00', 'category': '미분류',
            'sub_categories': [], 'tags': [], 'score': 2, 'feed_name': 'x', 'relevant': True, 'companies': [], 'orgs': []}


tmp = Path(tempfile.mkdtemp(prefix='norm-src-'))
try:
    cfg = tmp / 'cfg'
    shutil.copytree(ROOT / 'channels' / 'insurance', cfg)
    for name, key in (('cluster.json', None), ('score.json', 'v2')):   # 품질 플래그 끈 설정(출처 정규화만 본다)
        j = json.loads((cfg / name).read_text(encoding='utf-8')); (j[key] if key else j)['enabled'] = False
        (cfg / name).write_text(json.dumps(j, ensure_ascii=False), encoding='utf-8')
    (cfg / 'source_aliases.json').write_text(json.dumps({'domains': {}, 'names': {'www.fetv.co.kr': 'FETV', ':: 위즈경제 ::': '위즈경제'}}, ensure_ascii=False), encoding='utf-8')
    channel.use('insurance', cfg)
    d = tmp / 'data'
    d.mkdir()
    rows = [art('a1', '보험사 3분기 실적 발표 같은 제목', 'FETV'), art('a2', '보험사 3분기 실적 발표 같은 제목', 'www.fetv.co.kr'), art('a3', '보험업계 동향 다른 제목 기사', ':: 위즈경제 ::'),
            art('a4', '금융위원회 공식 보도자료 제목', 'www.fetv.co.kr', 'press')]   # press 출처는 정규화 대상 아님(기존 규칙)
    (d / '2026-11.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    collect.reindex(d, cfg)
    snap = {p.name: p.read_bytes() for p in d.glob('*.json')}

    s = collect.normalize_sources(d, cfg, dry_run=True)
    assert {p.name: p.read_bytes() for p in d.glob('*.json')} == snap, 'dry-run 은 파일을 쓰지 않는다'
    assert s['renamed'] == {':: 위즈경제 :: → 위즈경제': 1}, s['renamed']          # a2 는 a1 과 합쳐져 사라짐(이름 변경으로 세지 않음)
    assert [x['id'] for x in s['removed']] == ['a2'] and s['other_fields_changed'] == []

    s2 = collect.normalize_sources(d, cfg, dry_run=False)
    out = {a['id']: a for a in json.loads((d / '2026-11.json').read_text(encoding='utf-8'))}
    assert set(out) == {'a1', 'a3', 'a4'} and out['a3']['source'] == '위즈경제' and out['a4']['source'] == 'www.fetv.co.kr'
    assert json.loads((d / 'index.json').read_text(encoding='utf-8'))['months'][0]['count'] == 3
    assert collect.normalize_sources(d, cfg, dry_run=True)['renamed_articles'] == 0   # 다시 돌리면 할 일 없음
finally:
    channel.use('insurance')
    shutil.rmtree(tmp, ignore_errors=True)

print('test_normalize_sources: ok')
