"""python collector/test_save_months.py — 월 파일을 넘는 같은 id 중복: 저장 시 재발 방지(save)와 기존 중복 정리(--dedupe-months)."""
import json
import shutil
import tempfile
from pathlib import Path

import channel
import collect

ROOT = Path(__file__).resolve().parent.parent


def art(i, title, published, collected, source='위즈경제'):
    return {'id': i, 'title': title, 'url': f'https://news.google.com/rss/articles/{i}', 'source': source, 'source_type': 'media',
            'published_at': published, 'collected_at': collected, 'category': '미분류', 'sub_categories': [], 'tags': [],
            'score': 2, 'feed_name': 'x', 'relevant': True, 'companies': [], 'orgs': []}


def rows(d, m):
    p = d / f'{m}.json'
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else []


tmp = Path(tempfile.mkdtemp(prefix='save-months-'))
try:
    d = tmp / 'data'
    # 1) 재발 방지: 10월 파일에 있는 id 를 피드가 11월 발행 시각으로 다시 보내도 11월 파일에 넣지 않는다
    collect.save([art('dup1', 'AI가 틀린 답 내놔도 보험은 사각지대', '2026-10-29T07:00:00+00:00', '2026-11-04T11:23:55+00:00')], d)
    added = collect.save([art('dup1', 'AI가 틀린 답 내놔도 보험은 사각지대', '2026-11-05T08:02:38+00:00', '2026-11-06T01:06:34+00:00'),
                          art('new1', '다른 새 기사', '2026-11-05T09:00:00+00:00', '2026-11-06T01:06:34+00:00')], d)
    assert added == 1, added
    assert [a['id'] for a in rows(d, '2026-11')] == ['new1']
    assert [a['published_at'] for a in rows(d, '2026-10')] == ['2026-10-29T07:00:00+00:00'], '처음 저장한 월·발행 시각 유지'
    # 같은 월 안의 처리(제목+출처 중복, 새 id 추가)는 이전과 같다
    assert collect.save([art('new2', '다른 새 기사', '2026-11-05T10:00:00+00:00', '2026-11-07T00:00:00+00:00')], d) == 0   # 같은 제목+출처
    assert collect.save([art('new3', '세 번째 기사', '2026-11-07T10:00:00+00:00', '2026-11-08T00:00:00+00:00')], d) == 1
    # 같은 제목의 정기 공지라도 id 가 다르면 다른 달에 저장된다(id 기준만)
    assert collect.save([art('rep2', '사업보고서 등에 대한 조사,감리결과 조치', '2026-11-03T00:00:00+00:00', '2026-11-04T00:00:00+00:00', '금융위원회')], d) == 1
    assert collect.save([art('rep1', '사업보고서 등에 대한 조사,감리결과 조치', '2026-10-03T00:00:00+00:00', '2026-11-04T00:00:00+00:00', '금융위원회')], d) == 1

    # 2) 기존 중복 정리: 두 월 파일에 같은 id(이전 코드가 만든 상태)를 직접 만들고 dry-run → 적용
    cfg = tmp / 'cfg'
    shutil.copytree(ROOT / 'channels' / 'insurance', cfg)
    for name, key in (('cluster.json', None), ('score.json', 'v2')):   # 이 테스트는 품질 플래그 끈 설정으로
        j = json.loads((cfg / name).read_text(encoding='utf-8')); (j[key] if key else j)['enabled'] = False
        (cfg / name).write_text(json.dumps(j, ensure_ascii=False), encoding='utf-8')
    channel.use('insurance', cfg)
    nov = rows(d, '2026-11') + [art('dup1', 'AI가 틀린 답 내놔도 보험은 사각지대', '2026-11-05T08:02:38+00:00', '2026-11-06T01:06:34+00:00')]
    (d / '2026-11.json').write_text(json.dumps(nov, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    collect.reindex(d, cfg)
    snap = {p.name: p.read_bytes() for p in d.glob('*.json')}
    dups = collect.cross_month_duplicates(d)
    assert len(dups) == 1 and dups[0]['id'] == 'dup1' and dups[0]['keep'][0] == '2026-10' and [x[0] for x in dups[0]['drop']] == ['2026-11']
    s = collect.dedupe_months(d, cfg, dry_run=True)
    assert s['removed'] == 1 and s['counts'] == {'2026-11': (4, 3)} and s['dry_run']
    assert {p.name: p.read_bytes() for p in d.glob('*.json')} == snap, 'dry-run 은 파일을 쓰지 않는다'
    s = collect.dedupe_months(d, cfg, dry_run=False)
    assert [a['id'] for a in rows(d, '2026-11')].count('dup1') == 0 and [a['id'] for a in rows(d, '2026-10')].count('dup1') == 1
    ix = json.loads((d / 'index.json').read_text(encoding='utf-8'))
    assert {m['month']: m['count'] for m in ix['months']} == {'2026-11': 3, '2026-10': 2}
    assert collect.cross_month_duplicates(d) == [] and collect.dedupe_months(d, cfg)['removed'] == 0   # 다시 돌리면 할 일 없음
finally:
    channel.use('insurance')
    shutil.rmtree(tmp, ignore_errors=True)

print('test_save_months: ok')
