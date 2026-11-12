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
    return n


def run(data_dir: Path, config_dir: Path, now: datetime | None = None) -> dict | None:
    """플래그가 하나라도 켜져 있으면 data_dir 의 월 파일에 품질 필드를 반영한다. 반환: 요약(꺼져 있으면 None)."""
    if not any(enabled(config_dir)):
        return None
    shards = load_rows(data_dir)
    before = {p: json.dumps(r, ensure_ascii=False, indent=1) + '\n' for p, r in shards.items()}
    rows = [a for r in shards.values() for a in r]
    summary = compute(rows, config_dir, now)
    summary['files_changed'] = _write(shards, before)
    logging.info('품질 후처리: %s', summary)
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
