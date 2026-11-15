"""엔진 테스트: 숨김 규칙(hide_rules), 공식 발표 포함 조건(press_include), 제목 패턴 하향의 한 단계 낮춤(downgrade_patterns.step·hide).
설정은 테스트 안의 작은 사전으로 만든다(채널 설정 파일과 무관). 키가 없으면 예전 동작 그대로인지도 확인한다."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from classify import Classifier, UNCATEGORIZED
from score_v2 import ScoreV2

CATS = {'시장': {'normal': ['증시', '채권']}, '손해보험': {'company': ['삼성화재'], 'normal': ['손보']}}
SCORE = {'base': 2, 'max': 5, 'market_cap': {'categories': ['시장'], 'max_score': 2, 'insurance_terms': ['보험', '손보'],
                                              'insurance_company_categories': ['손해보험']}}
def mk(**extra):
    return Classifier({'priority': ['손해보험', '시장'], 'categories': CATS, **extra}, SCORE)

# 1) 키가 없으면 아무것도 숨기지 않고 공식 발표 포함 조건도 없다
base = mk()
assert base.hide_rule('삼성화재, 김장 봉사', '손해보험') is None
assert not base.press_include('금융회사 지배구조 개선')

# 2) 숨김 규칙: 낱말·정규식·카테고리+보험어 예외·보호어
hide = mk(hide_rules={
    'protect_terms': ['과징금', '적자'],
    'rules': [
        {'name': '사회공헌', 'terms': ['봉사', '캠페인 동참']},
        {'name': '주가 단신', 'patterns': ['주가 (\\d[\\d,]*원 )?(상승|하락)( 후 장마감| 중)$']},
        {'name': '시장 일반', 'categories': ['시장'], 'unless_insurance_terms': True},
    ]})
assert hide.hide_rule('삼성화재, 김장 봉사 활동', '손해보험') == '사회공헌'
assert hide.hide_rule('삼성화재 캠페인 동참', '손해보험') == '사회공헌'
assert hide.hide_rule('삼성화재 캠페인동참', '손해보험') is None                 # terms 는 띄어쓰기를 지킨다
hide2 = mk(hide_rules={'rules': [{'name': '사회공헌', 'terms': ['성금', '기부', '일손', '김장']}]})
for t in ['삼성화재, 英 특수보험사 품었다…삼성 금융 첫 해외 M&A', '보험사 3분기 부진', '[11일 손해보험 마감시황]', '김 장관, 보험업계 간담회']:
    assert hide2.hide_rule(t, '손해보험') is None, t                              # 띄어쓰기를 지우면 우연히 맞는 사례
assert hide2.hide_rule('농협생명, 농촌일손돕기', '손해보험') == '사회공헌'           # 낱말 안 일치는 그대로
assert hide.hide_rule('삼성화재 캠페인 출범', '손해보험') is None                # '동참' 없는 캠페인은 숨기지 않음
assert hide.hide_rule('삼성화재 주가 7,000원 하락 후 장마감', '손해보험') == '주가 단신'
assert hide.hide_rule('삼성화재 주가 상승 중', '손해보험') == '주가 단신'
assert hide.hide_rule('삼성화재 3분기 순익 감소에 주가 하락', '손해보험') is None  # 단신 정형 문구가 아님
assert hide.hide_rule('증시 급락에 채권 강세', '시장') == '시장 일반'
assert hide.hide_rule('증시 급락에 보험주 약세', '시장') is None                  # 보험어 있음
assert hide.hide_rule('증시 급락에 삼성화재 약세', '시장') is None                # 보험사 이름(insurance_company_categories)
assert hide.hide_rule('증시 급락', '손해보험') is None                            # 다른 카테고리
assert hide.hide_rule('봉사단체 후원금 횡령에 과징금', '손해보험') is None         # 보호어
co = mk(hide_rules={'rules': [{'name': '시장 일반', 'categories': ['시장'], 'unless_insurance_terms': True, 'unless_company': True}]})
assert co.hide_rule('코리안리 3분기 영업이익 급감…환율 영향', '시장') == '시장 일반'                 # 회사 정보를 안 주면 숨김
assert co.hide_rule('코리안리 3분기 영업이익 급감…환율 영향', '시장', company=True) is None      # 재보험사 등 회사 이름(companies.json)
assert hide.hide_rule('삼성화재 김장 봉사', '손해보험', company=True) == '사회공헌'                 # unless_company 없는 규칙은 그대로
try:
    mk(hide_rules={'rules': [{'name': '빈 규칙'}]}); raise AssertionError('빈 규칙을 받아들임')
except ValueError:
    pass

# 3) 공식 발표 포함 조건
inc = mk(press_include={'keywords': ['지배구조', '소비자보호'], 'unless': ['기업지배구조']})
assert inc.press_include('금융회사 지배구조의 공정성과 투명성을 제고합니다')
assert inc.press_include('금융시장 안정 및 소비자 보호를 위한 제도 도입')     # 띄어쓰기 무시
assert not inc.press_include('기업지배구조보고서 공시 확대')
assert not inc.press_include('잠자는 포인트를 지역화폐로')

# 4) 제목 패턴 하향: 상한(기본) vs 한 단계 낮춤(step)
DP = {'patterns': ['^case study'], 'feeds': ['F'], 'max_score': 2}
cap = mk(downgrade_patterns=DP)
step = mk(downgrade_patterns={**DP, 'step': 1, 'hide': False})
assert cap.down_hide and not step.down_hide
assert cap.final_score('Case study - X', 'F', 5, None) == 2                    # 상한
assert step.final_score('Case study - X', 'F', 5, None) == 4                   # 한 단계
assert step.final_score('Case study - X', 'F', 2, None) == 2                   # 최저(base) 아래로 내려가지 않음
assert step.final_score('Case study - X', 'G', 5, None) == 5                   # 대상 피드 아님
assert step.final_score('New model', 'F', 4, None) == 4
c = step.classify('Case study - 삼성화재 손보', 'F')
assert c['category'] == UNCATEGORIZED and c['score'] == cap.classify('삼성화재 손보')['score']  # step 이면 classify 단계에선 낮추지 않음(final_score 에서 한 번)

# 5) score_v2: step 이면 상한 대신 한 단계 낮춤, 최저 relevant_min
V2 = {'enabled': True, 'star_thresholds': [1.0, 2.0, 3.0, 4.0], 'use_v1_caps': True, 'relevant_min_stars': 2}
row = lambda t, **k: {'id': t, 'title': t, 'category': '손해보험', 'feed_name': 'F', 'relevant': True, **k}
vs, vc = ScoreV2(step, V2), ScoreV2(cap, V2)
hi = row('Case study - 삼성화재 손보 순익')      # 제목 점수가 높은 고객 사례
plain = row('삼성화재 손보 순익')
s_plain = vs.article_stars(plain)[0]
assert vs.article_stars(hi)[0] == max(2, s_plain - 1), (vs.article_stars(hi), s_plain)
assert vc.article_stars(hi)[0] == min(2, s_plain)
rows = [row('Case study - 삼성화재 손보', cluster_id='c1', cluster_sources=2), row('삼성화재 손보 출시', cluster_id='c1', cluster_sources=2)]
vs.apply(rows)
assert rows[0]['score_v2'] == max(2, rows[1]['score_v2'] - 1), rows                 # 사건 점수에서도 한 단계 낮춤
print('hide_rules tests passed')
