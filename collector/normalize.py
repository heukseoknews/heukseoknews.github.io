"""제목·출처 정규화 + 기존 데이터(data/*.json) 일괄 정리(멱등)."""
from __future__ import annotations
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


ORG_SUFFIX = re.compile(r'\s+[-–|]\s+(금융위원회|금융감독원)\s*$')


def strip_org_suffix(title: str) -> str:
    """감독당국 제목 끝의 기관명 접미사(' - 금융위원회', ' - 금융감독원 - 금융감독원' 등)를 반복 제거."""
    prev = None
    while prev != title:
        prev, title = title, ORG_SUFFIX.sub('', title)
    return title.strip()





def dedupe_key(a) -> str:
    return re.sub(r'\s+', '', a['title']).casefold() + '|' + a['source'].strip().casefold()


def is_google(a) -> bool:
    return urlsplit(a['url']).netloc.endswith('news.google.com')


def prefer(new, old):
    """같은 기사 중복 시 남길 쪽: 직접 링크 > 구글 중간 링크, 공식(press) > media, 관련 있음 > 관련도 낮음."""
    rank = lambda a: (not is_google(a), a['source_type'] == 'press', a.get('relevant', True))
    return new if rank(new) > rank(old) else old


class TitleFilter:
    """config/title_filters.json: 메뉴·목록 페이지 이름만 있는 노이즈 제목을 걸러낸다."""

    def __init__(self, min_chars: int = 0, exact: list[str] | None = None):
        self.min_chars = min_chars
        self.exact = {re.sub(r'\s+', '', e) for e in (exact or [])}

    @classmethod
    def load(cls, path: Path) -> 'TitleFilter':
        try:
            cfg = json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return cls()
        return cls(cfg.get('min_chars', 0), cfg.get('exact'))

    def is_junk(self, title: str) -> bool:
        sq = re.sub(r'\s+', '', title)
        return len(sq) < self.min_chars or sq in self.exact


class SourceAliases:
    """config/source_aliases.json: 도메인(우선) → 이름 순으로 언론사명을 정규화."""

    def __init__(self, domains: dict | None = None, names: dict | None = None):
        self.domains, self.names = domains or {}, names or {}
        self.canonical = set(self.domains.values()) | set(self.names.values())

    @classmethod
    def load(cls, path: Path) -> 'SourceAliases':
        try:
            cfg = json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return cls()
        return cls(cfg.get('domains'), cfg.get('names'))

    def resolve(self, name: str, href: str | None = None) -> tuple[str, bool]:
        """(정규화된 이름, 매핑·확인 여부). 근거 없으면 원래 이름과 False."""
        host = (urlsplit(href).hostname or '').lower() if href else ''
        for d, out in self.domains.items():
            if host == d or host.endswith('.' + d):
                return out, True
        if name in self.names:
            return self.names[name], True
        return name, name in self.canonical


def normalize_article(a: dict, aliases: SourceAliases | None = None) -> dict:
    a['title'] = strip_org_suffix(a['title'])
    if aliases and a.get('source_type') == 'media':
        a['source'] = aliases.resolve(a['source'])[0]
    return a


def normalize_shards(data_dir: Path, aliases: SourceAliases | None = None, tfilter: TitleFilter | None = None) -> int:
    """기존 월 파일의 제목/출처를 현재 규칙으로 다시 정리하고, 정리 결과 같아진 기사는 합친다. 바뀐 파일 수 반환."""
    changed = 0
    for path in sorted(data_dir.glob('????-??.json')):
        rows = json.loads(path.read_text(encoding='utf-8'))
        before = json.dumps(rows, ensure_ascii=False)
        rows = [normalize_article(a, aliases) for a in rows]
        if tfilter:
            rows = [a for a in rows if not tfilter.is_junk(a['title'])]  # 기존 데이터에서도 노이즈 제목 제거
        merged: dict[str, dict] = {}
        for a in rows:  # 정규화로 제목+출처가 같아진 기사는 합친다(직접 링크 우선, 수집시각은 더 이른 쪽 유지)
            k = dedupe_key(a)
            if k in merged:
                first = min(a['collected_at'], merged[k]['collected_at'])
                a = prefer(a, merged[k])
                a['collected_at'] = first
            merged[k] = a
        rows = sorted(merged.values(), key=lambda x: x['published_at'], reverse=True)
        if json.dumps(rows, ensure_ascii=False) != before:
            path.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
            changed += 1
    return changed
