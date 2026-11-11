"""제목에서 보험사(config/companies.json)·유관기관(config/orgs.json)을 찾는다. 카테고리와 별개의 필터용 메타(companies/orgs 필드).
한글 별칭은 띄어쓰기를 무시한 부분일치, 영문·숫자만인 별칭은 단어 경계, {t,not_before,not_after} 별칭은 앞뒤 글자를 제한한 정규식으로 비교한다.
"""
from __future__ import annotations
import json
import re
from functools import lru_cache
from pathlib import Path

from classify import Matcher, _squash

CONFIG_DIR = Path(__file__).resolve().parent.parent / 'config'


class _Rule:
    """앞뒤 글자를 제한한 별칭(예: '한은' — '신한은행'의 일부가 아니어야 함). 띄어쓰기를 둔 원문 제목에서 찾는다."""

    def __init__(self, spec: dict):
        self.keyword = spec['t']
        pat = re.escape(spec['t'].casefold())
        if spec.get('not_before'):
            pat = f"(?<!{spec['not_before']})" + pat
        if spec.get('not_after'):
            pat += f"(?!{spec['not_after']})"
        self.pat = re.compile(pat)

    def find(self, text: str, squashed: str) -> int:
        m = self.pat.search(text)
        return m.start() if m else -1


class Entities:
    def __init__(self, items: list[dict]):
        self.items = []
        for it in items:
            ms = [(_Rule(a) if isinstance(a, dict) else Matcher(a)) for a in it.get('aliases', [])]
            names = [a['t'] if isinstance(a, dict) else a for a in it.get('aliases', [])]
            self.items.append({'name': it['name'], 'group': it.get('group'), 'matchers': ms, 'aliases': names, 'sources': set(it.get('sources', []))})
        self.alias_keys = {_squash(a) for it in self.items for a in it['aliases'] + [it['name']]}

    def match(self, title: str, source: str | None = None) -> list[str]:
        """제목에 나온 순서대로 정식명 목록(중복 없음). source 가 기관의 공식 출처면 그 기관도 포함."""
        text, sq = title.casefold(), _squash(title)
        found: list[tuple[int, str]] = []
        for it in self.items:
            pos = [p for p in (m.find(text, sq) for m in it['matchers']) if p >= 0]
            if pos:
                found.append((min(pos), it['name']))
            elif source and source in it['sources']:
                found.append((10_000, it['name']))
        return [n for _, n in sorted(found, key=lambda x: x[0])]

    def strip_tags(self, tags: list[str]) -> list[str]:
        """분류 키워드 태그 중 보험사·기관 이름과 같은 것은 빼서(필터의 정식명으로 통일) 중복 표기를 막는다."""
        return [t for t in tags if _squash(t) not in self.alias_keys]


@lru_cache(maxsize=None)
def load(config_dir: str | None = None) -> tuple['Entities', 'Entities']:
    d = Path(config_dir) if config_dir else CONFIG_DIR
    rd = lambda n, k: json.loads((d / n).read_text(encoding='utf-8')).get(k, []) if (d / n).exists() else []
    return Entities(rd('companies.json', 'companies')), Entities(rd('orgs.json', 'orgs'))


def tag_entities(title: str, source: str | None, tags: list[str]) -> dict:
    """{'companies': [...], 'orgs': [...], 'tags': 보험사·기관 이름을 뺀 태그}."""
    comp, orgs = load()
    return {'companies': comp.match(title), 'orgs': orgs.match(title, source), 'tags': orgs.strip_tags(comp.strip_tags(tags))}


@lru_cache(maxsize=None)
def _relevance_cfg() -> dict:
    d = CONFIG_DIR / 'companies.json'
    return json.loads(d.read_text(encoding='utf-8')).get('relevance', {}) if d.exists() else {}


@lru_cache(maxsize=None)
def _context_cfg() -> dict:
    d = CONFIG_DIR / 'context_exclude.json'
    return json.loads(d.read_text(encoding='utf-8')) if d.exists() else {}


@lru_cache(maxsize=None)
def _context_matchers() -> tuple[list, list]:
    c = _context_cfg()
    mk = lambda items: [_Rule(i) if isinstance(i, dict) else Matcher(i) for i in items]
    return mk(c.get('exclude_words', [])), mk(c.get('business_words', []))


def _without_company_names(title: str) -> str:
    """보험사 이름(별칭 포함)을 뺀 제목. 'KB손해보험' 안의 '보험' 처럼 회사 이름 자체가 보험 사업 단서로 보이는 것을 막는다."""
    sq = _squash(title)
    for al in sorted({_squash(a) for it in load()[0].items for a in it['aliases'] + [it['name']]}, key=len, reverse=True):
        sq = sq.replace(al, ' ')
    return sq


def sports_team_title(title: str) -> bool:
    """보험사 이름이 나오지만 스포츠·연예·방송 기사(흥국생명 배구, 삼성화재 블루팡스 등)로 보이는 제목.
    제목에 보험사 이름과 제외어(config/context_exclude.json)가 함께 있고, 보험사 이름을 뺀 나머지에 보험 사업 단서(보험·순익·실적·상품·출시 등)가 없을 때 참."""
    if not load()[0].match(title):
        return False
    text, sq = title.casefold(), _squash(title)
    excl, biz = _context_matchers()
    if not any(m.find(text, sq) >= 0 for m in excl):
        return False
    rest = _without_company_names(title)
    return not any(m.find(rest, rest) >= 0 for m in biz)


def company_relevant(title: str) -> bool:
    """제목에 보험사가 나오면 '보험' 단어가 없어도 관련 기사로 본다(config/companies.json relevance). 스포츠·연예 맥락이면 아니다."""
    if not _relevance_cfg().get('company_mention_is_relevant'):
        return False
    return bool(load()[0].match(title)) and not sports_team_title(title)
