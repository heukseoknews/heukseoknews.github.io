"""같은 사건 묶기. 설정은 channels/<채널>/cluster.json(기본 꺼짐). 표준 라이브러리만 쓴다.

방법(docs/article-quality-plan.md 실험 결과로 선택):
- 제목 정규화: NFKC·소문자, 머리말 태그([포토]·[단독]·(종합) 등)·끝의 '- 매체명' 제거, synonyms 치환
- 토큰: 한글은 글자 2-gram, 영문은 소문자 단어(간단한 어간), 숫자+단위(961억·34%)는 한 토큰 → TF-IDF(최근 idf_days 기사로 계산)
- 묶기: 발행 시각 순으로 한 건씩, 시간 창(window_hours) 안 묶음의 중심 벡터(구성원 벡터 합)와 코사인이 threshold 이상인
  가장 가까운 묶음에 넣는다(연결 요소 방식의 A-B-C 연쇄를 막음).
  · 회사 거부(company_veto): 기사와 묶음의 회사·기관 태그가 둘 다 있는데 겹치지 않으면 넣지 않음(같은 형식의 다른 회사 실적)
  · 같은 매체(same_source_threshold): 묶음에 같은 매체 기사가 있으면 더 높은 기준(정형 제목 'Case Study - X' 방지)
  · 시간 폭(max_span_hours): 묶음의 첫 기사와 마지막 기사 사이가 이 시간을 넘지 않게(후속 보도 연쇄 방지)
  · 묶음 합치기(merge_threshold): 이번 실행에서 새로 생긴 묶음이 다른 묶음과 중심끼리 코사인이 이 값 이상이면 합친다(같은 사건이 두 묶음으로 갈라지는 것 방지)
- 증분: 이미 2건 이상으로 묶인 기사의 묶음은 바꾸지 않는다(cluster_id 고정, 고정 묶음끼리는 합치지 않음). 묶이지 않은 최근(lookback_days) 기사만 새로 판정.

기사에 쓰는 선택 필드(docs/data-contract.md): cluster_id, cluster_size, cluster_sources, cluster_lead. 혼자인 기사에는 쓰지 않는다.
"""
from __future__ import annotations
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from urllib.parse import urlsplit

FIELDS = ('cluster_id', 'cluster_size', 'cluster_sources', 'cluster_lead')
DEFAULTS = {'enabled': False, 'window_hours': 72, 'threshold': 0.3, 'same_source_threshold': 0.6, 'company_veto': True,
            'merge_threshold': 0.4, 'max_span_hours': 96, 'lookback_days': 10, 'idf_days': 30, 'synonyms': {}}

TAG = re.compile(r'^\s*(?:\[[^\]]{1,20}\]|【[^】]{1,20}】|<[^>]{1,20}>|\([^)]{1,8}\))\s*')
TAIL_TAG = re.compile(r'\s*(?:\((?:종합|상보|속보|1보|2보|3보|단독|영상|포토|사진)[^)]{0,6}\)|\[[^\]]{1,12}\])\s*$')
SOURCE_TAIL = re.compile(r'\s+[-–|]\s+[^-–|]{1,25}$')
HANGUL = re.compile(r'[가-힣]+')
LATIN = re.compile(r'[a-z][a-z0-9]*(?:[.\-][a-z0-9]+)*')
NUMUNIT = re.compile(r'\d+(?:[.,]\d+)*(?:%|조|억|만|천|원|명|건|개|배|위|bp|년|월|일|분기|세|곳|호|기|차|m|b|k)?')
EN_STOP = frozenset('a an the of to in on for and or with by at from as is are be its it this that new how why what who into over after vs via '
                    'about your our we you their his her up out more most than just now will can may could should not no yes s'.split())


def ts(a: dict) -> float:
    return datetime.fromisoformat(a['published_at']).timestamp()


def normalize(title: str, source: str | None = None, synonyms: dict | None = None) -> str:
    t = unicodedata.normalize('NFKC', title).casefold()
    prev = None
    while prev != t:
        prev, t = t, TAG.sub('', t)
    t = TAIL_TAG.sub('', t)
    m = SOURCE_TAIL.search(t)
    if m and source and source.casefold() in m.group(0):  # 제목 끝의 ' - 머니투데이'
        t = t[: m.start()]
    for k, v in (synonyms or {}).items():
        t = t.replace(k.casefold(), f' {v.casefold()} ')
    return re.sub(r'\s+', ' ', t).strip()


def stem(w: str) -> str:
    """아주 단순한 영어 어간: launches/launched/launching/launch → launch, releases/release → releas."""
    if not w.isalpha():
        return w
    for suf, rep in (('ies', 'y'), ('ing', ''), ('ed', ''), ('es', ''), ('s', '')):
        if len(w) > len(suf) + 3 and w.endswith(suf) and not w.endswith('ss'):
            w = w[: -len(suf)] + rep
            break
    return w[:-1] if len(w) > 4 and w.endswith('e') else w


def tokens(title: str, source: str | None = None, synonyms: dict | None = None) -> list[str]:
    """한글 2-gram + 영문 단어(어간) + 숫자 토큰. 한 글자 한글 구간은 그대로 1토큰."""
    t = normalize(title, source, synonyms)
    out = ['#' + m.group(0) for m in NUMUNIT.finditer(t)]
    t2 = NUMUNIT.sub(' ', t)
    out += [stem(w) for w in LATIN.findall(t2) if w not in EN_STOP and len(w) > 1]
    for s in HANGUL.findall(t2):
        out.extend([s] if len(s) < 2 else [s[i:i + 2] for i in range(len(s) - 1)])
    return out


class Vectorizer:
    def __init__(self, docs: list[list[str]]):
        df = Counter(t for d in docs for t in set(d))
        self.n = len(docs)
        self.idf = {t: math.log((1 + self.n) / (1 + c)) + 1.0 for t, c in df.items()}
        self.unk = math.log(1 + self.n) + 1.0

    def __call__(self, d: list[str]) -> dict[str, float]:
        v = {t: (1 + math.log(c)) * self.idf.get(t, self.unk) for t, c in Counter(d).items()}
        nrm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {t: x / nrm for t, x in v.items()}


class _Group:
    __slots__ = ('cid', 'vec', 'norm', 'first', 'last', 'ents', 'sources', 'members')

    def __init__(self, cid: str):
        self.cid, self.vec, self.norm = cid, {}, 0.0
        self.first, self.last = math.inf, -math.inf
        self.ents: set[str] = set()
        self.sources: set[str] = set()
        self.members: list[dict] = []

    def add(self, a: dict, v: dict, t: float, ents: set[str]) -> None:
        for k, x in v.items():
            self.vec[k] = self.vec.get(k, 0.0) + x
        self.norm = math.sqrt(sum(x * x for x in self.vec.values()))
        self.first, self.last = min(self.first, t), max(self.last, t)
        self.ents |= ents
        self.sources.add(a['source'])
        self.members.append(a)

    def sim(self, v: dict) -> float:
        return sum(x * self.vec.get(k, 0.0) for k, x in v.items()) / (self.norm or 1.0)

    def gsim(self, o: '_Group') -> float:
        a, b = (self, o) if len(self.vec) <= len(o.vec) else (o, self)
        return sum(x * b.vec.get(k, 0.0) for k, x in a.vec.items()) / ((self.norm * o.norm) or 1.0)

    def absorb(self, o: '_Group') -> None:
        for k, x in o.vec.items():
            self.vec[k] = self.vec.get(k, 0.0) + x
        self.norm = math.sqrt(sum(x * x for x in self.vec.values()))
        self.first, self.last = min(self.first, o.first), max(self.last, o.last)
        self.ents |= o.ents
        self.sources |= o.sources
        self.members += o.members


def _ents(a: dict) -> set[str]:
    return set(a.get('companies') or [])


def assign(rows: list[dict], cfg: dict, now: datetime | None = None) -> dict:
    """rows(채널 전체 기사)에 묶음 필드를 쓴다(제자리). now: 기준 시각(기본: 가장 최근 발행 시각). 반환: 요약."""
    c = {**DEFAULTS, **cfg}
    if not rows:
        return {'articles': 0, 'groups': 0, 'clustered': 0, 'new_assigned': 0}
    times = {a['id']: ts(a) for a in rows}
    ref = now.timestamp() if now else max(times.values())
    win, look = c['window_hours'] * 3600.0, ref - c['lookback_days'] * 86400.0
    span = (c['max_span_hours'] or 1e9) * 3600.0  # 묶음 첫 기사~마지막 기사 최대 폭(후속 보도가 끝없이 이어 붙지 않게)
    syn = c.get('synonyms') or {}
    corpus = [a for a in rows if times[a['id']] >= ref - c['idf_days'] * 86400.0] or rows
    toks = {a['id']: tokens(a['title'], a['source'], syn) for a in rows if times[a['id']] >= min(look, ref - c['idf_days'] * 86400.0)}
    vec = Vectorizer([toks.get(a['id']) or tokens(a['title'], a['source'], syn) for a in corpus])

    # 1) 이미 2건 이상인 묶음은 고정
    by_cid: dict[str, list[dict]] = defaultdict(list)
    for a in rows:
        if a.get('cluster_id'):
            by_cid[a['cluster_id']].append(a)
    groups: dict[str, _Group] = {}
    for cid, ms in by_cid.items():
        if len(ms) < 2:
            continue
        g = groups[cid] = _Group(cid)
        for a in sorted(ms, key=lambda x: (times[x['id']], x['id'])):
            if times[a['id']] >= look:
                g.add(a, vec(toks[a['id']]), times[a['id']], _ents(a))
            else:  # 판정 범위 밖 구성원: 통계에만 포함
                g.members.append(a); g.sources.add(a['source'])
    inv: dict[str, set[str]] = defaultdict(set)
    for g in groups.values():
        for k in g.vec:
            inv[k].add(g.cid)

    # 2) 묶이지 않은 최근 기사를 발행 순으로 판정
    todo = sorted((a for a in rows if times[a['id']] >= look and not (a.get('cluster_id') in groups)), key=lambda x: (times[x['id']], x['id']))
    for a in todo:
        t, v, e = times[a['id']], vec(toks[a['id']]), _ents(a)
        best, bs = None, -1.0
        cands = set().union(*(inv.get(k, ()) for k in v)) if v else set()
        for cid in sorted(cands):  # 정렬: 유사도가 같으면 id 가 작은 묶음(결정적)
            g = groups[cid]
            if t > g.last + win or t < g.first - win or t > g.first + span or t < g.last - span:
                continue
            if c['company_veto'] and e and g.ents and not (e & g.ents):
                continue
            s = g.sim(v)
            if s < c['threshold'] or (a['source'] in g.sources and s < c['same_source_threshold']):
                continue
            if s > bs:
                best, bs = g, s
        if best is None:
            best = groups[a['id']] = _Group(a['id'])
        best.add(a, v, t, e)
        for k in v:
            inv[k].add(best.cid)

    # 2-1) 이번에 새로 생긴 묶음은 기존·다른 새 묶음과 중심 벡터 코사인이 merge_threshold 이상이면 합친다(나란히 생긴 같은 사건).
    #      고정된 묶음끼리는 합치지 않아 cluster_id 가 바뀌지 않는다. 합친 결과의 id 는 고정 묶음, 둘 다 새것이면 먼저 시작한 쪽.
    frozen = set(groups) - {a['id'] for a in todo}
    merged = 0
    if c.get('merge_threshold'):
        queue = sorted((x for x in groups.values() if x.cid not in frozen), key=lambda x: (x.first, x.cid))
        while queue:  # 합쳐서 커진 새 묶음은 다시 대기열에 넣어 한 번 더 비교한다
            g = queue.pop(0)
            if groups.get(g.cid) is not g:
                continue
            cands = set().union(*(inv.get(k, ()) for k in g.vec)) - {g.cid} if g.vec else set()
            best, bs = None, -1.0
            for cid in sorted(cands):
                h = groups.get(cid)
                if h is None or max(g.last, h.last) - min(g.first, h.first) > span or g.first > h.last + win or h.first > g.last + win:
                    continue
                if c['company_veto'] and g.ents and h.ents and not (g.ents & h.ents):
                    continue
                sm = g.gsim(h)
                if sm < c['merge_threshold'] or ((g.sources & h.sources) and sm < c['same_source_threshold']):
                    continue
                if sm > bs:
                    best, bs = h, sm
            if best is None:
                continue
            keep, drop = (best, g) if best.cid in frozen or (best.first, best.cid) < (g.first, g.cid) else (g, best)
            keep.absorb(drop)
            for k in drop.vec:
                inv[k].discard(drop.cid); inv[k].add(keep.cid)
            del groups[drop.cid]
            merged += 1
            if keep.cid not in frozen:
                queue.insert(0, keep)

    # 3) 필드 쓰기(2건 이상만). 혼자 남은 기사는 묶음 필드를 지운다
    clustered = 0
    for g in groups.values():
        ms = g.members
        if len(ms) < 2:
            for a in ms:
                for f in FIELDS:
                    a.pop(f, None)
            continue
        n_src = len({a['source'] for a in ms})
        for a in ms:
            a['cluster_id'], a['cluster_size'], a['cluster_sources'] = g.cid, len(ms), n_src
        clustered += len(ms)
    # 묶음 id 가 있었지만 위에서 다루지 않은 기사(판정 범위 밖 혼자 남은 것 등)
    seen = {id(a) for g in groups.values() for a in g.members}
    for a in rows:
        if id(a) not in seen and a.get('cluster_id') and a['cluster_id'] not in groups:
            if len(by_cid[a['cluster_id']]) < 2:
                for f in FIELDS:
                    a.pop(f, None)
    return {'articles': len(rows), 'groups': sum(1 for g in groups.values() if len(g.members) > 1), 'clustered': clustered,
            'new_assigned': len(todo), 'merged': merged}


def _is_google(a: dict) -> bool:
    return urlsplit(a.get('url', '')).netloc.endswith('news.google.com')


def lead_key(a: dict):
    """대표 기사 우선순위: 공식 발표(press) > 관련 있음 > 높은 ★(score_v2, 없으면 score) > 직접 링크 > 먼저 발행 > id."""
    return (a.get('source_type') == 'press', a.get('relevant', True), a.get('score_v2', a.get('score', 0)), not _is_google(a), -ts(a), a['id'])


def mark_leads(rows: list[dict]) -> int:
    """묶음마다 대표 1건에 cluster_lead=true, 나머지는 필드 제거. 반환: 대표 수."""
    by: dict[str, list[dict]] = defaultdict(list)
    for a in rows:
        a.pop('cluster_lead', None)
        if a.get('cluster_id'):
            by[a['cluster_id']].append(a)
    for ms in by.values():
        max(ms, key=lead_key)['cluster_lead'] = True
    return len(by)


def strip(rows: list[dict]) -> int:
    n = 0
    for a in rows:
        popped = [a.pop(f, None) for f in FIELDS]  # 모든 필드를 지운다(any 의 단락 평가를 피하려고 목록으로)
        n += any(x is not None for x in popped)
    return n
