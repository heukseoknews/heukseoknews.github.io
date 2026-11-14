"""저장 데이터 다시 쓰기 전후 비교(--dedupe-months, --normalize-sources, --reclassify, --rescore, --quality 의 보고용).

CLAUDE.md "기존 기사 보존": 바뀌는 기사 수·삭제되는 기사 수·id 가 바뀌는 기사 수와 요약(파일 크기, 샘플)을 보고한다.
  changed        같은 월 파일에 같은 id 가 남았고 필드가 바뀐 기사(changed_fields: 필드별 건수)
  removed        id 가 어디에도 남지 않고, 같은 키(제목+출처)의 기사도 남지 않은 기사(완전히 삭제)
  id_changed     id 는 사라졌지만 같은 키(제목+출처)가 다른 id 로 남은 기사 — 북마크·채팅 첨부가 깨진다
  copies_removed 같은 id 가 다른 월 파일에 남아 있는 사본 삭제(--dedupe-months)
  added          전에는 없던 id
"""
from __future__ import annotations
import json
from collections import Counter

from normalize import dedupe_key

QUALITY_FIELDS = ('cluster_id', 'cluster_size', 'cluster_sources', 'cluster_lead', 'score_v2')
SAMPLES = 5


def _short(v, n: int = 60):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + '…'


def _bytes(rows: list[dict]) -> int:
    return len((json.dumps(rows, ensure_ascii=False, indent=1) + '\n').encode('utf-8'))


def compare(before: dict[str, list[dict]], after: dict[str, list[dict]], samples: int = SAMPLES, key=dedupe_key) -> dict:
    """before/after: {월: 기사 목록}. key: 같은 기사 판정 키(기본 제목+출처, 정규화 작업은 정규화 뒤의 키). 반환: 건수·필드별 건수·월 파일 크기·샘플."""
    b = {(m, a['id']): a for m, rows in before.items() for a in rows}
    f = {(m, a['id']): a for m, rows in after.items() for a in rows}
    before_ids, after_ids = {i for _, i in b}, {i for _, i in f}
    after_keys: dict[str, str] = {}
    for (_, i), a in f.items():
        after_keys.setdefault(key(a), i)
    changed, removed, id_changed, copies = [], [], [], []
    fields: Counter = Counter()
    quality_only = 0
    for (m, i), a in b.items():
        if (m, i) in f:
            x = f[(m, i)]
            diff = sorted(k for k in set(a) | set(x) if a.get(k) != x.get(k))
            if diff:
                fields.update(diff)
                quality_only += all(k in QUALITY_FIELDS for k in diff)
                changed.append({'month': m, 'id': i, 'title': _short(a['title'], 50),
                                'fields': {k: [_short(a.get(k)), _short(x.get(k))] for k in diff}})
        elif i in after_ids:
            copies.append({'month': m, 'id': i, 'title': _short(a['title'], 50)})
        elif after_keys.get(key(a), i) != i:
            id_changed.append({'month': m, 'id': i, 'new_id': after_keys[key(a)], 'title': _short(a['title'], 50), 'source': a.get('source')})
        else:
            removed.append({'month': m, 'id': i, 'title': _short(a['title'], 50), 'source': a.get('source')})
    months = sorted(set(before) | set(after), reverse=True)
    sizes = {m: {'count': [len(before.get(m, [])), len(after.get(m, []))], 'bytes': [_bytes(before.get(m, [])), _bytes(after.get(m, []))]}
             for m in months if before.get(m) != after.get(m)}
    return {'changed': len(changed), 'changed_quality_only': quality_only, 'changed_fields': dict(fields.most_common()),
            'removed': len(removed), 'id_changed': len(id_changed), 'copies_removed': len(copies),
            'added': len(after_ids - before_ids), 'files': sizes,
            'samples': {'changed': changed[:samples], 'removed': removed[:samples], 'id_changed': id_changed[:samples], 'copies_removed': copies[:samples]}}


def headline(d: dict) -> str:
    """로그 한 줄 요약."""
    return (f"변경 {d['changed']}(품질 필드만 {d['changed_quality_only']}) / 삭제 {d['removed']} / id 변경 {d['id_changed']}"
            f" / 사본 삭제 {d['copies_removed']} / 추가 {d['added']}")
