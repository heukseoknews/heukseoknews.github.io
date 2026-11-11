"""채널 경로. 설정은 channels/<slug>/, 데이터는 data/<slug>/ 에 둔다(기본 채널 insurance).

분류·개체 로더(classify.load, entities.load 등)는 호출 시점의 config_dir() 을 읽으므로,
collect.py 가 시작할 때 use() 로 채널(또는 --config-dir)을 정하면 모든 설정이 그 경로에서 읽힌다.
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT = 'insurance'
_state = {'slug': DEFAULT, 'config_dir': ROOT / 'channels' / DEFAULT}


def config_path(slug: str = DEFAULT) -> Path:
    return ROOT / 'channels' / slug


def data_path(slug: str = DEFAULT) -> Path:
    return ROOT / 'data' / slug


def use(slug: str = DEFAULT, config_dir: str | Path | None = None) -> Path:
    """현재 채널을 정한다. config_dir 를 주면 채널 기본 경로 대신 그 폴더를 쓴다. 반환: 설정 폴더."""
    d = Path(config_dir) if config_dir else config_path(slug)
    if not d.is_dir():
        raise SystemExit(f'채널 설정 폴더가 없습니다: {d}')
    _state.update(slug=slug, config_dir=d)
    return d


def config_dir() -> Path:
    return _state['config_dir']


def slug() -> str:
    return _state['slug']


def timezone(default: str = 'Asia/Seoul') -> str:
    """채널 channel.json 의 timezone(주별 집계 등 날짜 기준). 없으면 Asia/Seoul."""
    p = config_dir() / 'channel.json'
    return json.loads(p.read_text(encoding='utf-8')).get('timezone', default) if p.exists() else default
