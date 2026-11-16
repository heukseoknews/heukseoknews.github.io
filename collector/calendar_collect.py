"""채용·시험 일정 캘린더 자동 수집(1단계). 화면은 /calendar/ (docs/calendar.md).

출처는 channels/<채널>/calendar.json 의 sources 로 정한다.
  - ccfddl: 학회 마감일 공개 데이터(github.com/ccfddl/ccf-deadlines, MIT). 학회별 YAML 을 ETag/If-Modified-Since 로 받는다.
  - kidi: 보험개발원 보험전문인시험 일정표(정적 HTML). 보험계리사·손해사정사·보험중개사 회차별 공고·접수·시험·합격 발표.
결과: data/calendar/auto.json(일정 목록), data/calendar/status.json(출처별 마지막 시도·성공·오류·건수).
저장하는 것은 제목·기관·날짜·링크·종류·채널·출처·확인일(+ 식별용 id, 원래 시간대 표기)뿐이다. 공고 본문은 저장하지 않는다.

실패 허용: 가져오기·파싱이 실패하거나 결과가 이전보다 비정상적으로 적으면(이전엔 있었는데 0건, 또는 절반 미만) 그 출처의 이전 일정을
그대로 두고 status 에 실패와 시각만 남긴다. 출처마다 하루 한 번(MIN_INTERVAL_H)만 요청한다(--force 로 무시).
  python collector/calendar_collect.py [--dry-run] [--force] [--data-dir data/calendar]
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
import yaml
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
UA = 'ActuaryNewsHub/3.0 (personal schedule reader; metadata only)'
DELAY_S = 1.2           # 같은 사이트 요청 간격(CLAUDE.md: 1.2초 이상)
MIN_INTERVAL_H = 20     # 출처당 하루 한 번
PARSER_VERSION = 2      # 파서를 바꾸면 올린다: 저장된 ETag 와 버전이 다르면 조건부 요청을 하지 않고 새로 받아 다시 파싱
KST = timezone(timedelta(hours=9))
KINDS = ('exam', 'job', 'conf', 'admission')   # 시험·채용·학회·입시
CHANNELS = ('finance', 'insurance', 'ai')

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
log = logging.getLogger('calendar')


# ───────── 시간대 ─────────
def tz_of(label: str | None):
    """ccfddl timezone 표기 → tzinfo. 없으면 AoE(ccfddl 규칙). 모르는 표기는 None."""
    t = (label or 'AoE').strip()
    if t in ('AoE', 'AOE'):
        return timezone(timedelta(hours=-12))
    if t in ('UTC', 'GMT', 'Z'):
        return timezone.utc
    if t in ('PT', 'PST', 'PDT'):
        return ZoneInfo('America/Los_Angeles')
    m = re.fullmatch(r'(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?', t)
    if m:
        sign = -1 if m.group(1) == '-' else 1
        return timezone(sign * timedelta(hours=int(m.group(2)), minutes=int(m.group(3) or 0)))
    return None


def local_iso(value: str, tzinfo) -> str | None:
    """'2027-01-28 23:59:59' (그 시간대의 벽시계) → '2027-01-28T23:59:59-12:00'. 'TBD' 등은 None."""
    m = re.fullmatch(r'\s*(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*', str(value))
    if not m or tzinfo is None:
        return None
    y, mo, d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    if m.group(4) is None:
        h, mi, s = 23, 59, 59   # 시각이 없으면 그날 끝(ccfddl 규칙)
    return datetime(y, mo, d, h, mi, s, tzinfo=tzinfo).isoformat()


MONTHS = {m: i for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
                                       'september', 'october', 'november', 'december'], 1)}


def conf_dates(text: str | None) -> tuple[str, str] | None:
    """학회 개최 기간 'June 22-25, 2027' · 'May 01-04, 2023' · 'November 28-December 1, 2022' → (시작일, 끝일). 그 밖의 표기는 None."""
    if not text:
        return None
    m = re.fullmatch(r'\s*([A-Za-z]+)\.?\s+(\d{1,2})\s*[-–~]\s*(?:([A-Za-z]+)\.?\s+)?(\d{1,2}),?\s*(\d{4})\s*', text)
    if not m:
        m1 = re.fullmatch(r'\s*([A-Za-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})\s*', text)
        if not m1 or m1.group(1).lower() not in MONTHS:
            return None
        d = date(int(m1.group(3)), MONTHS[m1.group(1).lower()], int(m1.group(2))).isoformat()
        return d, d
    m1, d1, m2, d2, y = m.groups()
    if m1.lower() not in MONTHS or (m2 and m2.lower() not in MONTHS):
        return None
    try:
        a = date(int(y), MONTHS[m1.lower()], int(d1))
        b = date(int(y), MONTHS[(m2 or m1).lower()], int(d2))
    except ValueError:
        return None
    return (a.isoformat(), b.isoformat()) if a <= b else None


# ───────── ccfddl ─────────
CC_LABEL = {'abstract_deadline': '초록 마감', 'deadline': '논문 마감', 'decision_deadline': '결과 발표'}


def parse_ccfddl(text: str, stem: str, today: date, checked: str, keep_years: int = 1) -> list[dict]:
    """학회 YAML 하나 → 일정. 올해-keep_years 이후 회차만. 초록·논문 마감, 결과 발표, 학회 개최(날짜)."""
    data = yaml.safe_load(text)
    if not isinstance(data, list):
        raise ValueError('YAML 최상위가 목록이 아님')
    out: list[dict] = []
    for conf in data:
        title = str(conf.get('title') or stem.upper())
        for c in conf.get('confs') or []:
            year = int(c.get('year') or 0)
            if year < today.year - keep_years:
                continue
            cid = str(c.get('id') or f'{stem}{year % 100:02d}')
            link = str(c.get('link') or '')
            tzl = str(c.get('timezone') or 'AoE')
            tzinfo = tz_of(tzl)
            name = f'{title} {year}'
            base = {'org': title, 'kind': 'conf', 'channel': 'ai', 'link': link, 'source': 'ccfddl', 'checked': checked}
            for i, tl in enumerate(c.get('timeline') or []):
                note = str(tl.get('comment') or '').strip()
                note = f' ({note})' if note and len(note) <= 24 else ''   # 짧은 설명(예: ARR Submission)만 제목에
                for key, label in CC_LABEL.items():
                    iso = local_iso(tl.get(key), tzinfo) if tl.get(key) else None
                    if iso:
                        out.append({'id': f'ccfddl:{stem}:{cid}:{i}:{key}', 'title': f'{name} {label}{note}',
                                    'start': iso, 'tz': tzl, **base})
            span = conf_dates(c.get('date'))
            if span:
                out.append({'id': f'ccfddl:{stem}:{cid}:date', 'title': f'{name} 학회 개최', 'start': span[0],
                            'end': span[1] if span[1] != span[0] else None, 'tz': None, **base})
    return out


# ───────── 보험개발원 보험전문인시험 ─────────
KDATE = re.compile(r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(?:\([^)]*\))?\s*(?:(\d{1,2}):(\d{2}))?')


def kdate(m: re.Match) -> str:
    y, mo, d, h, mi = m.groups()
    if h is None:
        return date(int(y), int(mo), int(d)).isoformat()
    return datetime(int(y), int(mo), int(d), int(h), int(mi), tzinfo=KST).isoformat()


def kidi_exam_name(heading: str) -> tuple[str, str] | None:
    """'제49회 보험전문인 제1차시험 일정표' → ('49', '제49회 보험계리사·손해사정사 제1차시험'), '제32회 보험중개사시험' → ('32', '제32회 보험중개사시험')."""
    h = re.sub(r'\s+', ' ', heading).strip()
    m = re.match(r'제\s*(\d+)\s*회\s*(.+?)(?:\s*일정표)?$', h)
    if not m:
        return None
    rest = m.group(2).replace('보험전문인', '보험계리사·손해사정사')
    return m.group(1), f'제{m.group(1)}회 {rest}'


def kidi_step(desc: str) -> str | None:
    d = re.sub(r'\s+', ' ', desc)
    if '합격자' in d and '발표' in d:
        return '합격자 발표'
    if '응시원서' in d and '접수' in d:
        return '원서 접수'
    if '시험실시' in d and '공고' in d:
        return '시행 공고'
    if '시험실시' in d:
        return '시험'
    return None   # 영어성적 등록·경력 서류 등은 넣지 않는다


def parse_kidi(html: str, url: str, checked: str) -> list[dict]:
    soup = BeautifulSoup(html, 'html.parser')
    out: list[dict] = []
    for table in soup.find_all('table'):
        h = table.find_previous('h4')
        named = kidi_exam_name(h.get_text(' ', strip=True)) if h else None
        if not named:
            continue
        rnd, exam = named
        sub = re.search(r'제(\d)차', exam)
        rows: list[tuple[str, list[re.Match]]] = []
        for tr in table.find_all('tr'):
            cells = tr.find_all(['th', 'td'])   # 날짜 칸은 th(행 머리), 내용 칸은 td
            if len(cells) < 2:
                continue
            step = kidi_step(cells[1].get_text(' ', strip=True))
            dates = list(KDATE.finditer(cells[0].get_text(' ', strip=True)))
            if step and dates:
                rows.append((step, dates))
        total = {st: sum(1 for x, _ in rows if x == st) for st, _ in rows}
        seen: dict[str, int] = {}
        for step, dates in rows:
            n = seen[step] = seen.get(step, 0) + 1
            label = f'{step}({n}일차)' if total[step] > 1 else step   # 시험이 이틀이면 '시험(1일차)'·'시험(2일차)'
            key = f"kidi:{'agent' if '중개사' in exam else 'pro'}:{rnd}:{sub.group(1) if sub else '0'}:{step}:{n}"
            out.append({'id': key, 'title': f'{exam} {label}', 'org': '보험개발원', 'kind': 'exam', 'channel': 'insurance',
                        'start': kdate(dates[0]), 'end': kdate(dates[1]) if len(dates) > 1 else None, 'tz': 'KST',
                        'link': url, 'source': 'kidi', 'checked': checked})
    return out


# ───────── 저장·실패 처리 ─────────
def load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        return default


def suspicious(new: int, old: int) -> str | None:
    """이전보다 비정상적으로 적은가: 이전엔 있었는데 0건, 또는 이전 4건 이상에서 절반 미만."""
    if old > 0 and new == 0:
        return f'결과 0건(이전 {old}건)'
    if old >= 4 and new * 2 < old:
        return f'결과 {new}건으로 급감(이전 {old}건)'
    return None


def clean(e: dict) -> dict:
    """저장 필드만, 빈 값은 뺀다."""
    keys = ('id', 'title', 'org', 'kind', 'channel', 'start', 'end', 'tz', 'link', 'source', 'checked')
    return {k: e[k] for k in keys if e.get(k) not in (None, '')}


def merge_source(prev: list[dict], source: str, new: list[dict] | None) -> list[dict]:
    """출처 하나의 일정을 통째로 교체. new 가 None(실패)이면 이전 그대로."""
    if new is None:
        return prev
    return [e for e in prev if e.get('source') != source] + new


def get(session: requests.Session, url: str, headers: dict | None = None) -> requests.Response:
    r = session.get(url, timeout=25, headers={'User-Agent': UA, **(headers or {})})
    if r.status_code not in (200, 304):
        raise RuntimeError(f'HTTP {r.status_code}')
    return r


def due(st: dict, now: datetime, force: bool) -> bool:
    last = st.get('last_attempt_at')
    if force or not last:
        return True
    try:
        return now - datetime.fromisoformat(last) >= timedelta(hours=MIN_INTERVAL_H)
    except ValueError:
        return True


def run_ccfddl(spec: dict, prev: list[dict], st: dict, now: datetime, session, fetch=None) -> tuple[list[dict] | None, dict]:
    """학회별로 받는다. 304 면 이전 일정 유지(확인일만 오늘), 학회 하나가 실패하면 그 학회만 이전 일정 유지.
    반환: (출처 전체의 새 일정 — 모든 학회가 실패하면 None, 상태)"""
    fetch = fetch or get
    base = spec['base_url'].rstrip('/') + '/'
    validators = dict(st.get('validators') or {})
    checked = now.astimezone(KST).date().isoformat()
    new: list[dict] = []
    errors: list[str] = []
    for i, conf in enumerate(spec.get('conferences', [])):
        path, stem = conf['path'], Path(conf['path']).stem
        prefix = f'ccfddl:{stem}:'
        old = [e for e in prev if e['id'].startswith(prefix)]
        if i:
            time.sleep(DELAY_S)
        v = validators.get(path) or {}
        # 조건부 요청은 이전 일정이 있고 같은 파서 버전으로 만든 것일 때만(304 면 이전 일정을 그대로 쓰므로)
        fresh = old and v.get('v') == PARSER_VERSION
        hdr = {k: val for k, val in (('If-None-Match', v.get('etag')), ('If-Modified-Since', v.get('last_modified'))) if val} if fresh else {}
        try:
            r = fetch(session, base + path, hdr)
            if r.status_code == 304:
                new.extend({**e, 'checked': checked} for e in old)   # 바뀌지 않음 = 오늘 확인
                continue
            got = parse_ccfddl(r.text, stem, now.astimezone(KST).date(), checked)
            bad = suspicious(len(got), len(old))
            if bad:
                raise ValueError(bad)
            new.extend(got)
            validators[path] = {**{k: val for k, val in (('etag', r.headers.get('ETag')), ('last_modified', r.headers.get('Last-Modified'))) if val}, 'v': PARSER_VERSION}
        except Exception as e:  # noqa: BLE001 — 학회 하나의 실패는 그 학회만 이전 일정 유지
            errors.append(f'{conf.get("name", stem)}: {str(e)[:120]}')
            new.extend(old)
    status = {'validators': validators, 'errors': errors}
    if errors and len(errors) == len(spec.get('conferences', [])):
        return None, {**status, 'error': '모든 학회 가져오기 실패'}
    return new, status


def run_kidi(spec: dict, prev: list[dict], now: datetime, session, fetch=None) -> tuple[list[dict] | None, dict]:
    fetch = fetch or get
    old = [e for e in prev if e.get('source') == 'kidi']
    try:
        r = fetch(session, spec['url'])
        got = parse_kidi(r.content.decode('utf-8', errors='replace'), spec['url'], now.astimezone(KST).date().isoformat())
        bad = suspicious(len(got), len(old)) or (None if got else '일정을 찾지 못함')
        if bad:
            return None, {'error': bad}
        return got, {}
    except Exception as e:  # noqa: BLE001
        return None, {'error': str(e)[:160]}


def sources_from(config_root: Path) -> list[tuple[str, dict]]:
    out = []
    for f in sorted(config_root.glob('*/calendar.json')):
        for s in load_json(f, {}).get('sources', []):
            out.append((f.parent.name, s))
    return out


def collect(data_dir: Path, config_root: Path, now: datetime | None = None, force: bool = False, dry_run: bool = False,
            session=None, fetchers: dict | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    session = session or requests.Session()
    fetchers = fetchers or {}
    auto_p, status_p = data_dir / 'auto.json', data_dir / 'status.json'
    auto = load_json(auto_p, {'events': []})
    status = load_json(status_p, {'sources': {}})
    events: list[dict] = auto.get('events', [])
    for ch, spec in sources_from(config_root):
        sid, typ = spec['id'], spec['type']
        st = dict(status['sources'].get(sid) or {})
        if not due(st, now, force):
            log.info('%s: 오늘 이미 받음(%s) — 건너뜀', sid, st.get('last_attempt_at'))
            continue
        st['last_attempt_at'] = now.isoformat()
        if typ == 'ccfddl':
            new, extra = run_ccfddl(spec, [e for e in events if e.get('source') == 'ccfddl'], st, now, session, fetchers.get('ccfddl'))
        elif typ == 'kidi':
            new, extra = run_kidi(spec, events, now, session, fetchers.get('kidi'))
        else:
            log.warning('%s: 모르는 출처 종류 %s', sid, typ)
            continue
        st.pop('error', None)
        st.update(extra)
        if new is None:
            st['ok'] = False
            st['last_error_at'] = now.isoformat()
            log.warning('%s: 실패 — 이전 일정 유지: %s', sid, st.get('error'))
        else:
            events = merge_source(events, typ, [clean(e) for e in new])
            st.update(ok=True, last_success_at=now.isoformat(), count=sum(1 for e in events if e.get('source') == typ))
            log.info('%s: %d건%s', sid, st['count'], f" (일부 오류 {len(st.get('errors') or [])})" if st.get('errors') else '')
        st['channel'] = ch
        status['sources'][sid] = st
    events = sorted({e['id']: e for e in events}.values(), key=lambda e: (e['start'], e['id']))
    status['updated_at'] = now.isoformat()
    result = {'events': events}
    if not dry_run:
        data_dir.mkdir(parents=True, exist_ok=True)
        auto_p.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        status_p.write_text(json.dumps(status, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    return {'events': len(events), 'status': status}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--data-dir', default=str(ROOT / 'data' / 'calendar'))
    ap.add_argument('--config-root', default=str(ROOT / 'channels'))
    ap.add_argument('--dry-run', action='store_true', help='파일을 쓰지 않음')
    ap.add_argument('--force', action='store_true', help='하루 한 번 제한 무시')
    a = ap.parse_args()
    r = collect(Path(a.data_dir), Path(a.config_root), force=a.force, dry_run=a.dry_run)
    print(json.dumps({'events': r['events'], 'sources': {k: {x: v.get(x) for x in ('ok', 'count', 'error', 'last_success_at')}
                                                          for k, v in r['status']['sources'].items()}}, ensure_ascii=False, indent=1))
    return 0   # 실패해도 다른 수집·배포를 막지 않는다(실패는 status.json)


if __name__ == '__main__':
    sys.exit(main())
