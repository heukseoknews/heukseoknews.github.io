"""보험사·유관기관 매칭 단위 테스트. 실행: python collector/test_entities.py"""
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import collect
from entities import Entities, tag_entities

m = lambda t, s=None: tag_entities(t, s, [])
# 보험사: 정식명으로 통일, 별칭 여러 개, 제목에 나온 순서, 복수 가능
assert m('삼성화재·DB손보, 캐노피우스 인수')['companies'] == ['삼성화재', 'DB손해보험', '캐노피우스']
assert m('KB손해보험과 KB손보')['companies'] == ['KB손해보험'], '같은 회사의 별칭은 한 번만'
assert m('삼성 생명 보험')['companies'] == ['삼성생명'] and m('삼성 보험')['companies'] == [], '띄어쓰기는 무시'
# 모호한 단독 약어는 매칭하지 않는다
for t in ['삼성 현대 한화 KB DB 보험 실적', '현대차 한화솔루션 KB금융 DB하이텍 삼성전자 보험', '신한은행 보험 판매', '하나은행 하나금융 보험']:
    assert m(t)['companies'] == [], t
assert m('한화손보와 한화생명 제휴')['companies'] == ['한화손해보험', '한화생명']
assert m('Munich Re·하노버Re 재보험 요율')['companies'] == ['뮌헨리', '하노버리']
assert m('ABLE생명 아님 / ABL생명 실적')['companies'] == ['ABL생명']
# 유관기관: 별칭, 단어 안에 우연히 들어간 약어는 제외
assert m('금감원, 금융위와 합동 점검')['orgs'] == ['금융감독원', '금융위원회']
assert m('신한은행 금리 인하')['orgs'] == [], "'한은' 이 '신한은행' 안에서 일치하면 안 됨"
assert m('한은 기준금리 동결, 신한은행 영향')['orgs'] == ['한국은행']
assert m('예보료 인상안')['orgs'] == [] and m('예보, 보험계약자 보호 논의')['orgs'] == ['예금보험공사']
assert m('생보협회·손보협회, 보험연구원 공동 세미나')['orgs'] == ['생명보험협회', '손해보험협회', '보험연구원']
assert m('대법원 판결, 국회 계류')['orgs'] == ['법원·대법원', '국회'] or sorted(m('대법원 판결, 국회 계류')['orgs']) == ['국회', '법원·대법원']
# 공식 게시글: 제목에 기관명이 없어도 출처가 그 기관이면 포함
assert m('보험사 지급여력 제도 개선 방안', '금융위원회')['orgs'] == ['금융위원회']
assert m('보험사 지급여력 제도 개선 방안', '한국경제')['orgs'] == []
# 기존 태그와 통일: 보험사·기관 이름인 태그는 제거(필터의 정식명으로 표시), 나머지 태그는 유지
r = tag_entities('금감원, 삼성화재 점검', None, ['금감원', '삼성화재', '실손', '금융위원회'])
assert r['tags'] == ['실손'] and r['orgs'] == ['금융감독원'] and r['companies'] == ['삼성화재']
# 보험사 이름이 나오면 '보험' 단어가 없어도 관련 기사, 스포츠 구단 기사는 제외
rel, c = collect.judge('메리츠화재 3분기 순익 3285억…전년비 29.2%↓', 'media', '보험매일')
assert rel is True and c['category'] != '미분류'
assert collect.judge('KB손보, 현대캐피탈에 3-1 역전승', 'media', '뉴시스')[0] is False
assert collect.judge('삼성 현대 한화 실적 발표', 'media', '뉴시스')[0] is False, '단독 약어는 보험사로 보지 않음'
# 보험사와 같은 이름의 구단·연예·방송 기사는 관련 기사가 아니다(config/context_exclude.json). 실제 제목들
NOT_RELEVANT = [
    "김연경, 친정팀 흥국생명 꺾고 최고시청률 7% 찍었다(‘신인감독2’)[美친시청률]",
    "김연경 원더독스, 흥국생명에 역스윕 승리…5세트 혈투 끝 웃었다",
    "원더독스 3세트 10대 0 반격…흥국생명과 5회 맞대결 : 연예",
    "흥국생명-현대건설 첫 맞대결, 경기 개최 오후 4시에서 2시로 변경",
    "22일 V-리그 여자부 현대건설-흥국생명전 경기 개시 시각 오후 2로 변경",
    "'킨델란 22점' 흥국생명, 부키리치 빠진 정관장에 셧아웃 승리",
    "[BK 프리뷰] ‘시즌 전 예상 5·6위의 반란’ 신한은행-삼성생명, 평가 뒤집을 승자는?",
    "[SD 대전 인터뷰] 틸리카이넨 삼성화재 감독, “리시브가 핵심, 유광우가 한 걸음이라도 덜 뛰게 해야”",
    "삼성화재배 목진석, 시니어로 입장해 16강 승자로 [PS]",
    "이걸 뒤집었다고? '3세트 대역전극' 현대캐피탈, KB손해보험에 3-1 승리…레오+허수봉 46점 합작",
    "OK저축은행, 블로킹 16개…KB손보 꺾고 승리",
    "‘우승 후보’ 한화생명, MSI 첫 경기서 TSW 3-0 완파 [MSI]",
    "KB손보, 피프티피프티 출연 웹예능 'Z-톡스' 공개",
]
for t in NOT_RELEVANT:
    assert collect.judge(t, 'media', '테스트')[0] is False, t
    assert collect.judge(t, 'media', '테스트')[1]['category'] == '미분류', t
# 보험 사업 단서가 있으면 제외어가 있어도 관련으로 유지, 제외어가 없는 일반 기사도 유지
RELEVANT = [
    "삼성화재, 배구단 후원 확대 보험 상품 출시",
    "흥국생명, 프로배구단 운영 비용 늘며 3분기 순익 감소",
    "KB손해보험, 신규 웹예능 연계 건강보험 출시",
    "삼성생명 주가 7,500원 상승 후 장마감",
    "NH농협생명 경영기획부문, 경기 안성 농가 찾아 농촌일손돕기 실시",
    "[포토] 현대해상, 경기 성남시의료원 ‘마음도서관’ 개관",
    "DB손보, 소방관에 ‘프로미 쿠키’와 손편지 전달",
    "금융감독원, 삼성생명 종합검사 착수…지급여력 점검",
    "[한화손보 펨테크 리포트 ③] '디시전 메이커' 잡았다…여성 팬덤이 끌어올릴 CSM의 선순환",
    "삼성화재, 英 캐노피우스 경영권 2조2647억원에 확보…해외사업 승부수",
    "현대해상 '트래블패스365 해외여행보험' 출시…1년 내내 보장",
    "[5일 보험주 마감시황] 삼성생명 5.96%↓·DB손보 3.23%↑…상장 GA 동반 상승",
]
for t in RELEVANT:
    assert collect.judge(t, 'media', '테스트')[0] is True, t
# 제외어는 config 에서 온다(코드 하드코딩 아님): 파일에 있는 낱말이 실제로 쓰이고, '감독'은 '금융감독원' 안에서는 제외어가 아니다
import entities
assert '신인감독' in json.dumps(entities._context_cfg(), ensure_ascii=False) and not entities.sports_team_title('금융감독원, 삼성생명 검사')
# 설정 기반: 목록을 바꾸면 결과가 바뀐다
e = Entities([{'name': '테스트보험', 'group': '기타', 'aliases': ['테스트보험']}])
assert e.match('테스트보험 출시') == ['테스트보험'] and e.match('삼성화재') == []

# 기사 저장 필드·재실행 안전: make_article 이 companies/orgs 를 넣고, reclassify 를 두 번 돌려도 같은 결과
a = collect.make_article('금감원, 삼성화재 실손보험 점검', 'https://x/1', '한국경제', 'media', '2026-11-01T00:00:00+00:00', 'c', '주요 경제지·보험')
assert a['companies'] == ['삼성화재'] and a['orgs'] == ['금융감독원'] and '삼성화재' not in a['tags'] and '금감원' not in a['tags']
with tempfile.TemporaryDirectory() as d:
    old = {k: v for k, v in a.items() if k not in ('companies', 'orgs')}
    (Path(d) / '2026-11.json').write_text(json.dumps([old], ensure_ascii=False), encoding='utf-8')
    outs = []
    for _ in range(2):
        collect.reclassify(Path(d))
        outs.append((Path(d) / '2026-11.json').read_text(encoding='utf-8'))
    row = json.loads(outs[0])[0]
    assert row['companies'] == ['삼성화재'] and row['orgs'] == ['금융감독원'] and outs[0] == outs[1]
    collect.rescore(Path(d))  # 점수만 바꾸고 companies/orgs 는 그대로
    assert json.loads((Path(d) / '2026-11.json').read_text(encoding='utf-8'))[0]['companies'] == ['삼성화재']
print('entities tests passed')
