"""기사 품질 후처리: 같은 사건 묶기(cluster.json) + 중요도 v2(score.json "v2"). 두 플래그 모두 기본 꺼짐.

수집(save) 뒤에 채널 전체 기사를 읽어 선택 필드만 덧붙인다. 기존 필드(score·category 등)는 바꾸지 않는다.
  묶기 켜짐   → cluster_id, cluster_size, cluster_sources, cluster_lead
  v2 켜짐     → score_v2
플래그가 모두 꺼져 있으면 아무 파일도 읽거나 쓰지 않는다(보험 동등성 유지).
되돌리기: 플래그를 끄고 `python collector/collect.py --channel <채널> --strip-quality` (선택 필드만 지움).
"""
from __future__ import annotations
import json
import logging
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import cluster
import score_v2
from classify import load as load_classifier


def _read(p: Path, default):
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return default


def settings(config_dir: Path) -> tuple[dict, dict]:
    """(cluster 설정, v2 설정). 파일·키가 없으면 꺼짐."""
    return _read(config_dir / 'cluster.json', {}), _read(config_dir / 'score.json', {}).get('v2', {})


def enabled(config_dir: Path) -> tuple[bool, bool]:
    c, v = settings(config_dir)
    return bool(c.get('enabled')), bool(v.get('enabled'))


def load_rows(data_dir: Path) -> dict[Path, list[dict]]:
    return {p: json.loads(p.read_text(encoding='utf-8')) for p in sorted(data_dir.glob('????-??.json'))}


def compute(rows: list[dict], config_dir: Path, now: datetime | None = None, force: tuple[bool, bool] | None = None,
            cluster_overrides: dict | None = None) -> dict:
    """메모리의 기사 목록에 품질 필드를 계산해 쓴다(파일은 건드리지 않음).
    force=(묶기, v2) 로 플래그를, cluster_overrides 로 묶기 설정(예: 전체 기간 lookback_days)을 덮어쓸 수 있다(시뮬레이션용)."""
    ccfg, vcfg = settings(config_dir)
    ccfg = {**ccfg, **(cluster_overrides or {})}
    use_c, use_v = force if force is not None else (bool(ccfg.get('enabled')), bool(vcfg.get('enabled')))
    out: dict = {}
    if use_c:
        out['cluster'] = cluster.assign(rows, ccfg, now)
    if use_v:
        out['score_v2'] = score_v2.ScoreV2(load_classifier(), vcfg).apply(rows)
    if use_c:
        out['leads'] = cluster.mark_leads(rows)
    return out


def _write(shards: dict[Path, list[dict]], before: dict[Path, str]) -> int:
    n = 0
    for p, rows in shards.items():
        s = json.dumps(rows, ensure_ascii=False, indent=1) + '\n'
        if s != before[p]:
            p.write_text(s, encoding='utf-8')
            n += 1
    if n:
        _refresh_index(next(iter(shards)).parent)
    return n


def _refresh_index(data_dir: Path) -> None:
    """월 파일을 다시 쓴 뒤 index.json 의 크기(bytes)만 맞춘다. 마지막 수집 시각(updated_at)·건수는 그대로(--reclassify 와 같은 방식)."""
    p = data_dir / 'index.json'
    if not p.exists():
        return
    idx = json.loads(p.read_text(encoding='utf-8'))
    for m in idx.get('months', []):
        f = data_dir / f"{m['month']}.json"
        if f.exists():
            m['bytes'] = f.stat().st_size
    p.write_text(json.dumps(idx, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


ALL_DAYS = {'lookback_days': 100000, 'idf_days': 100000}  # --quality-all: 저장된 전체 기간(첫 백필용)


def check(rows: list[dict]) -> dict:
    """품질 필드 요약과 일관성 검사. problems 가 비어 있어야 정상.
    검사: 묶음마다 대표(cluster_lead) 정확히 1건, cluster_size = 실제 기사 수, cluster_sources = 실제 출처 수, 혼자인 기사에 묶음 필드 없음."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for a in rows:
        if a.get('cluster_id'):
            groups[a['cluster_id']].append(a)
    problems = []
    for cid, ms in groups.items():
        if len(ms) < 2:
            problems.append(f'{cid}: 혼자인데 묶음 필드가 있음')
        if sum(1 for a in ms if a.get('cluster_lead')) != 1:
            problems.append(f'{cid}: 대표 {sum(1 for a in ms if a.get("cluster_lead"))}건')
        if any(a.get('cluster_size') != len(ms) for a in ms):
            problems.append(f'{cid}: cluster_size 불일치')
        if any(a.get('cluster_sources') != len({x['source'] for x in ms}) for a in ms):
            problems.append(f'{cid}: cluster_sources 불일치')
    problems += [f'{a["id"]}: 묶음 없이 cluster_lead' for a in rows if a.get('cluster_lead') and not a.get('cluster_id')]
    listed = [a for a in rows if not a.get('cluster_id') or a.get('cluster_lead')]
    rel = [a for a in listed if a.get('relevant', True)]
    dist = lambda L, k: dict(sorted(Counter(a[k] for a in L if k in a).items()))
    return {'articles': len(rows), 'groups': len(groups), 'clustered': sum(len(v) for v in groups.values()),
            'max_group': max((len(v) for v in groups.values()), default=0), 'listed': len(listed),
            'score_all': dist(rows, 'score'), 'score_v2_all': dist(rows, 'score_v2'),
            'score_listed_relevant': dist(rel, 'score'), 'score_v2_listed_relevant': dist(rel, 'score_v2'),
            'problems': problems}


def run(data_dir: Path, config_dir: Path, now: datetime | None = None, all_days: bool = False, dry_run: bool = False) -> dict | None:
    """플래그가 하나라도 켜져 있으면 data_dir 의 월 파일에 품질 필드를 반영한다. 반환: 요약(꺼져 있으면 None).
    all_days: 저장된 전체 기간을 판정(첫 백필). dry_run: 계산·요약만 하고 파일은 쓰지 않는다."""
    if not any(enabled(config_dir)):
        return None
    t0 = time.perf_counter()
    shards = load_rows(data_dir)
    before = {p: json.dumps(r, ensure_ascii=False, indent=1) + '\n' for p, r in shards.items()}
    rows = [a for r in shards.values() for a in r]
    summary = compute(rows, config_dir, now, cluster_overrides=ALL_DAYS if all_days else None)
    summary['seconds'] = round(time.perf_counter() - t0, 2)
    if dry_run:
        summary['check'] = check(rows)
        summary['files_changed'] = 0
        summary['would_change'] = [p.name for p, r in shards.items() if json.dumps(r, ensure_ascii=False, indent=1) + '\n' != before[p]]
    else:
        summary['files_changed'] = _write(shards, before)
    logging.info('품질 후처리%s: %s', '(dry-run)' if dry_run else '', {k: v for k, v in summary.items() if k != 'check'})
    return summary


def strip_all(data_dir: Path) -> int:
    """되돌리기: 모든 월 파일에서 품질 선택 필드를 지운다. 반환: 필드가 지워진 기사 수."""
    shards = load_rows(data_dir)
    before = {p: json.dumps(r, ensure_ascii=False, indent=1) + '\n' for p, r in shards.items()}
    n = 0
    for rows in shards.values():
        for a in rows:
            had = any(f in a for f in cluster.FIELDS + ('score_v2',))
            cluster.strip([a]); score_v2.strip([a])
            n += had
    _write(shards, before)
    return n
