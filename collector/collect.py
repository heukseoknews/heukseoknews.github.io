"""RSS 메타데이터 수집기 (제목·링크·출처·발행시각만 저장, 본문/이미지 저장 안 함).

결과: data/YYYY-MM.json (발행시각 기준 월별 샤드) + data/index.json
사용: python collector/collect.py [--data-dir data] [--dry-run]
비밀키 불필요. 일부 피드가 실패해도 계속 진행한다.
"""
from __future__ import annotations
import argparse, hashlib, html, json, logging, re, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import feedparser
import requests
from boards import fetch_board
from classify import UNCATEGORIZED, classify, load as load_classifier
from entities import company_relevant, sports_team_title, tag_entities
from normalize import SourceAliases, TitleFilter, dedupe_key, is_google, normalize_shards, prefer, strip_org_suffix
from trends import write_trends

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
FEED_CAP = 100       # 피드당 처리 상한
FILTER_SAMPLES = 10  # status.json에 남기는 걸러진 제목 샘플 수
UA = 'ActuaryNewsHub/3.0 (personal RSS reader; metadata only)'


def google(q: str, when: str = '7d') -> str:
    return 'https://news.google.com/rss/search?q=' + quote(q + f' when:{when}') + '&hl=ko&gl=KR&ceid=KR:ko'


# 직접 RSS: (feed_name, url, source_type, 고정 출처명 or None). 구글 검색 피드는 config/feeds.json, 게시판은 config/boards.json.
RSS_SOURCES = [
    ('보험매일', 'https://www.fins.co.kr/rss/allArticle.xml', 'media', '보험매일'),
    ('보험저널', 'https://www.insjournal.co.kr/rss/allArticle.xml', 'media', '보험저널'),
    ('한국보험신문', 'https://www.insnews.co.kr/rss/allArticle.xml', 'media', '한국보험신문'),
    ('금융위원회 RSS', 'https://www.fsc.go.kr/about/fsc_bbs_rss/?fid=0111', 'press', '금융위원회'),
]
RSS_SUBSTITUTE = {'금융위원회 RSS': '금융위원회'}  # 점검(503) 중이면 같은 기관의 게시판 수집이 대체한다는 참고 표시용


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return default


def load_sources(config_dir: Path) -> tuple[list, set, int | None]:
    """(RSS+구글 검색 피드 행 목록, 구글 검색 피드 이름 집합, 검색 피드 기사 최대 나이(일))."""
    rows, queries = list(RSS_SOURCES), set()
    feeds = load_json(config_dir / 'feeds.json', {})
    for q in feeds.get('queries', []):
        rows.append((q['name'], google(q['q'], q.get('when', '7d')), q.get('type', 'media'), q.get('source')))
        queries.add(q['name'])
    return rows, queries, feeds.get('max_age_days')


class Blocked:
    """config/blocked_sources.json: 저장하지 않을 출처."""

    def __init__(self, sources: dict | None = None):
        self.reasons = {k.casefold(): v for k, v in (sources or {}).items()}

    @classmethod
    def load(cls, path: Path) -> 'Blocked':
        return cls(load_json(path, {}).get('sources'))

    def is_blocked(self, source: str) -> bool:
        return source.strip().casefold() in self.reasons


_google_lock, _google_last = threading.Lock(), [0.0]
GOOGLE_DELAY = 0.6  # 구글 뉴스 요청 간 최소 간격(초): 쿼리가 늘어도 한꺼번에 몰리지 않게


def throttle_google(url: str) -> None:
    if 'news.google.com' not in url:
        return
    with _google_lock:
        wait = GOOGLE_DELAY - (time.time() - _google_last[0])
        if wait > 0:
            time.sleep(wait)
        _google_last[0] = time.time()


PRESS_RE = re.compile('보험|실손|K-ICS|지급여력|계리|보험금|보험료|CSM', re.I)
TRACKING = re.compile(r'^(utm_.*|fbclid|gclid|oc|ref|from|cid|ocid|mc_.*)$', re.I)


def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', '', text or ''))).strip()


def normalize_url(url: str) -> str:
    p = urlsplit(url.strip())
    q = sorted((k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not TRACKING.match(k))
    host = p.netloc.lower().removeprefix('www.')
    return urlunsplit(('https', host, p.path.rstrip('/') or '/', urlencode(q), ''))


def article_id(url: str) -> str:
    return hashlib.sha256(normalize_url(url).encode()).hexdigest()[:16]


HAS_TZ = re.compile(r'(Z|GMT|UTC|[+-]\d{2}:?\d{2})\s*$', re.I)


def parse_date(entry):
    """UTC ISO 반환. 국내 전문지 RSS는 타임존 없는 'YYYY-MM-DD HH:MM:SS'(KST)라 -9h 보정."""
    t = entry.get('published_parsed') or entry.get('updated_parsed')
    if not t:
        return None
    dt = datetime(*t[:6], tzinfo=timezone.utc)
    raw = entry.get('published') or entry.get('updated') or ''
    if not HAS_TZ.search(raw):
        dt -= timedelta(hours=9)
    return dt.isoformat()


RELEVANT_DEPTS: set[str] = set()  # config/boards.json relevant_departments (main 에서 채움)


def judge(title: str, kind: str, name: str | None, dept: str | None = None) -> tuple[bool, dict]:
    """(관련도, 분류 결과). 관련도 낮은 기사는 버리지 않고 relevant=False·미분류로 저장한다."""
    c = classify(title, name)
    rel = bool(c['relevant'])
    if kind == 'press' and not PRESS_RE.search(title):
        rel = False
    if rel and sports_team_title(title):  # 보험사와 이름이 같은 구단·연예 기사는 관련 없음(보험 사업 단서가 있으면 유지)
        rel = False
    if dept and dept in RELEVANT_DEPTS:
        rel = True
    if not rel and company_relevant(title):  # 보험사가 제목에 나오면 '보험' 단어가 없어도 관련(스포츠 구단 기사 등 제외)
        rel = True
    if not rel:
        c = {**c, 'category': UNCATEGORIZED, 'sub_categories': [], 'score': load_classifier().score(title, UNCATEGORIZED)[0]}
    return rel, c


def make_article(title, link, source, kind, published, now_iso, name, dept=None) -> dict:
    rel, c = judge(title, kind, name, dept)
    ent = tag_entities(title, source, c['tags'])  # 보험사·유관기관(필터용), 같은 이름의 분류 태그는 정리
    c = {**c, 'tags': ent['tags']}
    a = {'id': article_id(link), 'title': title, 'url': link, 'source': source, 'source_type': kind,
         'published_at': published, 'collected_at': now_iso, 'category': c['category'],
         'sub_categories': c['sub_categories'], 'tags': c['tags'], 'score': c['score'], 'feed_name': name, 'relevant': rel,
         'companies': ent['companies'], 'orgs': ent['orgs']}
    if dept:
        a['department'] = dept  # 내부 메타(화면에 직접 노출하지 않음)
    return a


def collect_source(row, now_iso, aliases=None, unmapped=None, tfilter=None, blocked=None, max_age_days=None):
    """max_age_days: 지정하면 발행 후 그 일수를 넘은 기사는 저장하지 않는다(검색 피드용)."""
    name, url, kind, fixed = row
    throttle_google(url)
    r = requests.get(url, timeout=15, headers={'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml'})
    r.raise_for_status()
    feed = feedparser.parse(r.content)
    if feed.bozo and not feed.entries:
        raise ValueError(f'invalid feed: {feed.bozo_exception}')
    entries = feed.entries[:FEED_CAP]
    out, skipped, filtered, dates = [], {'no_link': 0, 'no_date': 0, 'low_relevance': 0}, [], []
    blocked_n: dict[str, int] = {}
    cutoff = (datetime.fromisoformat(now_iso) - timedelta(days=max_age_days)).isoformat() if max_age_days else None
    for e in entries:
        raw = clean(e.get('title', ''))
        link = (e.get('link') or '').strip()
        if not raw or not link.startswith(('http://', 'https://')):
            skipped['no_link'] += 1; continue
        published = parse_date(e)
        if not published:
            skipped['no_date'] += 1; continue
        dates.append(published)
        if cutoff and published < cutoff:
            skipped['too_old'] = skipped.get('too_old', 0) + 1
            continue
        if fixed:
            source, title = fixed, raw
        elif ' - ' in raw:
            title, source = (s.strip() for s in raw.rsplit(' - ', 1))
        else:
            title, source = raw, name
        if aliases and not fixed:
            href = (e.get('source') or {}).get('href')  # 구글 뉴스 RSS의 <source url>
            source, known = aliases.resolve(source, href)
            if not known and unmapped is not None:
                unmapped.add(source)
        title = strip_org_suffix(title)
        if tfilter and tfilter.is_junk(title):
            skipped['junk_title'] = skipped.get('junk_title', 0) + 1
            if len(filtered) < FILTER_SAMPLES:
                filtered.append(f'[노이즈 제목] {title}')
            continue
        if blocked and blocked.is_blocked(source):
            blocked_n[source] = blocked_n.get(source, 0) + 1
            continue
        art = make_article(title, link, source, kind, published, now_iso, name)
        if not art['relevant']:
            skipped['low_relevance'] += 1
            if len(filtered) < FILTER_SAMPLES:
                filtered.append(title)
        out.append(art)
    stats = {'feed_size': len(feed.entries), 'skipped': skipped, 'filtered': filtered,
             'oldest': min(dates) if dates else None, 'newest': max(dates) if dates else None, 'blocked': blocked_n}
    return out, stats


def collect_board(spec: dict, cfg: dict, now_iso: str, backfill: bool, tfilter=None, blocked=None):
    """HTML 게시판 1개 수집. 결과 형식은 collect_source 와 같다."""
    pages = spec.get('backfill_pages', cfg.get('backfill_pages', 4)) if backfill else spec.get('pages', cfg.get('pages', 2))
    items, info = fetch_board(spec, pages, max(cfg.get('delay_s', 1.2), 1.2))
    out, skipped, filtered, dates = [], {'no_link': 0, 'no_date': 0, 'low_relevance': 0}, [], []
    blocked_n: dict[str, int] = {}
    for it in items:
        title = strip_org_suffix(clean(it['title']))
        dates.append(it['published'])
        if tfilter and tfilter.is_junk(title):
            skipped['junk_title'] = skipped.get('junk_title', 0) + 1
            continue
        if blocked and blocked.is_blocked(spec['source']):
            blocked_n[spec['source']] = blocked_n.get(spec['source'], 0) + 1
            continue
        art = make_article(title, it['url'], spec['source'], 'press', it['published'], now_iso, spec['name'], it.get('department'))
        if not art['relevant']:
            skipped['low_relevance'] += 1
            if len(filtered) < FILTER_SAMPLES:
                filtered.append(title)
        out.append(art)
    stats = {'feed_size': len(items), 'skipped': skipped, 'filtered': filtered, 'pages': info['pages'],
             'oldest': min(dates) if dates else None, 'newest': max(dates) if dates else None, 'blocked': blocked_n}
    return out, stats


def load_shard(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return []


def save(rows, data_dir: Path, aliases=None, tfilter=None):
    """월별 샤드에 병합(기존 id는 유지). 반환: 새로 추가된 건수."""
    data_dir.mkdir(parents=True, exist_ok=True)
    fixed = normalize_shards(data_dir, aliases, tfilter)  # 기존 데이터도 현재 정규화 규칙으로 정리
    if fixed:
        logging.info('기존 월 파일 %d개 정규화', fixed)
    by_month: dict[str, list] = {}
    for a in rows:
        by_month.setdefault(a['published_at'][:7], []).append(a)
    added = 0
    for month, items in by_month.items():
        path = data_dir / f'{month}.json'
        existing = load_shard(path)
        by_key = {dedupe_key(a): a for a in existing}
        by_id = {a['id'] for a in existing}
        changed = False
        for a in items:
            k = dedupe_key(a)
            if k in by_key:
                better = prefer(a, by_key[k])  # 기존이 구글 링크이고 새 것이 직접 링크면 교체
                if better is not by_key[k]:
                    better['collected_at'] = by_key[k]['collected_at']
                    by_key[k] = better; changed = True
            elif a['id'] not in by_id:
                by_key[k] = a; by_id.add(a['id']); added += 1; changed = True
        if changed:
            merged = sorted(by_key.values(), key=lambda a: a['published_at'], reverse=True)
            path.write_text(json.dumps(merged, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    months = sorted((p.stem for p in data_dir.glob('????-??.json')), reverse=True)
    info = [{'month': m, 'count': len(load_shard(data_dir / f'{m}.json')), 'bytes': (data_dir / f'{m}.json').stat().st_size} for m in months]
    index = {'updated_at': datetime.now(timezone.utc).isoformat(), 'months': info}
    (data_dir / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    return added


def reclassify(data_dir: Path) -> None:
    """저장된 모든 기사를 현재 config/categories.json 규칙으로 다시 분류. id·수집시각·발행시각 등은 건드리지 않는다."""
    total = changed = 0
    counts: dict[str, int] = {}
    for path in sorted(data_dir.glob('????-??.json')):
        rows = load_shard(path)
        dirty = False
        for a in rows:
            if 'relevant' in a:  # 관련도는 수집 때의 판정을 현재 규칙으로 다시 계산
                rel, c = judge(a['title'], a['source_type'], a.get('feed_name'), a.get('department'))
            else:  # 예전 기사(수집 단계에서 이미 관련 있음으로 걸러진 것)는 relevant=true 로 이전
                rel, c = True, classify(a['title'], a.get('feed_name'))
            ent = tag_entities(a['title'], a.get('source'), c['tags'])
            new = {'category': c['category'], 'sub_categories': c['sub_categories'], 'tags': ent['tags'], 'score': c['score'], 'relevant': rel,
                   'companies': ent['companies'], 'orgs': ent['orgs']}
            if any(a.get(k) != v for k, v in new.items()):
                a.update(new); dirty = True; changed += 1
            total += 1
            counts[a['category']] = counts.get(a['category'], 0) + 1
        if dirty:
            path.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    idx_path = data_dir / 'index.json'
    if idx_path.exists():  # 마지막 수집 시각(updated_at)은 유지하고 파일 크기만 갱신
        idx = json.loads(idx_path.read_text(encoding='utf-8'))
        for m in idx.get('months', []):
            f = data_dir / f"{m['month']}.json"
            m['bytes'], m['count'] = f.stat().st_size, len(load_shard(f))
        idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    logging.info('재분류: 전체 %d건 중 %d건 변경', total, changed)
    for k, v in sorted(counts.items(), key=lambda x: -x[1]):
        logging.info('  %s: %d건 (%.1f%%)', k, v, v / total * 100 if total else 0)


def reindex(data_dir: Path, config_dir: Path) -> None:
    """월 파일 목록이 바뀐 뒤(파일을 옮기거나 지운 경우) index.json 의 월 목록·크기와 trends.json 을 다시 만든다. 기사 데이터는 건드리지 않는다."""
    idx_path = data_dir / 'index.json'
    updated = json.loads(idx_path.read_text(encoding='utf-8')).get('updated_at') if idx_path.exists() else datetime.now(timezone.utc).isoformat()
    months = sorted((p.stem for p in data_dir.glob('????-??.json')), reverse=True)
    info = [{'month': m, 'count': len(load_shard(data_dir / f'{m}.json')), 'bytes': (data_dir / f'{m}.json').stat().st_size} for m in months]
    idx_path.write_text(json.dumps({'updated_at': updated, 'months': info}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    write_trends(data_dir, config_dir / 'keywords.json')
    logging.info('index·trends 재생성: 월 파일 %d개', len(months))


def rescore(data_dir: Path, big: int = 2) -> dict:
    """저장된 기사의 중요도(★)만 config/score.json 산식으로 다시 계산한다(분류·태그·id·시각은 그대로).
    반환: 변경 요약(분포 전후, 변경 건수, 별점이 big 이상 바뀐 기사 목록)."""
    before, after, changes = {}, {}, []
    for path in sorted(data_dir.glob('????-??.json')):
        rows = load_shard(path)
        dirty = False
        for a in rows:
            new = classify(a['title'], a.get('feed_name'))['score'] if a.get('relevant', True) else load_classifier().score(a['title'], UNCATEGORIZED)[0]
            old = a['score']
            before[old] = before.get(old, 0) + 1
            after[new] = after.get(new, 0) + 1
            if new != old:
                changes.append({'id': a['id'], 'title': a['title'], 'source': a['source'], 'category': a['category'], 'before': old, 'after': new})
                a['score'] = new
                dirty = True
        if dirty:
            path.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    summary = {'total': sum(before.values()), 'changed': len(changes), 'before': dict(sorted(before.items())), 'after': dict(sorted(after.items())),
               'big_changes': [c for c in changes if abs(c['after'] - c['before']) >= big]}
    logging.info('재점수: 전체 %d건 중 %d건 변경, 분포 %s -> %s', summary['total'], summary['changed'], summary['before'], summary['after'])
    return summary


def safe_error(e: Exception) -> str:
    """공개 사이트에 노출되므로 URL(쿼리 포함)을 제거하고 길이를 제한한다."""
    msg = re.sub(r'https?://\S+', '<url>', f'{type(e).__name__}: {e}')
    return msg[:140]


def skipped_stats(stats: dict) -> dict:
    return {'entries': stats['feed_size'], 'skipped': stats['skipped'], 'filtered': stats['filtered'],
            'oldest': stats['oldest'], 'newest': stats['newest']}


def write_status(data_dir: Path, started: str, results: dict, total: int, added: int, names: list[str], queries: set[str], boards: set[str]):
    """실행 결과 저장. 이번에 실패해도 이전의 last_success_at은 유지한다."""
    path = data_dir / 'status.json'
    try:
        prev = json.loads(path.read_text(encoding='utf-8')).get('sources', {})
    except (FileNotFoundError, ValueError):
        prev = {}
    sources, blocked_total = {}, {}
    for name in names:
        r = results.get(name, {})
        old = prev.get(name, {})
        ok = r.get('ok', False)
        at_limit = ok and (r.get('entries') in (50, FEED_CAP) or r.get('entries', 0) > FEED_CAP)
        sources[name] = {
            'ok': ok, 'last_run_at': started,
            'last_success_at': started if ok else old.get('last_success_at'),
            'consecutive_failures': 0 if ok else old.get('consecutive_failures', 0) + 1,
            'entries': r.get('entries', 0), 'kept': r.get('kept', 0), 'skipped': r.get('skipped', {}),
            'filtered': r.get('filtered', []), 'oldest': r.get('oldest'), 'newest': r.get('newest'),
            # 피드가 주는 항목 수가 50/100건에 닿으면 더 오래된 기사가 잘렸을 수 있다
            'at_limit': at_limit,
            # 구글 검색 쿼리가 상한(100건)에 닿으면 쿼리를 더 쪼개야 한다
            'needs_split': bool(at_limit and name in queries),
            # 받은 기사 중 가장 오래된 것이 직전 수집 시각보다 늦으면 그 사이 기사를 놓쳤을 수 있다
            'gap_risk': bool(ok and r.get('oldest') and old.get('last_run_at') and r['oldest'] > old['last_run_at']),
            'error': None if ok else r.get('error'),
            'kind': 'board' if name in boards else 'search' if name in queries else 'rss',
        }
        for src, n in r.get('blocked', {}).items():
            blocked_total[src] = blocked_total.get(src, 0) + n
    for name, org in RSS_SUBSTITUTE.items():  # RSS 점검 중이면 같은 기관의 게시판 수집이 성공했는지 보고 '참고' 로 표시
        s_ = sources.get(name)
        if s_ and not s_['ok'] and any(sources[b]['ok'] for b in boards if b in sources and results.get(b, {}).get('source') == org):
            s_['note'] = '점검 중(게시판으로 대체 수집)'
    status = {'last_run': {'started_at': started, 'finished_at': datetime.now(timezone.utc).isoformat(),
                           'candidates': total, 'added': added,
                           'failed': [n for n, v in sources.items() if not v['ok'] and not v.get('note')],
                           'noted': [n for n, v in sources.items() if not v['ok'] and v.get('note')],
                           'blocked': blocked_total},
              'sources': sources}
    data_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(status, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def merge_found(articles: dict, found: list) -> None:
    for a in found:
        k = dedupe_key(a)
        prev = articles.get(k)
        articles[k] = prefer(a, prev) if prev else a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data-dir', default='data')
    ap.add_argument('--config-dir', default='config')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--backfill', action='store_true', help='게시판을 더 깊이(config/boards.json backfill_pages) 한 번 읽어 과거 글을 채움')
    ap.add_argument('--reindex', action='store_true', help='네트워크 없이 index.json(월 목록)과 trends.json 만 다시 만듦(월 파일을 옮기거나 지운 뒤)')
    ap.add_argument('--rescore', action='store_true', help='네트워크 없이 저장된 기사의 중요도(★)만 config/score.json 산식으로 다시 계산')
    ap.add_argument('--reclassify', action='store_true', help='네트워크 없이 저장된 기사를 현재 분류 규칙으로 재분류(관련도 relevant 포함)')
    args = ap.parse_args()
    cdir = Path(args.config_dir)
    boards_cfg = load_json(cdir / 'boards.json', {'boards': []})
    RELEVANT_DEPTS.update(boards_cfg.get('relevant_departments', []))
    if args.reindex:
        reindex(Path(args.data_dir), cdir)
        return 0
    if args.reclassify:
        reclassify(Path(args.data_dir))
        return 0
    if args.rescore:
        summary = rescore(Path(args.data_dir))
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    sources, queries, max_age = load_sources(cdir)
    aliases = SourceAliases.load(cdir / 'source_aliases.json')
    aliases.canonical |= {r[3] for r in sources if r[3]} | {b['source'] for b in boards_cfg['boards']}  # 고정 출처명은 이미 표준 이름
    tfilter = TitleFilter.load(cdir / 'title_filters.json')
    blocked = Blocked.load(cdir / 'blocked_sources.json')
    unmapped: set[str] = set()
    articles, failed, results = {}, [], {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futs = {pool.submit(collect_source, s, now_iso, aliases, unmapped, tfilter, blocked, max_age if s[0] in queries else None): s[0] for s in sources}
        for f in as_completed(futs):
            name = futs[f]
            try:
                found, skipped = f.result()
                logging.info('%s: %d 건 (관련도 낮음 %d, 제외 %s, 피드 %d건)', name, len(found), skipped['skipped'].get('low_relevance', 0), skipped['skipped'], skipped['feed_size'])
                results[name] = {'ok': True, 'kept': len(found), 'blocked': skipped['blocked'], **skipped_stats(skipped)}
                merge_found(articles, found)
            except Exception as e:
                failed.append(name)
                results[name] = {'ok': False, 'error': safe_error(e)}
                logging.warning('%s 실패: %s', name, str(e)[:180])
    for i, spec in enumerate(boards_cfg['boards']):  # 게시판은 같은 사이트에 순서대로(요청 간격 유지)
        name = spec['name']
        if i:
            time.sleep(max(boards_cfg.get('delay_s', 1.2), 1.2))
        try:
            found, skipped = collect_board(spec, boards_cfg, now_iso, args.backfill, tfilter, blocked)
            logging.info('%s: %d 건 (관련도 낮음 %d, %d페이지, 게시글 %d건)', name, len(found), skipped['skipped'].get('low_relevance', 0), skipped['pages'], skipped['feed_size'])
            results[name] = {'ok': True, 'kept': len(found), 'source': spec['source'], 'blocked': skipped['blocked'], **skipped_stats(skipped)}
            merge_found(articles, found)
        except Exception as e:
            failed.append(name)
            results[name] = {'ok': False, 'error': safe_error(e), 'source': spec['source']}
            logging.warning('%s 실패: %s', name, str(e)[:180])
    if unmapped:
        logging.info('미매핑 출처 %d개(원래 이름 유지): %s', len(unmapped), ', '.join(sorted(unmapped)))
    added = 0
    if not articles:
        logging.warning('수집된 기사 없음 — 기존 데이터 유지')
    elif args.dry_run:
        logging.info('dry-run: %d 건 (저장 안 함)', len(articles))
        rel = sum(1 for a in articles.values() if a['relevant'])
        logging.info('dry-run: 관련 %d건 / 관련도 낮음 %d건', rel, len(articles) - rel)
    else:
        added = save(list(articles.values()), Path(args.data_dir), aliases, tfilter)
        logging.info('후보 %d건, 신규 저장 %d건', len(articles), added)
    if not args.dry_run:
        names = [r[0] for r in sources] + [b['name'] for b in boards_cfg['boards']]
        write_status(Path(args.data_dir), now_iso, results, len(articles), added, names, queries, {b['name'] for b in boards_cfg['boards']})
        try:
            write_trends(Path(args.data_dir), cdir / 'keywords.json')
        except Exception as e:  # 집계 실패가 수집을 막지 않는다
            logging.warning('trends 집계 실패: %s', e)
    logging.info('실패 피드: %s', ', '.join(failed) or '없음')
    return 0  # 부분 실패는 워크플로를 실패시키지 않음


if __name__ == '__main__':
    sys.exit(main())
