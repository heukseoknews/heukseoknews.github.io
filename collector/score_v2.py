"""중요도 v2(★1~5): 제목 기반 점수 + 같은 사건 보도 규모. 설정은 channels/<채널>/score.json 의 "v2" 항목(기본 꺼짐).

점수(raw) = base
          + 주제 키워드: 대표 카테고리에서 일치한 키워드 중 가장 높은 등급의 점수(strong/company/normal) + 강한 키워드가 2개 이상이면 추가
          + 핵심어(score.json core_terms 그룹 수)
          + 카테고리 가중(category_points)
          + 사건 유형(event_terms: 제도·실적·M&A·출시 등, 그룹마다 한 번)
          + 주요 기업·기관(entity_points: companies·orgs 태그가 목록에 있으면)
          + 출처 유형(source_type_points: 공식 발표 등)
          + 낮은 가치(low_value: 홍보·행사·주가·생활 정보 등, 감점 + ★ 상한)
★ = star_thresholds 로 raw 를 1~5로 바꾼 뒤, 보도 매체 수 가산(coverage_points)과 상한(시장 속보·금리·제목 패턴·낮은 가치)을 적용.
관련도 낮은 기사(relevant=false)는 irrelevant_points 감점, ★ irrelevant_max_stars 상한, 보도 규모 가산 없음. 관련 기사는 최저 relevant_min_stars(기본 2).
같은 사건 묶음이 있으면 묶음 안의 관련 기사는 모두 같은 사건 점수(관련 구성원 ★의 event_quantile 분위수, 기본 0.75)를 받는다(event_level, 기본 true).

기존 score(★)·분류 결과는 바꾸지 않는다. 결과는 선택 필드 score_v2 로만 저장한다(docs/data-contract.md).
"""
from __future__ import annotations
import math
import re
from bisect import bisect_right

from classify import UNCATEGORIZED, Classifier, Matcher, _squash

TIER_OF = {3: 'strong', 2: 'company', 1: 'normal'}


class ScoreV2:
    def __init__(self, cl: Classifier, v2: dict):
        self.cl, self.cfg = cl, v2
        m = lambda ks: [Matcher(k, cl.mode) for k in ks]
        self.enabled = bool(v2.get('enabled', False))
        self.base = float(v2.get('base', 1.0))
        self.tier_points = {'strong': 1.5, 'company': 0.5, 'normal': 0.5, **v2.get('tier_points', {})}
        self.extra_strong = float(v2.get('extra_strong', 0.5))
        self.core_points = {int(k): float(v) for k, v in v2.get('core_points', {}).items()}
        self.category_points = {k: float(v) for k, v in v2.get('category_points', {}).items()}
        self.events = [(g.get('name', ''), m(g['terms']), float(g.get('points', 1.0))) for g in v2.get('event_terms', [])]
        self.event_max = float(v2.get('event_max', 2.0))
        ep = v2.get('entity_points', {})
        self.entity_names, self.entity_add = set(ep.get('names', [])), float(ep.get('points', 0.0))
        self.source_points = {k: float(v) for k, v in v2.get('source_type_points', {}).items()}
        lv = v2.get('low_value', {})
        self.low_terms = m(lv.get('terms', []))
        self.low_res = [re.compile(p) for p in lv.get('patterns', [])]
        self.low_points, self.low_max = float(lv.get('points', 0.0)), int(lv.get('max_stars', 2))  # 기본: 감점 없이 ★ 상한만
        self.thresholds = [float(x) for x in v2.get('star_thresholds', [1.0, 2.5, 4.0, 5.5])]  # ★2·3·4·5 가 되는 raw 하한
        self.coverage = sorted((int(c['sources_at_least']), int(c['add'])) for c in v2.get('coverage_points', []))
        self.irrelevant_points = float(v2.get('irrelevant_points', -1.0))
        self.irrelevant_max = int(v2.get('irrelevant_max_stars', 2))
        self.relevant_min = int(v2.get('relevant_min_stars', 2))  # ★1 은 관련도 낮은 기사에만
        self.event_level = bool(v2.get('event_level', True))
        self.event_quantile = float(v2.get('event_quantile', 0.75))  # 사건 점수 = 묶음 관련 기사 ★의 이 분위수(1.0 = 최고값)
        self.low_share = float(lv.get('cluster_share', 0.3))  # 묶음 기사 중 이 비율 이상이 낮은 가치면 묶음 전체를 낮은 가치로
        self.use_caps = bool(v2.get('use_v1_caps', True))

    # ---- 제목 점수 ----
    def hits(self, text: str, sq: str, category: str) -> list[int]:
        """대표 카테고리에서 남는 키워드 가중치 목록(classify.star_top 과 같은 겹침 규칙)."""
        cl = self.cl
        found = [(mt, w) for mt, w in cl.rules.get(category, []) if mt.find(text, sq) >= 0]
        kept = [(mt, w) for mt, w in found
                if not any(o is not mt and _squash(mt.keyword) != _squash(o.keyword) and _squash(mt.keyword) in _squash(o.keyword) for o, _ in found)]
        cand = sorted(((s, e, mt) for mt, _ in kept if mt.kind == 'sub' for s, e in mt.spans(sq)), key=lambda x: (x[0], -(x[1] - x[0])))
        alive, last_end = set(), 0
        for s, e, mt in cand:
            if s >= last_end:
                alive.add(id(mt)); last_end = e
        return [w for mt, w in kept if mt.kind == 'word' or id(mt) in alive]

    def low_value(self, title: str) -> bool:
        text, sq = title.casefold(), _squash(title)
        return any(x.find(text, sq) >= 0 for x in self.low_terms) or any(r.search(text) for r in self.low_res)

    def raw(self, a: dict) -> tuple[float, dict]:
        """(raw 점수, 근거). 관련도 낮은 기사도 계산은 하지만 ★ 단계에서 irrelevant_stars 가 된다."""
        title, cat = a['title'], a.get('category', UNCATEGORIZED)
        text, sq = title.casefold(), _squash(title)
        if cat == UNCATEGORIZED:  # 관련도 낮음 등으로 미분류여도 주제 키워드는 분류기 판단 카테고리로 센다
            cat = self.cl.classify(title, a.get('feed_name'))['category']
        ws = self.hits(text, sq, cat) if cat != UNCATEGORIZED else []
        top_w = max(ws, default=0)
        tier = 'strong' if top_w >= 3 else TIER_OF.get(top_w)
        topic = self.tier_points.get(tier, 0.0) if tier else 0.0
        if sum(1 for w in ws if w >= 3) >= 2:
            topic += self.extra_strong
        core = self.cl.core_count(text, sq)
        core_p = self.core_points.get(min(core, max(self.core_points)), 0.0) if core and self.core_points else 0.0
        ev = [(n, p) for n, ms, p in self.events if any(x.find(text, sq) >= 0 for x in ms)]
        ev_p = min(self.event_max, sum(p for _, p in ev))
        low = self.low_value(title)
        ent = bool(self.entity_names & set((a.get('companies') or []) + (a.get('orgs') or [])))
        r = (self.entity_add if ent else 0.0) + (self.base + topic + core_p + self.category_points.get(cat, 0.0) + ev_p
             + self.source_points.get(a.get('source_type') or '', 0.0) + (self.low_points if low else 0.0)
             + (0.0 if a.get('relevant', True) else self.irrelevant_points))
        return r, {'topic': topic, 'core': core, 'events': [n for n, _ in ev], 'low': low}

    def caps(self, a: dict, low: bool) -> int:
        """★ 상한: 낮은 가치, 보험 채널의 시장 속보·금리 상한, AI 채널의 제목 패턴 상한(v1 설정 재사용)."""
        cap = 5
        if low:
            cap = min(cap, self.low_max)
        if self.use_caps:
            cl, title, cat = self.cl, a['title'], a.get('category', UNCATEGORIZED)
            text, sq = title.casefold(), _squash(title)
            if cat in cl.market_cats and not cl._any(cl.insurance_terms, text, sq):
                cap = min(cap, cl.market_max)
            if cl._any(cl.low, text, sq):
                cap = min(cap, cl.low_max)
            if cl.downgraded(title, a.get('feed_name')):
                cap = min(cap, cl.down_max)
        return cap

    def stars_of(self, raw: float) -> int:
        return 1 + bisect_right(self.thresholds, raw)

    def coverage_add(self, sources: int) -> int:
        return max((add for at_least, add in self.coverage if sources >= at_least), default=0)

    def article_stars(self, a: dict, sources: int = 1, low: bool | None = None) -> tuple[int, float, dict]:
        r, why = self.raw(a)
        if low is not None and low != why['low']:  # 묶음 단위 낮은 가치 판정으로 덮어씀
            r += (self.low_points if low else -self.low_points)
            why = {**why, 'low': low}
        rel = a.get('relevant', True)
        s = self.stars_of(r) + (0 if why['low'] or not rel else self.coverage_add(sources))
        cap = self.caps(a, why['low']) if rel else self.irrelevant_max  # 관련도 낮은 기사: 감점 + ★ 상한
        return max(self.relevant_min if rel else 1, min(5, s, cap)), r, why

    # ---- 기사 목록 전체 ----
    def apply(self, rows: list[dict]) -> dict:
        """rows 에 score_v2 를 쓴다(제자리). 묶음 필드(cluster_id·cluster_sources)가 있으면 사건 점수로 맞춘다. 반환: 분포."""
        members: dict[str, list[dict]] = {}
        for a in rows:
            if a.get('cluster_id'):
                members.setdefault(a['cluster_id'], []).append(a)
        low_c = {cid: sum(self.low_value(x['title']) for x in ms) >= self.low_share * len(ms) for cid, ms in members.items()}
        per = {}
        for a in rows:
            cid = a.get('cluster_id')
            per[a['id']] = self.article_stars(a, a.get('cluster_sources', 1), low_c.get(cid) if cid else None)
        if self.event_level:
            vals: dict[str, list[int]] = {}
            for a in rows:
                cid = a.get('cluster_id')
                if cid and a.get('relevant', True):
                    vals.setdefault(cid, []).append(per[a['id']][0])
            # 분위수: 오름차순 정렬 후 ceil(q·n)번째. 2~3건 묶음은 사실상 최고값, 큰 묶음은 키워드가 많은 제목 하나에 끌려가지 않는다
            best = {cid: sorted(v)[max(0, math.ceil(self.event_quantile * len(v)) - 1)] for cid, v in vals.items()}
        dist: dict[int, int] = {}
        for a in rows:
            s = per[a['id']][0]
            if self.event_level and a.get('cluster_id') and a.get('relevant', True):
                s = best[a['cluster_id']]
            a['score_v2'] = s
            dist[s] = dist.get(s, 0) + 1
        return dict(sorted(dist.items()))


def strip(rows: list[dict]) -> int:
    n = 0
    for a in rows:
        if a.pop('score_v2', None) is not None:
            n += 1
    return n
