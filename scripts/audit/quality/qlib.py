"""기사 품질 실험 공통 모듈(조사 전용: data/ 를 읽기만 한다).

같은 사건 묶기 후보 방법을 오프라인으로 구현한다. 표준 라이브러리만 쓴다.
- 제목 정규화: NFKC·소문자, 머리말 태그([포토]·[단독]·(종합) 등)와 끝의 '- 매체명' 제거
- 토큰: 한글 연속 구간은 글자 2-gram, 영문은 소문자 단어(간단한 어간), 숫자+단위(961억, 34%)는 한 토큰
- 방법: J2(글자 2-gram Jaccard), J3(3-gram), TFIDF(토큰 TF-IDF 코사인), MINHASH(J2 근사),
        ENT(개체 공유 + 희소 토큰 공유 그래프), HYB(TF-IDF + 개체·희소어 보강)
"""
from __future__ import annotations
import glob
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HOURS = 3600.0

# ---------- 데이터 ----------

def load(channel: str) -> list[dict]:
    rows = [a for f in sorted(glob.glob(str(ROOT / 'data' / channel / '????-??.json'))) for a in json.loads(Path(f).read_text(encoding='utf-8'))]
    for a in rows:
        a['_t'] = datetime.fromisoformat(a['published_at']).timestamp()
    rows.sort(key=lambda a: (a['_t'], a['id']))
    return rows


# ---------- 정규화·토큰 ----------

TAG = re.compile(r'^\s*(?:\[[^\]]{1,20}\]|【[^】]{1,20}】|<[^>]{1,20}>|\([^)]{1,8}\))\s*')
TAIL_TAG = re.compile(r'\s*(?:\((?:종합|상보|속보|1보|2보|3보|단독|영상|포토|사진)[^)]{0,6}\)|\[[^\]]{1,12}\])\s*$')
SOURCE_TAIL = re.compile(r'\s+[-–|]\s+[^-–|]{1,25}$')
QUOTES = str.maketrans({c: ' ' for c in '\'"‘’“”`´«»「」『』〈〉《》·…⋯~!?,.:;/\\|()[]{}<>=+*&^#@$_—–-'})
HANGUL = re.compile(r'[가-힣]+')
LATIN = re.compile(r'[a-z][a-z0-9]*(?:[.\-][a-z0-9]+)*')
NUMUNIT = re.compile(r'\d+(?:[.,]\d+)*(?:%|조|억|만|천|원|명|건|개|배|위|bp|년|월|일|분기|세|곳|호|기|차|m|b|k)?')
EN_STOP = set('a an the of to in on for and or with by at from as is are be its it this that new how why what who into over after vs via about your our we you their his her up out more most than just now will can may could should not no yes s'.split())


def normalize(title: str, source: str | None = None) -> str:
    t = unicodedata.normalize('NFKC', title).casefold()
    prev = None
    while prev != t:
        prev, t = t, TAG.sub('', t)
    t = TAIL_TAG.sub('', t)
    m = SOURCE_TAIL.search(t)
    if m and source and source.casefold() in m.group(0):  # 제목 끝의 ' - 머니투데이'
        t = t[: m.start()]
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


def tokens(title: str, source: str | None = None, ngram: int = 2) -> list[str]:
    """한글 n-gram + 영문 단어(어간) + 숫자 토큰. 한글 구간이 n보다 짧으면 그대로 1토큰."""
    t = normalize(title, source)
    out: list[str] = []
    for m in NUMUNIT.finditer(t):
        out.append('#' + m.group(0))
    t2 = NUMUNIT.sub(' ', t)
    for m in LATIN.finditer(t2):
        w = m.group(0)
        if w not in EN_STOP and len(w) > 1:
            out.append(stem(w))
    for m in HANGUL.finditer(t2):
        s = m.group(0)
        if len(s) < ngram:
            out.append(s)
        else:
            out.extend(s[i:i + ngram] for i in range(len(s) - ngram + 1))
    return out


def char_grams(title: str, source: str | None = None, n: int = 2) -> set[str]:
    s = re.sub(r'\s+', '', normalize(title, source).translate(QUOTES))
    return {s[i:i + n] for i in range(len(s) - n + 1)} if len(s) >= n else {s}


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


# ---------- TF-IDF ----------

class Tfidf:
    def __init__(self, docs: list[list[str]]):
        df = Counter(t for d in docs for t in set(d))
        self.n = len(docs)
        self.idf = {t: math.log((1 + self.n) / (1 + c)) + 1.0 for t, c in df.items()}
        self.vecs = [self.vec(d) for d in docs]

    def vec(self, d: list[str]) -> dict[str, float]:
        tf = Counter(d)
        v = {t: (1 + math.log(c)) * self.idf.get(t, math.log(1 + self.n) + 1.0) for t, c in tf.items()}
        nrm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {t: x / nrm for t, x in v.items()}

    @staticmethod
    def cos(a: dict, b: dict) -> float:
        if len(a) > len(b):
            a, b = b, a
        return sum(x * b.get(t, 0.0) for t, x in a.items())


# ---------- MinHash ----------

def minhash(grams: set[str], k: int = 64) -> list[int]:
    hs = [int.from_bytes(hashlib.blake2b(g.encode(), digest_size=8).digest(), 'big') for g in grams]
    out = []
    for i in range(k):
        a, b = 0x9E3779B97F4A7C15 * (i + 1) | 1, 0xBF58476D1CE4E5B9 * (i + 7)
        out.append(min(((h * a + b) & 0xFFFFFFFFFFFFFFFF) for h in hs) if hs else 0)
    return out


def mh_sim(a: list[int], b: list[int]) -> float:
    return sum(x == y for x, y in zip(a, b)) / len(a)


# ---------- 특징 계산 ----------

class Features:
    """채널 기사 전체에 대한 토큰·벡터·개체를 미리 계산한다."""

    def __init__(self, arts: list[dict], window_h: float = 72.0):
        self.arts, self.window = arts, window_h * HOURS
        self.g2 = [char_grams(a['title'], a['source'], 2) for a in arts]
        self.g3 = [char_grams(a['title'], a['source'], 3) for a in arts]
        self.toks = [tokens(a['title'], a['source']) for a in arts]
        self.tf = Tfidf(self.toks)
        self.ents = [set(a.get('companies') or []) for a in arts]
        # 희소어: 전체 기사의 5% 이하에만 나오는 토큰(흔한 '보험'·'ai' 등 제외). 숫자 토큰은 사건 단서로 강함
        df = Counter(t for d in self.toks for t in set(d))
        cut = max(3, int(len(arts) * 0.05))
        self.rare = [{t for t in set(d) if df[t] <= cut} for d in self.toks]
        self._mh = None

    def mh(self, i):
        if self._mh is None:
            self._mh = [minhash(g) for g in self.g2]
        return self._mh[i]

    def within(self, i, j) -> bool:
        return abs(self.arts[i]['_t'] - self.arts[j]['_t']) <= self.window

    def pairs_in_window(self):
        """발행 시각 정렬 후 윈도우 안의 모든 쌍(i<j)."""
        A, n = self.arts, len(self.arts)
        for i in range(n):
            j = i + 1
            while j < n and A[j]['_t'] - A[i]['_t'] <= self.window:
                yield i, j
                j += 1

    def conflict(self, i, j) -> bool:
        """회사·기관 태그가 양쪽 다 있는데 하나도 겹치지 않으면 다른 사건(같은 형식의 다른 회사 실적 등)."""
        return bool(self.ents[i]) and bool(self.ents[j]) and not (self.ents[i] & self.ents[j])

    def sims(self, i, j) -> dict[str, float]:
        shared_rare = self.rare[i] & self.rare[j]
        return {
            'j2': jaccard(self.g2[i], self.g2[j]),
            'j3': jaccard(self.g3[i], self.g3[j]),
            'cos': Tfidf.cos(self.tf.vecs[i], self.tf.vecs[j]),
            'ent': len(self.ents[i] & self.ents[j]),
            'veto': self.conflict(i, j),
            'rare': len(shared_rare),
            'rare_w': sum(self.tf.idf[t] for t in shared_rare),
        }


# ---------- 묶기(연결 요소) ----------

class DSU:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[max(a, b)] = min(a, b)


def components(n: int, edges) -> list[int]:
    d = DSU(n)
    for i, j in edges:
        d.union(i, j)
    return [d.find(i) for i in range(n)]


def groups(labels: list[int]) -> dict[int, list[int]]:
    g = defaultdict(list)
    for i, c in enumerate(labels):
        g[c].append(i)
    return g


def centroid_clusters(F: 'Features', t: float, veto: bool = True, window_h: float | None = None, same_source_t: float | None = None) -> list[int]:
    """발행 시각 순으로 한 건씩 넣는 중심 벡터 묶기. 묶음 중심(구성원 벡터 합)과의 코사인이 t 이상인 가장 가까운 묶음에 넣는다.
    veto: 기사와 묶음의 회사·기관 태그가 둘 다 있는데 겹치지 않으면 제외. 묶음은 마지막 기사 발행 후 window_h 동안만 후보.
    단일 연결(연결 요소)과 달리 A-B-C 식 연쇄로 주제가 흘러가는 것을 막는다."""
    win = (window_h * HOURS) if window_h else F.window
    A = F.arts
    label = [-1] * len(A)
    cents: list[dict] = []    # 묶음별 벡터 합
    norms: list[float] = []
    last: list[float] = []
    ents: list[Counter] = []
    inv: dict[str, set] = defaultdict(set)  # 토큰 -> 묶음
    srcs: list[set] = []
    for i, a in enumerate(A):
        v = F.tf.vecs[i]
        cand = set()
        for tok in v:
            cand |= inv.get(tok, set())
        best, bs = -1, t
        for c in cand:
            if a['_t'] - last[c] > win:
                continue
            if veto and F.ents[i] and ents[c] and not (F.ents[i] & set(ents[c])):
                continue
            cv = cents[c]
            sim = sum(x * cv.get(k, 0.0) for k, x in v.items()) / (norms[c] or 1.0)
            if same_source_t is not None and a['source'] in srcs[c] and sim < same_source_t:
                continue  # 같은 매체의 정형 제목(Case Study - X)은 더 높은 기준
            if sim >= bs:
                best, bs = c, sim
        if best < 0:
            best = len(cents)
            cents.append({}); norms.append(0.0); last.append(0.0); ents.append(Counter()); srcs.append(set())
        cv = cents[best]
        for k, x in v.items():
            cv[k] = cv.get(k, 0.0) + x
            inv[k].add(best)
        norms[best] = math.sqrt(sum(x * x for x in cv.values()))
        last[best] = max(last[best], a['_t'])
        ents[best].update(F.ents[i])
        srcs[best].add(a['source'])
        label[i] = best
    return label
