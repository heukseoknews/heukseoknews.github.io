"""python collector/test_score_v2.py — 중요도 v2 산식 단위 테스트(보험·AI 실제 제목, 경계 사례, 설정 기반 일반 채널)."""
import copy
import json

import channel
import classify
import entities
import score_v2
from collect import judge


def scorer(ch):
    cd = channel.use(ch)
    return score_v2.ScoreV2(classify.load(), json.loads((cd / 'score.json').read_text(encoding='utf-8'))['v2'])


def art(title, kind='media', feed=None, i='x'):
    rel, c = judge(title, kind, feed)
    ent = entities.tag_entities(title, None, c['tags'])
    return {'id': i, 'title': title, 'source': 's', 'source_type': kind, 'feed_name': feed, 'category': c['category'],
            'relevant': rel, 'score': c['score'], 'companies': ent['companies'], 'orgs': ent['orgs']}


# ---- 보험 채널 ----
sv = scorer('insurance')
assert not sv.enabled, '기본값은 꺼짐'
st = lambda title, kind='media', n=1: sv.article_stars(art(title, kind), n)[0]
# 제도·계리 핵심: ★5
assert st('계리가정보고서 도입 등 ｢보험업감독규정｣ 개정안 금융위원회 의결', 'press') == 5
assert st("금감원 '계리가정 옐로카드'에 보험사 비상⋯ 연말 CSM 촉각") == 5
# 홍보·행사: 보도 매체가 많아도 ★2 상한
assert st('현대해상, 성남시의료원에 ‘마음도서관’ 개관') == 2
assert st('현대해상, 성남시의료원에 ‘마음도서관’ 개관', n=40) == 2
# 시장 속보(보험 단어 없음): v1 상한 재사용 ★2
assert st('Fed, 기준금리 연 3.75%~4.00%로 동결') <= 2
# 관련도 낮음(스포츠 구단): ★1
assert st('신한은행, 삼성생명에 아쉬운 패배…개막 3연승 도전 실패') == 1
# 사건 유형(M&A·실적)은 v1(★2)보다 높고, 보도 규모(12곳 이상)면 +1
a = art('삼성화재, 영국 특수보험사 경영권 확보')
assert a['score'] == 2 and sv.article_stars(a)[0] == 3 and sv.article_stars(a, 12)[0] == 4
assert sv.article_stars(art('한화손보, 3분기 순익 34% 증가…보험손익 급증'))[0] == 3
# 기존 score 는 바꾸지 않는다
rows = [art('삼성화재, 영국 특수보험사 경영권 확보', i='a'), art('현대해상, 성남시의료원에 ‘마음도서관’ 개관', i='b')]
before = [x['score'] for x in rows]
sv.apply(rows)
assert [x['score'] for x in rows] == before and all(1 <= x['score_v2'] <= 5 for x in rows)

# 사건 점수: 같은 묶음의 관련 기사는 묶음 최고 점수, 관련도 낮은 구성원은 자기 점수
rows = [art('삼성화재, 영국 특수보험사 경영권 확보', i='a'), art('삼성화재, 캐노피우스 경영권 확보', i='b'),
        art('신한은행, 삼성생명에 아쉬운 패배…개막 3연승 도전 실패', i='c')]
rows[1]['title'] = '삼성화재, 英 캐노피우스 경영권 인수…지급여력 영향 촉각'  # 핵심어가 있는 구성원이 묶음 점수를 올림
for x in rows:
    x.update(cluster_id='a', cluster_size=3, cluster_sources=3)
own = [sv.article_stars(x, 3)[0] for x in rows]
sv.apply(rows)
assert rows[0]['score_v2'] == rows[1]['score_v2'] == max(own[:2]) > own[0], (own, [x['score_v2'] for x in rows])
assert rows[2]['score_v2'] == own[2] == 1

# 큰 묶음: 키워드가 많은 제목 하나가 묶음 점수를 끌어올리지 않는다(75% 분위수)
rows = [art('삼성화재, 영국 특수보험사 경영권 확보', i=f'm{k}') for k in range(7)] + [art('삼성화재 캐노피우스 인수, IFRS17 CSM·지급여력 영향', i='m7')]
for x in rows:
    x.update(cluster_id='m0', cluster_size=8, cluster_sources=8)
own = sorted(sv.article_stars(x, 8)[0] for x in rows)
sv.apply(rows)
assert own[-1] > own[0] and all(x['score_v2'] == own[5] < own[-1] for x in rows), (own, [x['score_v2'] for x in rows])

# 묶음의 30% 이상이 홍보성이면 묶음 전체를 홍보성으로(★2 상한)
rows = [art('한화손보, 이대서울병원에 녹색 휴식공간 마련…왕벚나무 80그루 식재', i='a'),
        art('한화손보, 이대서울병원에 친환경 쉼터 웰니스 존 조성', i='b'),
        art('한화손보, 이대서울병원 웰니스 존 쉼터 개소', i='c')]
for x in rows:
    x.update(cluster_id='a', cluster_size=3, cluster_sources=3)
sv.apply(rows)
assert all(x['score_v2'] <= 2 for x in rows), [x['score_v2'] for x in rows]

# ---- AI 채널 ----
sv = scorer('ai')
assert not sv.enabled
st = lambda title, kind='media', feed=None, n=1: sv.article_stars(art(title, kind, feed), n)[0]
assert st('Introducing GPT-6.1 Terra', 'press', 'OpenAI News') >= 4
assert st("구글, '제미나이 4 카본' 정식 출시…'페이블 5.2'의 4분의 1 가격", feed='AI타임스') >= 4
assert st('Case Study - Legora', 'press', 'Anthropic 공식(검색)') <= 2   # 고객 사례
assert st('Jensen Huang accused of having another affair — with an Nvidia exec', feed='TechCrunch AI') <= 2   # 가십

# ---- 설정만으로 동작하는 일반 채널(예: 금융) ----
cfg = {'priority': ['통화정책', '은행'], 'categories': {'통화정책': {'strong': ['기준금리'], 'normal': ['금리']}, '은행': {'company': ['국민은행']}},
       'relevance_keywords': ['금리', '은행']}
v2 = {'enabled': True, 'base': 1.0, 'category_points': {'통화정책': 1.0}, 'event_terms': [{'name': '결정', 'terms': ['인상', '인하', '동결'], 'points': 1.0}],
      'low_value': {'terms': ['이벤트'], 'max_stars': 2}, 'star_thresholds': [1.0, 2.5, 4.0, 5.5], 'coverage_points': [{'sources_at_least': 3, 'add': 1}]}
sv = score_v2.ScoreV2(classify.Classifier(cfg, {}), v2)
f = lambda t, n=1: sv.article_stars({'id': 'x', 'title': t, 'source': 's', 'source_type': 'media', 'category': classify.Classifier(cfg, {}).classify(t)['category'], 'relevant': True}, n)[0]
assert f('한은, 기준금리 동결') == 4          # 1 + 1.5(strong) + 1(카테고리) + 1(사건) = 4.5 → ★4
assert f('한은, 기준금리 동결', 3) == 5       # 보도 매체 3곳 이상 +1
assert f('국민은행 적금 이벤트', 5) == 2      # 낮은 가치: 가산 없이 ★2 상한
assert f('오늘의 날씨') == 2                  # 키워드 없음: base 1 → ★2
assert sv.stars_of(0.99) == 1 and sv.stars_of(1.0) == 2 and sv.stars_of(5.5) == 5
sv.category_points['은행'] = -1.0
assert sv.raw({'title': '국민은행 소식', 'category': '은행', 'source_type': 'media'})[0] == 0.5
assert f('국민은행 소식') == 2                # 관련 기사는 최저 ★2(★1 은 관련도 낮은 기사만)

# 되돌리기
rows = [{'id': 'a', 'score_v2': 3}, {'id': 'b'}]
assert score_v2.strip(rows) == 1 and 'score_v2' not in rows[0]

print('test_score_v2: ok')
