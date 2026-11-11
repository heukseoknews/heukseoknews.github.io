"""주별 키워드 언급 수 집계 (제목 기준, 발행시각 KST, 주 시작=월요일).
config/keywords.json 을 읽어 data/trends.json 을 만든다. 전체 월 파일을 다시 훑으므로 키워드 변경이 과거분에 반영된다.
"""
from __future__ import annotations
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))


def week_start(published_at: str) -> str:
    d = datetime.fromisoformat(published_at).astimezone(KST).date()
    return (d - timedelta(days=d.weekday())).isoformat()


def load_keywords(config_path: Path) -> list[dict]:
    cfg = json.loads(config_path.read_text(encoding='utf-8'))
    return [{'name': k['name'], 'terms': [t.casefold() for t in [k['name'], *k.get('aliases', [])]]} for k in cfg['keywords']]


def compute(articles: list[dict], keywords: list[dict]) -> list[dict]:
    weeks: dict[str, dict] = {}
    for a in articles:
        if a.get('relevant', True) is False:  # 관련도 낮은 기사는 키워드 추이에서 제외
            continue
        w = weeks.setdefault(week_start(a['published_at']), {'week_start': None, 'counts': {k['name']: 0 for k in keywords}, 'total': 0})
        w['total'] += 1
        title = a['title'].casefold()
        for k in keywords:
            if any(t in title for t in k['terms']):
                w['counts'][k['name']] += 1
    return [{**w, 'week_start': ws} for ws, w in sorted(weeks.items())]


def write_trends(data_dir: Path, config_path: Path) -> None:
    keywords = load_keywords(config_path)
    articles = [a for p in sorted(data_dir.glob('????-??.json')) for a in json.loads(p.read_text(encoding='utf-8'))]
    out = {'generated_at': datetime.now(timezone.utc).isoformat(), 'keywords': [k['name'] for k in keywords], 'weeks': compute(articles, keywords)}
    (data_dir / 'trends.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
