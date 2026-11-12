"""날짜 파서 보강 전후 비교(조사 전용, data/ 에 쓰지 않음).

  .venv/bin/python scripts/audit/date_parse_compare.py [--channel insurance --channel ai] [--extra 이름=URL ...]

채널 feeds.json 의 RSS·구글 검색 피드를 한 번씩만 받아(요청 간 1.2초 이상), 같은 응답에 옛 parse_date 와 새 parse_date 를 각각 적용해
collect_source 결과(저장될 기사)를 비교한다. 게시판은 날짜 해석이 바뀌지 않아 제외.
출력: 피드별 항목 수, 날짜를 읽은 수(옛/새), 새로 읽힌 수, 발행 시각이 달라진 수, 새로 저장될 기사(지금 data 에 없는 id) 수.
--extra 는 채널에 없는 후보 피드(예: 파이낸셜뉴스)를 금융 채널 규칙으로 함께 본다.
"""
from __future__ import annotations
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'collector'))
import channel  # noqa: E402
import collect  # noqa: E402
from normalize import SourceAliases, TitleFilter  # noqa: E402


def old_parse_date(entry, tz: str = collect.DEFAULT_TZ):
    """보강 전 parse_date(2026-11-12 이전 코드 그대로)."""
    t = entry.get('published_parsed') or entry.get('updated_parsed')
    if not t:
        return None
    raw = entry.get('published') or entry.get('updated') or ''
    if collect.HAS_TZ.search(raw):
        return datetime(*t[:6], tzinfo=timezone.utc).isoformat()
    return datetime(*t[:6], tzinfo=ZoneInfo(tz)).astimezone(timezone.utc).isoformat()


class _Resp:
    def __init__(self, content):
        self.content, self.status_code = content, 200

    def raise_for_status(self):
        pass


def run_channel(ch: str, extra: list[tuple[str, str]], cache: dict, last: list) -> list[dict]:
    cdir = channel.use(ch)
    sources, queries, max_age = collect.load_sources(cdir)
    sources = sources + [(n, u, 'media', None, {'timezone': 'Asia/Seoul'}) for n, u in extra]
    aliases = SourceAliases.load(cdir / 'source_aliases.json')
    tfilter = TitleFilter.load(cdir / 'title_filters.json')
    blocked = collect.Blocked.load(cdir / 'blocked_sources.json')
    collect.ALWAYS_RELEVANT.clear(); collect.ALWAYS_RELEVANT.update(collect.load_always_relevant(cdir))
    existing = {a['id'] for p in (ROOT / 'data' / ch).glob('????-??.json') for a in json.loads(p.read_text(encoding='utf-8'))}
    now_iso = datetime.now(timezone.utc).isoformat()
    out = []
    real_get, real_throttle, new_parse = collect.requests.get, collect.throttle_google, collect.parse_date
    for row in sources:
        name, url = row[0], row[1]
        if url not in cache:
            wait = 1.2 - (time.time() - last[0])
            if wait > 0:
                time.sleep(wait)
            try:
                r = requests.get(url, timeout=15, headers={'User-Agent': collect.UA, 'Accept': 'application/rss+xml, application/xml, text/xml'})
                r.raise_for_status()
                cache[url] = r.content
            except Exception as e:  # noqa: BLE001
                cache[url] = e
            last[0] = time.time()
        if isinstance(cache[url], Exception):
            out.append({'channel': ch, 'feed': name, 'error': str(cache[url])[:80]})
            continue
        res = {}
        collect.requests.get = lambda *a, **k: _Resp(cache[url])
        collect.throttle_google = lambda u: None
        try:
            for label, fn in (('old', old_parse_date), ('new', new_parse)):
                collect.parse_date = fn
                age = max_age if name in queries else row[4].get('max_age_days')
                arts, st = collect.collect_source(row, now_iso, aliases, None, tfilter, blocked, age)
                res[label] = ({a['id']: a for a in arts}, st)
        finally:
            collect.requests.get, collect.throttle_google, collect.parse_date = real_get, real_throttle, new_parse
        (o, so), (n, sn) = res['old'], res['new']
        common = set(o) & set(n)
        newly = [n[i] for i in set(n) - set(o)]
        rec = {'channel': ch, 'feed': name, 'entries': sn['feed_size'], 'no_date_old': so['skipped']['no_date'], 'no_date_new': sn['skipped']['no_date'],
               'kept_old': len(o), 'kept_new': len(n), 'lost': len(set(o) - set(n)),
               'published_changed': sum(1 for i in common if o[i]['published_at'] != n[i]['published_at']),
               'newly_kept': len(newly), 'newly_not_in_data': sum(1 for a in newly if a['id'] not in existing),
               'newly_relevant_not_in_data': sum(1 for a in newly if a['id'] not in existing and a['relevant']),
               'samples': [f"{a['published_at'][:16]} {a['title'][:40]}" for a in sorted(newly, key=lambda a: a['published_at'])[-3:]],
               'no_date_samples_new': sn.get('no_date_samples', [])}
        if newly:
            ps = sorted(a['published_at'] for a in newly)
            rec['newly_range'] = (ps[0][:16], ps[-1][:16])
            rec['newly_relevant_ratio'] = round(sum(a['relevant'] for a in newly) / len(newly), 2)
        out.append(rec)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--channel', action='append', default=None)
    ap.add_argument('--extra', action='append', default=[], help='채널:이름=URL (예: finance:파이낸셜뉴스 금융=https://...)')
    a = ap.parse_args()
    chans = a.channel or ['insurance', 'ai']
    extras: dict[str, list] = {}
    for x in a.extra:
        ch, rest = x.split(':', 1)
        n, u = rest.split('=', 1)
        extras.setdefault(ch, []).append((n, u))
        if ch not in chans:
            chans.append(ch)
    cache, last, rows = {}, [0.0], []
    for ch in chans:
        rows += run_channel(ch, extras.get(ch, []), cache, last)
    print(json.dumps(rows, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
