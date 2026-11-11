"""제목 키워드 기반 분류기. 분류 규칙은 channels/<채널>/categories.json, 중요도(★) 산식은 channels/<채널>/score.json 에서 관리한다."""
from __future__ import annotations
import json
import re
from functools import lru_cache
from pathlib import Path

import channel

UNCATEGORIZED = '미분류'  # 7개 카테고리 탭에는 노출하지 않고 '전체'에서만 보인다
TIERS = {'strong': 3, 'company': 2, 'normal': 1}
DEFAULT_CONFIG = channel.config_path() / 'categories.json'  # 기본 채널(insurance) 경로. 실제 로딩은 현재 채널(channel.config_dir())
DEFAULT_SCORE = DEFAULT_CONFIG.with_name('score.json')
_ASCII = re.compile(r'^[a-z0-9\- ]+$')
# match_mode 'en'(영어·혼합 채널): 영숫자에 . + / 가 섞인 토큰(gpt-4.5, c++)도 단어 경계로 비교한다
_ASCII_EN = re.compile(r'^[a-z0-9][a-z0-9.+/\- ]*$')
MATCH_MODES = ('ko', 'en')


def _squash(s: str) -> str:
    return re.sub(r'\s+', '', s.casefold())


def _en_pattern(k: str) -> re.Pattern:
    """영어 키워드: 단어 경계 + 띄어쓰기·하이픈 변형(open source = open-source = opensource) + 끝이 영문자면 복수형(s/es).
    뒤에 영숫자나 '.숫자'가 오면 불일치(gpt-4.5 가 GPT-4.55 에 걸리지 않게)."""
    body = re.sub(r'(?:\\ |\\-)+', r'[\\s\\-]*', re.escape(k))
    plural = r'(?:e?s)?' if k[-1].isalpha() else ''
    return re.compile(r'(?<![a-z0-9])' + body + plural + r'(?![a-z0-9]|\.\d)')


class Matcher:
    """한글 등: 띄어쓰기 무시 부분일치 / 영문·숫자만 있는 키워드: 영숫자 단어 경계 일치.
    mode 'ko'(기본, 보험 채널): 지금까지의 규칙 그대로. mode 'en': 영어 키워드에 복수형·하이픈 변형·버전 번호 경계를 적용(한글 키워드는 같음)."""

    def __init__(self, keyword: str, mode: str = 'ko'):
        if mode not in MATCH_MODES:
            raise ValueError(f'match_mode 는 {MATCH_MODES} 중 하나: {mode}')
        self.keyword = keyword
        k = keyword.casefold()
        if mode == 'en' and _ASCII_EN.match(k):
            self.kind, self.pat = 'word', _en_pattern(k.strip())
        elif mode == 'ko' and _ASCII.match(k):
            self.kind, self.pat = 'word', re.compile(r'(?<![a-z0-9])' + re.escape(k).replace(r'\ ', r'\s*') + r'(?![a-z0-9])')
        else:
            self.kind, self.pat = 'sub', _squash(keyword)

    def find(self, text: str, squashed: str) -> int:
        """첫 매칭 위치(없으면 -1)."""
        if self.kind == 'word':
            m = self.pat.search(text)
            return m.start() if m else -1
        return squashed.find(self.pat)

    def spans(self, squashed: str) -> list[tuple[int, int]]:
        """띄어쓰기를 제거한 제목에서 일치하는 모든 구간(한글 등 'sub' 키워드 전용)."""
        out, i = [], squashed.find(self.pat)
        while i >= 0:
            out.append((i, i + len(self.pat)))
            i = squashed.find(self.pat, i + 1)
        return out


class Classifier:
    def __init__(self, cfg: dict, score_cfg: dict):
        self.cfg = cfg
        self.score_cfg = score_cfg
        self.priority = cfg['priority']
        self.mode = mode = cfg.get('match_mode', 'ko')
        self.rules: dict[str, list[tuple[Matcher, int]]] = {}
        for cat, spec in cfg['categories'].items():
            items = [(Matcher(k, mode), w) for tier, w in TIERS.items() for k in spec.get(tier, [])]
            items += [(Matcher(k, mode), w) for k, w in spec.get('weighted', {}).items()]
            self.rules[cat] = items
        m = lambda ks: [Matcher(k, mode) for k in ks]
        ex = cfg.get('exclude', {})
        self.exclude, self.unless = m(ex.get('keywords', [])), m(ex.get('unless', []))
        self.combos = [(m(x['any']), m(x['with'])) for x in ex.get('combos', [])]
        # 점수 산식 항목은 모두 선택(없으면 그 규칙을 쓰지 않음). 보험 채널은 전부 설정되어 있다.
        sc = score_cfg
        self.base, self.max_score = sc.get('base', 2), sc.get('max', 5)
        self.excluded_score = sc.get('excluded_score', self.base)
        self.type_bonus = sc.get('source_type_bonus', {})  # 출처 유형별 가산(예: {"press": 1} = 공식 발표 +1, 상한 max)
        low = sc.get('low_importance', {})
        self.low, self.low_max = m(low.get('keywords', [])), low.get('max_score', self.max_score)
        core = sc.get('core_terms', {})
        self.core_groups = [m(g) for g in core.get('groups', [])]
        self.core_add = {int(k): v for k, v in core.get('add_by_count', {}).items()}
        self.core_ignore = [_squash(w) for w in core.get('ignore_inside', [])]
        self.thresholds = sorted((t['top_at_least'], t['add']) for t in sc.get('keyword_thresholds', []))
        mc = sc.get('market_cap', {})
        self.market_cats, self.market_max = set(mc.get('categories', [])), mc.get('max_score', self.max_score)
        company = [k for cat in mc.get('insurance_company_categories', []) for k in cfg['categories'].get(cat, {}).get('company', [])]
        self.insurance_terms = m(mc.get('insurance_terms', []) + company)
        # 관련도: 'substring'(기본, 보험) = 띄어쓰기 지운 제목 부분일치 / 'word' = Matcher(영어 단어 경계). match_mode 'en' 이면 기본 'word'
        self.relevance_mode = cfg.get('relevance_mode', 'word' if mode == 'en' else 'substring')
        if self.relevance_mode not in ('substring', 'word'):
            raise ValueError(f'relevance_mode: {self.relevance_mode}')
        self.relevance = [_squash(k) for k in cfg.get('relevance_keywords', [])]
        self.relevance_m = m(cfg.get('relevance_keywords', []))
        # 공식 발표(press) 기사의 관련도 조건: 제목에 이 낱말 중 하나가 없으면 관련도 낮음. 키가 없으면 조건 없음
        pk = cfg.get('press_relevance_keywords')
        self.press_re = re.compile('|'.join(map(re.escape, pk)), re.I) if pk else None
        self.hints = cfg.get('feed_hints', {})

    def source_bonus(self, score: int, source_type: str | None) -> int:
        b = self.type_bonus.get(source_type or '', 0)
        return min(self.max_score, score + b) if b else score

    def press_ok(self, title: str) -> bool:
        return self.press_re is None or bool(self.press_re.search(title))

    def is_relevant(self, text: str, sq: str) -> bool:
        if self.relevance_mode == 'word':
            return self._any(self.relevance_m, text, sq)
        return any(k in sq for k in self.relevance)

    @staticmethod
    def _any(ms: list[Matcher], text: str, sq: str) -> bool:
        return any(x.find(text, sq) >= 0 for x in ms)

    def classify(self, title: str, feed_name: str | None = None) -> dict:
        text, sq = title.casefold(), _squash(title)
        relevant = self.is_relevant(text, sq)
        scores: dict[str, int] = {}
        hits: list[tuple[int, int, str]] = []  # (-weight, 위치, 키워드)
        for cat, items in self.rules.items():
            found = [(mt, w, mt.find(text, sq)) for mt, w in items]
            found = [f for f in found if f[2] >= 0]
            for mt, w, pos in found:
                # 같은 카테고리에서 더 긴 키워드에 포함되는 키워드('금리' ⊂ '기준금리')는 이중 계산하지 않는다
                if any(o is not mt and _squash(mt.keyword) != _squash(o.keyword) and _squash(mt.keyword) in _squash(o.keyword) for o, _, _ in found):
                    continue
                scores[cat] = scores.get(cat, 0) + w
                hits.append((-w, pos, mt.keyword))
        tags = list(dict.fromkeys(k for _, _, k in sorted(hits)))[:5]

        excluded = self._any(self.exclude, text, sq) or any(self._any(a, text, sq) and self._any(w, text, sq) for a, w in self.combos)
        if excluded and not self._any(self.unless, text, sq):
            return {'category': UNCATEGORIZED, 'sub_categories': [], 'tags': tags, 'score': self.excluded_score, 'relevant': relevant}

        hint = self.hints.get(feed_name or '')
        if scores:
            top = max(scores.values())
            tied = [c for c in self.priority if scores.get(c) == top]
            category = tied[0]  # 동점이면 priority 순 (피드 단서는 쓰지 않는다)
        elif hint:
            category = hint  # 키워드가 전혀 없을 때만 피드 단서
        else:
            category = UNCATEGORIZED
        sub = [c for c, _ in sorted(scores.items(), key=lambda x: -x[1]) if c != category and scores[c] > 0]
        score, _ = self.score(title, category)
        return {'category': category, 'sub_categories': sub, 'tags': tags, 'score': score, 'relevant': relevant}

    # ---- 중요도(★) ----
    def star_top(self, text: str, sq: str, category: str) -> int:
        """대표 카테고리의 키워드 점수 합. 긴 키워드와 겹치는 구간의 짧은 키워드는 세지 않는다.
        1) 더 긴 키워드에 포함되는 키워드('금리' ⊂ '기준금리') 제외  2) 한글 키워드끼리 구간이 겹치면(예: '실[손보]험'의 '실손'/'손보')
        왼쪽부터 가장 긴 것을 택하고 나머지는 제외 — 글자 하나는 키워드 하나에만 속한다."""
        found = [(mt, w) for mt, w in self.rules.get(category, []) if mt.find(text, sq) >= 0]
        kept = [(mt, w) for mt, w in found
                if not any(o is not mt and _squash(mt.keyword) != _squash(o.keyword) and _squash(mt.keyword) in _squash(o.keyword) for o, _ in found)]
        cand = sorted(((s, e, mt) for mt, _ in kept if mt.kind == 'sub' for s, e in mt.spans(sq)), key=lambda x: (x[0], -(x[1] - x[0])))
        alive, last_end = set(), 0
        for s, e, mt in cand:
            if s >= last_end:
                alive.add(id(mt)); last_end = e
        return sum(w for mt, w in kept if mt.kind == 'word' or id(mt) in alive)

    def core_count(self, text: str, sq: str) -> int:
        for w in self.core_ignore:  # '화재보험' 안의 '재보험'처럼 우연한 일치는 핵심어로 세지 않는다
            text, sq = text.replace(w, ' '), sq.replace(w, ' ')
        return sum(1 for g in self.core_groups if self._any(g, text, sq))

    def score(self, title: str, category: str) -> tuple[int, dict]:
        """(★, 근거). 산식은 channels/insurance/score.json."""
        text, sq = title.casefold(), _squash(title)
        top = self.star_top(text, sq, category)
        core = self.core_count(text, sq)
        s = self.base + sum(add for at_least, add in self.thresholds if top >= at_least)
        s += self.core_add.get(min(core, max(self.core_add)), 0) if core and self.core_add else 0
        s = min(self.max_score, s)
        market_capped = category in self.market_cats and not self._any(self.insurance_terms, text, sq) and s > self.market_max
        if market_capped:
            s = self.market_max
        low_capped = self._any(self.low, text, sq) and s > self.low_max
        if low_capped:
            s = self.low_max
        return int(s), {'top': top, 'core_count': core, 'market_capped': market_capped, 'low_capped': low_capped}


def load(path: str | None = None, score_path: str | None = None) -> Classifier:
    d = channel.config_dir()
    return _load(str(path or d / 'categories.json'), str(score_path or d / 'score.json'))


@lru_cache(maxsize=None)
def _load(path: str, score_path: str) -> Classifier:
    rd = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
    return Classifier(rd(path), rd(score_path))


def classify(title: str, feed_name: str | None = None) -> dict:
    return load().classify(title, feed_name)
