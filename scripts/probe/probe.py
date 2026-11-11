"""기관별 수집 가능성 조사(조사 전용 — 운영 collector/data/사이트와 연결하지 않는다).

  python scripts/probe/probe.py --label mac --out scripts/probe/out/mac.json [--only fsc,fss]

- 각 URL을 요청해 RSS는 feedparser, HTML 게시판은 범용 추출기(앵커 + 같은 행의 날짜)로 최신 글 제목·날짜·링크를 뽑는다.
- 본문/첨부는 가져오지 않는다(링크 유효성은 HEAD 로만 확인). 요청 간 1초 이상 간격, robots.txt 확인.
- 현재 config/categories.json 분류 규칙(collector/classify.py, 읽기 전용)으로 제목 분포를 낸다.
"""
from __future__ import annotations
import argparse, json, re, sys, time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import feedparser
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'collector'))
from classify import classify  # noqa: E402  (읽기 전용 사용)

UA = 'ActuaryNewsHub-probe/1.0 (personal research; metadata only)'
HEADERS = {'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ko,en;q=0.8'}
KST = timezone(timedelta(hours=9))
DELAY = 1.2  # 요청 간 간격(초)
_last = [0.0]

DATE_PATS = [
    re.compile(r'(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})'),
    re.compile(r'(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일'),
]
EN_MONTHS = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
EN_DATE = re.compile(r'(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(20\d{2})|([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})')
ID_PARAM = re.compile(r'(?:^|[?&/])(?:id|no|seq|idx|nttId|ntt_id|bbsNo|bbs_no|artclSeq|brdId|articleNo|bltnNo|seqNo|list_no|b_idx|sn|cdVl|bid|pubNo|article_id)[=/]\d+|/\d{5,}', re.I)
NOISE_HREF = re.compile(r'(getFile|boardDownload|/download|Download\.do|\.(hwpx?|pdf|xlsx?|zip|docx?|pptx?)(\?|$)|^mailto:|^tel:)', re.I)
NOISE_TITLE = re.compile(r'^(파일\s*다운로드|첨부파일.*|다운로드|바로가기|더보기|목록|이전|다음|Continue reading|Read more|View all|pdf파일|hwpx?파일|.*\.(hwpx?|pdf|xlsx?)$)', re.I)
TITLE_CLEAN = [(re.compile(r'^(새글|NEW|N)\s+'), ''), (re.compile(r'\.?\s*금일 등록된 게시글\s*$'), ''), (re.compile(r'\s+'), ' ')]
DEPT = re.compile(r'(?:담당부서|소관부서|담당\s*부서)\s*[:：]?\s*([가-힣A-Za-z0-9·]{2,15})')
HEADER_WORDS = ('등록일', '작성일', '게시일', '수정일', '발행일', '날짜', '일자', '작성', 'Date', '등록')


def polite_get(session, url, method='GET', **kw):
    wait = DELAY - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    t0 = time.time()
    try:
        r = session.request(method, url, headers=HEADERS, timeout=25, allow_redirects=True, **kw)
        return r, None, round(time.time() - t0, 2)
    except Exception as e:  # noqa: BLE001 조사 도구라 모든 예외를 기록
        return None, f'{type(e).__name__}: {str(e)[:140]}', round(time.time() - t0, 2)
    finally:
        _last[0] = time.time()


def find_date(text: str, month_only: bool = False) -> str | None:
    for pat in DATE_PATS:
        m = pat.search(text)
        if m:
            y, mo, d = map(int, m.groups())
            try:
                return datetime(y, mo, d).date().isoformat()
            except ValueError:
                pass
    if month_only:  # 'YYYY-MM' 만 있는 목록(예: KIRI 리포트) — 1일로 보정하고 정밀도는 월 단위임을 문서에 표기
        m = re.search(r'(20\d{2})-(0[1-9]|1[0-2])(?![\d-])', text)
        if m:
            return f'{m.group(1)}-{m.group(2)}-01'
    m = EN_DATE.search(text)
    if m:
        g = m.groups()
        d, mon, y = (g[0], g[1], g[2]) if g[0] else (g[4], g[3], g[5])
        mo = EN_MONTHS.get(mon.lower())
        if mo:
            try:
                return datetime(int(y), mo, int(d)).date().isoformat()
            except ValueError:
                pass
    return None


def extract_html(html: bytes, base: str, month_only: bool = False) -> tuple[list[dict], list[str]]:
    """게시판 목록 범용 추출: 앵커가 속한 가장 가까운 '행'(날짜가 하나 들어 있는 조상)에서 날짜를 찾는다."""
    soup = BeautifulSoup(html, 'html.parser')
    for t in soup(['script', 'style', 'nav', 'header', 'footer']):
        t.decompose()
    headers = []
    for th in soup.find_all('th'):
        tx = ' '.join(th.get_text().split())
        if tx and any(w in tx for w in HEADER_WORDS) and tx not in headers:
            headers.append(tx)
    items, seen = [], set()
    for a in soup.find_all('a'):
        title = ' '.join(a.get_text(' ').split())
        href = a.get('href') or ''
        onclick = a.get('onclick') or ''
        for pat, rep in TITLE_CLEAN:
            title = pat.sub(rep, title).strip()
        if len(title) < 6 or href.startswith('#') and not onclick:
            continue
        if NOISE_HREF.search(href) or NOISE_TITLE.match(title):
            continue
        node, date, dept = a, None, None
        for _ in range(5):  # 조상으로 올라가며 날짜가 정확히 하나 있는 행을 찾는다
            node = node.parent
            if node is None or node.name in ('body', 'html'):
                break
            txt = ' '.join(node.get_text(' ').split())
            if len(txt) > 700:
                break
            found = {find_date(p, month_only) for p in [txt]} - {None}
            all_dates = {m.group(0) for pat in DATE_PATS for m in pat.finditer(txt)}
            if found and len(all_dates) <= 2:
                date = next(iter(found))
                dm = DEPT.search(txt)
                dept = dm.group(1) if dm else None
                break
        if not date:
            continue
        is_js = href.lower().startswith('javascript') or (not href or href == '#')
        link = href if is_js else urljoin(base, href)
        raw = onclick or href if is_js else ''
        key = (title[:30], date)
        if key in seen:
            continue
        seen.add(key)
        items.append({'title': title, 'date': date, 'url': link, 'js_link': is_js, 'js_raw': (onclick or href)[:600] if is_js else None, 'dept': dept})
    return items, headers


def build_permalink(item: dict, template: str | None) -> str | None:
    """JS 링크의 따옴표 인자(a1,a2,...)로 영구 URL 후보를 만든다. template 예: 'https://x/view?seq={a1}'"""
    if not template or not item.get('js_raw'):
        return None
    args = re.findall(r"['\"]([^'\"]*)['\"]", item['js_raw'])
    try:
        return template.format(**{f'a{i + 1}': a for i, a in enumerate(args)})
    except (IndexError, KeyError):
        return None


def extract_rss(content: bytes) -> list[dict]:
    feed = feedparser.parse(content)
    out = []
    for e in feed.entries[:50]:
        t = e.get('published_parsed') or e.get('updated_parsed')
        out.append({'title': ' '.join((e.get('title') or '').split()), 'date': datetime(*t[:6]).date().isoformat() if t else None,
                    'url': e.get('link'), 'js_link': False, 'js_raw': None, 'dept': None})
    return out


def robots_info(session, url, cache):
    p = urlsplit(url)
    host = f'{p.scheme}://{p.netloc}'
    if host not in cache:
        r, err, _ = polite_get(session, host + '/robots.txt')
        info = {'fetched': False, 'status': None, 'text_head': ''}
        rp = RobotFileParser()
        if r is not None:
            info.update(fetched=True, status=r.status_code)
            ct = r.headers.get('content-type', '')
            looks_robots = r.ok and 'html' not in ct.lower() and ('user-agent' in r.text.lower() or 'disallow' in r.text.lower())
            info['has_robots'] = bool(looks_robots)
            if looks_robots:
                rp.parse(r.text.splitlines())
                info['text_head'] = r.text[:300]
        else:
            info['error'] = err
        cache[host] = (rp, info)
    rp, info = cache[host]
    allowed = None
    if info.get('has_robots'):
        allowed = rp.can_fetch(UA, url) and rp.can_fetch('*', url)
        info = {**info, 'crawl_delay': rp.crawl_delay('*') or rp.crawl_delay(UA)}
    return {'robots_status': info.get('status'), 'robots_has_file': info.get('has_robots', False), 'robots_allows': allowed,
            'crawl_delay': info.get('crawl_delay') if isinstance(info, dict) else None, 'robots_error': info.get('error')}


def analyze_items(items: list[dict], today: datetime) -> dict:
    dated = [i for i in items if i['date']]
    ds = sorted(i['date'] for i in dated)
    cutoff = (today - timedelta(days=30)).date().isoformat()
    cats = Counter()
    relevant = 0
    for i in items:
        c = classify(i['title'], None)
        i['category'] = c['category']
        cats[c['category']] += 1
        relevant += bool(c['relevant'])
    n = len(items)
    return {'n_items': n, 'newest': ds[-1] if ds else None, 'oldest': ds[0] if ds else None,
            'count_30d_on_page': sum(1 for d in ds if d >= cutoff), 'categories': dict(cats),
            'uncategorized_ratio': round(cats.get('미분류', 0) / n, 3) if n else None,
            'relevance_keyword_ratio': round(relevant / n, 3) if n else None}


def fetch_page(session, spec, page):
    """spec.method/data 지원(POST 검색 폼), page_param 이 있으면 page>1 일 때 쿼리에 붙인다."""
    url = spec['url']
    if page > 1 and spec.get('page_param'):
        url += ('&' if '?' in url else '?') + f"{spec['page_param']}={page}"
    if spec.get('method') == 'POST':
        return polite_get(session, url, method='POST', data=spec.get('data'))
    return polite_get(session, url)


def probe_url(session, target, spec, robots_cache, today):
    url = spec['url']
    res = {'target': target['id'], 'name': target['name'], 'group': target['group'], 'label': spec['label'], 'kind': spec['kind'], 'url': url}
    res.update(robots_info(session, url, robots_cache))
    r, err, secs = fetch_page(session, spec, 1)
    res['elapsed_s'] = secs
    if r is None:
        res.update(ok=False, error=err)
        return res
    res.update(http_status=r.status_code, final_url=r.url, content_type=r.headers.get('content-type', '')[:60], bytes=len(r.content), ok=r.ok)
    if not r.ok:
        res['error'] = f'HTTP {r.status_code}'
        res['body_head'] = r.text[:120].replace('\n', ' ')
        return res
    try:
        if spec['kind'] == 'rss':
            items, headers = extract_rss(r.content), []
        else:
            items, headers = extract_html(r.content, r.url, spec.get('month_only', False))
            # 페이지 확장: 1페이지가 전부 최근 30일이면 다음 페이지도 읽어 30일 건수를 추정(최대 max_pages, 요청 간 1초 이상)
            cutoff = (today - timedelta(days=30)).date().isoformat()
            for pg in range(2, spec.get('max_pages', 1) + 1):
                if not spec.get('page_param') or not items or min((i['date'] for i in items if i['date']), default='') < cutoff:
                    break
                r2, err2, _ = fetch_page(session, spec, pg)
                if r2 is None or not r2.ok:
                    break
                more, _ = extract_html(r2.content, r2.url, spec.get('month_only', False))
                seen = {(i['title'][:30], i['date']) for i in items}
                items += [i for i in more if (i['title'][:30], i['date']) not in seen]
                res['pages_fetched'] = pg
    except Exception as e:  # noqa: BLE001
        res.update(ok=False, error=f'parse {type(e).__name__}: {e}')
        return res
    res['date_headers'] = headers
    res.update(analyze_items(items, today))
    cutoff = (today - timedelta(days=30)).date().isoformat()
    res['count_30d_total'] = sum(1 for i in items if i['date'] and i['date'] >= cutoff)  # 읽은 페이지 전체 기준
    depts = Counter(i['dept'] for i in items if i.get('dept'))
    if depts:
        res['dept_counts'] = dict(depts.most_common(12))
    # 영구 URL 후보 만들기(JS 링크)
    tmpl = spec.get('permalink')
    for i in items:
        i['permalink'] = build_permalink(i, tmpl) if i['js_link'] else None
    res['samples'] = [{k: i.get(k) for k in ('title', 'date', 'url', 'js_link', 'js_raw', 'permalink', 'dept', 'category')} for i in items[:10]]
    direct = [i for i in items if not i['js_link'] and i['url'].startswith('http')]
    res['js_link_ratio'] = round(sum(i['js_link'] for i in items) / len(items), 2) if items else None
    res['link_has_id_param_ratio'] = round(sum(bool(ID_PARAM.search(i['url'])) for i in direct) / len(direct), 2) if direct else None
    # 링크 유효성: 첫 항목의 (직접 또는 permalink) URL 1건만 열어 상태·제목 포함 여부 확인(본문은 저장하지 않고 즉시 버림)
    first = next(((i['url'], i['title']) for i in direct), None) or next(((i['permalink'], i['title']) for i in items if i.get('permalink')), None)
    if first:
        hr, herr, _ = polite_get(session, first[0])
        chk = {'url': first[0], 'status': hr.status_code if hr is not None else None, 'error': herr}
        if hr is not None:
            key = re.sub(r'\s+', '', first[1])[:14]
            chk.update(bytes=len(hr.content), title_found=key in re.sub(r'\s+', '', hr.text))
        res['first_link_check'] = chk
    if not items:
        res['note'] = '추출된 항목 없음(JS 렌더링/구조 상이/차단 가능)'
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', default='local')
    ap.add_argument('--out', default=str(ROOT / 'scripts' / 'probe' / 'out' / 'result.json'))
    ap.add_argument('--only', default='')
    ap.add_argument('--targets', default=str(Path(__file__).with_name('targets.json')))
    a = ap.parse_args()
    targets = json.loads(Path(a.targets).read_text(encoding='utf-8'))
    only = {x for x in a.only.split(',') if x}
    today = datetime.now(KST)
    session = requests.Session()
    ip = {}
    r, _, _ = polite_get(session, 'https://api.ipify.org?format=json')
    if r is not None and r.ok:
        ip = r.json()
    results, robots_cache = [], {}
    for t in targets:
        if only and t['id'] not in only:
            continue
        for spec in t['urls']:
            res = probe_url(session, t, spec, robots_cache, today)
            results.append(res)
            print(f"[{a.label}] {t['id']:12} {spec['label'][:18]:18} ok={res.get('ok')} http={res.get('http_status')} items={res.get('n_items')} newest={res.get('newest')} {res.get('error') or ''}", flush=True)
    out = {'label': a.label, 'run_at_kst': today.isoformat(timespec='seconds'), 'egress_ip': ip.get('ip'), 'results': results}
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('saved', a.out)


if __name__ == '__main__':
    main()
