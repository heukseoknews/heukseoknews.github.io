"""HTML 게시판 직접 수집(금융위·금감원 보도자료). 제목·링크·담당부서·등록일만 읽고 본문·첨부는 읽지 않는다.
config/boards.json 의 parser 이름('fsc','fss')으로 추출기를 고른다. 구조가 바뀌어 0건이면 예외(구조 변경 의심)를 던진다.
"""
from __future__ import annotations
import re, time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

UA = 'ActuaryNewsHub/3.0 (personal reader; metadata only)'
KST = timezone(timedelta(hours=9))
DATE = re.compile(r'(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})')
FSC_ID = re.compile(r'/no010101/(\d+)')


def day_to_utc(y: int, m: int, d: int) -> str:
    """게시판은 날짜(일)만 준다. 한국 시간 09:00 으로 두어 날짜가 어긋나지 않게 UTC 로 저장."""
    return datetime(y, m, d, 9, tzinfo=KST).astimezone(timezone.utc).isoformat()


def _date(text: str) -> str | None:
    m = DATE.search(text or '')
    if not m:
        return None
    try:
        return day_to_utc(*map(int, m.groups()))
    except ValueError:
        return None


def _clean(s: str) -> str:
    return re.sub(r'\s+', ' ', s or '').strip()


def parse_fsc(html: bytes | str) -> list[dict]:
    """금융위 목록: li > .inner > .cont(.subject a, .info '담당부서 : X') + .day. 링크는 영구 URL(/no010101/{id}, 쿼리 제거)."""
    soup = BeautifulSoup(html, 'html.parser')
    out = []
    for inner in soup.select('li > div.inner'):
        a = inner.select_one('div.subject a[href]')
        if not a:
            continue
        m = FSC_ID.search(a['href'])
        pub = _date((inner.select_one('div.day') or inner).get_text(' '))
        title = _clean(a.get('title') or a.get_text(' '))
        if not (m and pub and title):
            continue
        dm = re.search(r'담당부서\s*[:：]\s*([^\s|]+)', inner.select_one('div.info').get_text(' ') if inner.select_one('div.info') else '')
        out.append({'title': title, 'url': f'https://www.fsc.go.kr/no010101/{m.group(1)}', 'published': pub, 'department': dm.group(1) if dm else None})
    return out


def parse_fss(html: bytes | str, base: str = 'https://www.fss.or.kr/') -> list[dict]:
    """금감원 목록: table tbody tr > td.title a(view.do?nttId=), 날짜 td. 링크는 nttId·menuNo 만 남긴 영구 URL."""
    soup = BeautifulSoup(html, 'html.parser')
    out = []
    for tr in soup.select('table tbody tr'):
        a = tr.select_one('td.title a[href]')
        if not a:
            continue
        href = urljoin(base, a['href'])
        q = parse_qs(urlsplit(href).query)
        if 'nttId' not in q:
            continue
        pub = next((d for d in (_date(td.get_text(' ')) for td in tr.find_all('td')) if d), None)
        title = _clean(a.get_text(' '))
        if not (pub and title):
            continue
        path = urlsplit(href).path
        menu = f"&menuNo={q['menuNo'][0]}" if 'menuNo' in q else ''
        tds = [_clean(td.get_text(' ')) for td in tr.find_all('td')]
        dept = tds[2] if len(tds) > 3 else None
        out.append({'title': title, 'url': f"https://www.fss.or.kr{path}?nttId={q['nttId'][0]}{menu}", 'published': pub, 'department': dept})
    return out


PARSERS = {'fsc': parse_fsc, 'fss': parse_fss}


def fetch_board(spec: dict, pages: int, delay: float = 1.2, session: requests.Session | None = None) -> tuple[list[dict], dict]:
    """게시판 1..pages 페이지를 순서대로(요청 간격 delay초) 읽는다. 추출 0건이면 ValueError."""
    parse = PARSERS[spec['parser']]
    s = session or requests.Session()
    items, seen, n_pages = [], set(), 0
    for page in range(1, pages + 1):
        url = spec['url']
        if page > 1:
            url += ('&' if '?' in url else '?') + f"{spec['page_param']}={page}"
        if page > 1:
            time.sleep(delay)
        r = s.get(url, timeout=25, headers={'User-Agent': UA, 'Accept-Language': 'ko'})
        r.raise_for_status()
        rows = parse(r.content)
        n_pages += 1
        if not rows:
            if page == 1:
                raise ValueError('구조 변경 의심: 게시판 목록에서 글을 추출하지 못함(0건)')
            break
        for row in rows:
            if row['url'] not in seen:
                seen.add(row['url']); items.append(row)
    return items, {'pages': n_pages}
