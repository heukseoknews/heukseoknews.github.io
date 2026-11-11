"""python collector/test_score.py — 중요도(★) 산식 단위 테스트"""
import copy, json
from pathlib import Path
from classify import Classifier, DEFAULT_CONFIG, DEFAULT_SCORE, classify, load

CFG = json.loads(Path(DEFAULT_CONFIG).read_text(encoding='utf-8'))
SC = json.loads(Path(DEFAULT_SCORE).read_text(encoding='utf-8'))
cl = load()


def score(title, category=None):
    cat = category or classify(title)['category']
    return cl.score(title, cat)


# 1) 이중 집계 제거: '실손보험' 안의 '손보'는 세지 않는다(실손 3점만)
s, d = score('실손보험 비급여 관리 강화…진료 전 설명·동의 의무화 추진')
assert d['top'] == 3, d                       # 이전: 손보(3)+실손(3)=6
assert s == 4 and d['core_count'] == 1        # 2 + 1(top>=3) + 1(핵심어 실손보험 1개)
assert classify('실손보험 비급여 관리 강화')['score'] == 4
# 진짜 '손보'(손보사)와 '실손'이 함께 있으면 둘 다 센다
s, d = score('실손보험 다섯번 개편해도 손보사 1.9조 적자늪 여전')
assert d['top'] == 6, d
# 긴 키워드에 포함되는 짧은 키워드는 이중 계산하지 않음('금리' ⊂ '기준금리')
assert score('기준금리 동결', '금융시장·자산운용')[1]['top'] == 3     # 기준금리·금리동결이 '금리'를 공유하는 겹침 → 왼쪽 하나만(이전 6)
assert score('美연준, 금리 동결', '금융시장·자산운용')[1]['top'] == 6    # 겹치지 않으면 연준 3 + 금리동결 3

# 2) 구간 겹침 일반화(설정 기반): A=실손, B=손보 가 겹치면 왼쪽 우선 하나만, 겹치지 않으면 둘 다
cfg = copy.deepcopy(CFG); cfg['categories'] = {'X': {'strong': ['실손', '손보'], 'normal': [], 'company': []}}; cfg['priority'] = ['X']
c2 = Classifier(cfg, SC)
assert c2.star_top('실손보험', '실손보험', 'X') == 3
assert c2.star_top('실손 손보', '실손손보', 'X') == 6   # 사이에 단어가 있어도 띄어쓰기 제거 후 '실손손보' → 겹치지 않음

# 3) 핵심어 가산: 0개 +0 / 1개 +1 / 2개 이상 +2, 상한 5, 별칭은 1개로
assert score('보험사 주가 하락', '손해보험')[1]['core_count'] == 0
s1, d1 = score('보험사 계리가정 감독 강화… 금감원 정기 보고 의무화')
assert d1['core_count'] == 1 and s1 == 4        # top 4(계리가정3+금감원1): 2+1, 핵심어 1개 +1
s2, d2 = score('K-ICS 비율 하락…지급여력 제도 개편')
assert d2['core_count'] == 2 and s2 == 5        # top 6: 2+1+1, 핵심어 2개 +2 → 6 → 상한 5
assert score('IFRS17 도입 효과', '제도·회계·건전성')[1]['core_count'] == 1   # 'IFRS17'과 'IFRS 17' 별칭은 1개
assert score('CSM(계약서비스마진) 전망', '제도·회계·건전성')[1]['core_count'] == 1  # 약어/풀네임도 1개
assert score('IFRS17·K-ICS·계리가정 총정리', '제도·회계·건전성')[0] == 5

# 3b) 핵심어가 다른 단어 안에서 우연히 일치하면 세지 않는다('재보험' ⊂ '화재보험')
assert score('화재보험 가입 급증', '손해보험')[1]['core_count'] == 0
assert score('화재보험 가입 급증, 재보험 요율 상승', '손해보험')[1]['core_count'] == 1   # 진짜 '재보험'은 센다

# 4) 시장 속보 상한: 금융시장 카테고리 + 보험 관련 단어 없음 → ★2 이하
s, d = score('[속보]원/달러 환율, 0.5원 오른 1341.5원 - 머니투데이')
assert s == 2 and d['market_capped']
s, d = score('美연준, 금리 동결…워시 "12월 인상 예단 안 해"(종합)')
assert s == 2 and d['market_capped']            # 이전 ★4
# 보험 단어/회사명이 있으면 상한 없음
s, d = score('보험사 환율 변동 대비 헤지 확대', '금융시장·자산운용')
assert not d['market_capped'] and s >= 3
s, d = score('한화생명, 환율 급등에 외화채권 헤지 확대', '금융시장·자산운용')
assert not d['market_capped']                   # 회사명(한화생명)도 보험 관련 단어
assert not score('생명보험사 자산운용 전략', '생명보험')[1]['market_capped']   # 금융시장 카테고리가 아니면 대상 아님

# 5) 금리·대출 상한은 그대로
s, d = score('금리 5% 넘고 연체는 3배로…빌리기도 갚기도 버거운 보금자리론', '금융시장·자산운용')
assert s <= 2 and (d['low_capped'] or d['market_capped'])

# 6) 사회보험 제외로 미분류가 된 기사는 excluded_score
assert classify('고용보험 가입 예술인 22%')['score'] == SC['excluded_score']

# 7) 산식은 config 에서 온다(하드코딩 아님): base, 핵심어 가산, 시장 상한을 바꾸면 결과가 바뀐다
def with_cfg(mut):
    sc = copy.deepcopy(SC); mut(sc); return Classifier(CFG, sc)
t = '실손보험 비급여 관리 강화'
assert with_cfg(lambda sc: sc.update(base=1)).score(t, '손해보험')[0] == 3
assert with_cfg(lambda sc: sc['core_terms'].update(add_by_count={'1': 0, '2': 0})).score(t, '손해보험')[0] == 3
assert with_cfg(lambda sc: sc['market_cap'].update(max_score=1)).score('[속보]원/달러 환율', '금융시장·자산운용')[0] == 1
assert with_cfg(lambda sc: sc['market_cap'].update(categories=[])).score('[속보]원/달러 환율', '금융시장·자산운용')[0] == 3
print('score tests passed')
