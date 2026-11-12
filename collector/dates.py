"""피드 날짜 문자열 해석(표준 라이브러리만). collect.parse_date 가 feedparser 보다 먼저 쓴다.

받아들이는 변형:
- RFC 822/2822: 요일 유무·쉼표 뒤 공백 없음('Thu,12 Nov 2026 10:01:20 +0900')·공백 여러 개·요일 전체 이름,
  RFC 850 의 2자리 연도('Thursday, 12-Nov-26 10:00:00 GMT'), 초 없음
- ISO 8601: '2026-11-12T10:00:00+09:00', 'Z', 소수 초, 타임존 없음
- 숫자 날짜: 'YYYY-MM-DD[ HH:MM[:SS]]', 'YYYY.MM.DD …', 'YYYY/MM/DD …' (feedparser 는 '2026.11.12 10:00' 을 11월 1일로 잘못 읽는다)
- 타임존 표기: +0900, +09:00, GMT/UTC/Z, 'GMT+9'·'UTC+09:00'·'GMT+0900', KST(+0900), 미국 표준 약어(EST·PDT 등)
타임존이 없으면 피드 설정 tz(기본 Asia/Seoul)의 현지 시각으로 본다. '-0000'(RFC 의 '모름')은 UTC 로 본다(이전 동작과 같음).
읽지 못하면 None.
"""
from __future__ import annotations
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

DEFAULT_TZ = 'Asia/Seoul'
_WEEKDAY = re.compile(r'^\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*,?\s*', re.I)
_GMT_OFFSET = re.compile(r'\b(?:GMT|UTC)\s*([+-])(\d{1,2})(?::?(\d{2}))?\b', re.I)
_RFC850 = re.compile(r'^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\b')
_NUMERIC = re.compile(r'^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$')
_NAMED = {'KST': '+0900', 'JST': '+0900'}


def _local(dt: datetime, tz: str) -> datetime:
    return dt.replace(tzinfo=ZoneInfo(tz)) if dt.tzinfo is None else dt


def parse(raw: str | None, tz: str = DEFAULT_TZ) -> datetime | None:
    """날짜 문자열 → 타임존 있는 datetime(없으면 tz 현지 시각). 읽지 못하면 None."""
    s = re.sub(r'\s+', ' ', (raw or '').strip())
    if not s:
        return None
    # ISO 8601
    iso = s.replace('Z', '+00:00') if s.endswith('Z') else s
    if re.match(r'^\d{4}-\d{2}-\d{2}T', iso):
        try:
            return _local(datetime.fromisoformat(iso), tz)
        except ValueError:
            pass
    # 숫자 날짜(타임존 없음 → 피드 현지 시각)
    m = _NUMERIC.match(s)
    if m:
        y, mo, d, hh, mm, ss = (int(x) if x else 0 for x in m.groups())
        try:
            return datetime(y, mo, d, hh, mm, ss, tzinfo=ZoneInfo(tz))
        except ValueError:
            return None
    # RFC 822 계열: 요일 제거, RFC 850 날짜, 타임존 표기 정규화
    t = _WEEKDAY.sub('', s)
    t = _RFC850.sub(lambda x: f'{x.group(1)} {x.group(2)} {x.group(3)}', t)
    t = _GMT_OFFSET.sub(lambda x: f'{x.group(1)}{int(x.group(2)):02d}{x.group(3) or "00"}', t)
    t = re.sub(r'([+-])(\d{2}):(\d{2})\s*$', r'\1\2\3', t)
    for k, v in _NAMED.items():
        t = re.sub(rf'\b{k}\s*$', v, t)
    try:
        dt = parsedate_to_datetime(t)
    except (TypeError, ValueError, IndexError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:  # 타임존 없음, 또는 '-0000'
        return dt.replace(tzinfo=timezone.utc) if re.search(r'-0000\s*$', t) else _local(dt, tz)
    return dt


def to_utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()

