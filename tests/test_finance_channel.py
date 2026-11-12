"""금융 채널 설정 단위 테스트(channels/finance/): 관련도·분류·시황 상한·스포츠 제외·채용 제외·기관 태그·타임존.
엔진(collector/)은 바꾸지 않고 설정만 확인한다. 실행: .venv/bin/python tests/test_finance_channel.py"""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'collector'))
import channel
channel.use('finance')
import collect, entities
from classify import load as load_classifier

def judge(title, kind='media', name='테스트'):
    rel, c = collect.judge(title, kind, name)
    return rel, c['category'], c['score']

# 1) 관련도: 금융 단서가 있으면 관련, 없으면 낮음
for t in ['한국은행, 기준금리 연 2.50%로 동결', '금융위, 스트레스 DSR 3단계 7월 시행', '카카오뱅크 3분기 순이익 1200억원', '증권사 IMA 첫 인가', '원화 스테이블코인 법제화 논의']:
    assert judge(t)[0], t
for t in ['서울 아파트값 3주 연속 상승', '일기예보 내일 전국 비', '공모전 수상작 발표', '삼성전자 갤럭시 신제품 공개', '웹페이지 개편 안내']:
    assert not judge(t)[0], t

# 2) 분류: 4개 카테고리
CASES = [
    ('한국은행, 기준금리 연 2.50%로 동결', '은행·금리·통화정책'),
    ('시중은행 주담대 금리 일제히 인상', '은행·금리·통화정책'),
    ('금감원, 우리은행에 과징금 부과…내부통제 미흡', '금융정책·감독'),
    ('금융위, 책무구조도 시행 앞두고 가이드라인', '금융정책·감독'),
    ('공매도 전면 재개 후 외국인 자금 유입', '증권·자본시장'),
    ('미래에셋증권, IPO 주관 1위', '증권·자본시장'),
    ('토스뱅크, 간편결제 서비스 확대', '핀테크·디지털금융'),
    ('업비트, 가상자산 거래 수수료 인하', '핀테크·디지털금융'),
]
for t, cat in CASES:
    assert judge(t)[1] == cat, (t, judge(t))

# 3) 시황·종목 속보는 ★2 상한, 정책·금리 결정은 높게
for t in ['[특징주] 카카오페이, 스테이블코인 기대에 상한가', '코스피, 외국인 순매수에 상승 마감', '원·달러 환율, 1,400원대 하락 출발', '[마감시황] 코스닥 1% 하락']:
    assert judge(t)[2] <= 2, (t, judge(t))
assert judge('한국은행, 기준금리 0.25%p 인하…금통위 만장일치')[2] >= 4
assert judge('금융위, 스트레스 DSR 3단계 시행…가계부채 관리 강화')[2] >= 4
assert judge('KB국민은행, 연말 봉사활동 실시')[2] <= 2  # 홍보성
# 공식 발표(press) +1
assert judge('금융위원회, 금융소비자보호 제도 개선 방안 발표', 'press')[2] >= judge('금융위원회, 금융소비자보호 제도 개선 방안 발표')[2]

# 4) 스포츠·연예: 금융회사 이름만 걸리는 기사는 관련 없음, 사업 기사는 유지
for t in ['우리카드, 대한항공 꺾고 3연승', 'IBK기업은행 알토스, 흥국생명에 셧아웃 패배', '신한은행 에스버드, 하나은행 꺾고 개막 2연승', 'KB국민은행 후원 골프대회 우승']:
    assert not judge(t)[0], t
assert judge('우리카드, 3분기 순이익 증가')[0]
assert judge('하나은행, 예금금리 0.2%p 인하')[0]

# 5) 채용 소식은 미분류
assert judge('신한은행, 하반기 신입사원 공채 시작')[1] == '미분류'

# 6) 기관·회사 태그(약어 오탐 방지)
ent = entities.tag_entities('한은, 금통위서 기준금리 동결', '연합뉴스', [])
assert '한국은행' in ent['orgs'], ent
assert '한국은행' not in entities.tag_entities('한은행 지점 개설', '연합뉴스', [])['orgs']
assert '예금보험공사' not in entities.tag_entities('일기예보에 따르면', '연합뉴스', [])['orgs']
assert '비바리퍼블리카(토스)' not in entities.tag_entities('토스트 가게 창업 지원', '연합뉴스', [])['companies']
assert '비바리퍼블리카(토스)' in entities.tag_entities('토스, 해외 송금 서비스 출시', '연합뉴스', [])['companies']

# 7) 타임존: 시간대 없는 피드 시각(헤럴드경제·대한금융신문)은 KST, '+09:00'·'+0000' 은 그대로 UTC 변환
import feedparser
def pd(raw):
    e = feedparser.parse(f'<rss><channel><item><title>t</title><link>http://x</link><pubDate>{raw}</pubDate></item></channel></rss>').entries[0]
    return collect.parse_date(e, 'Asia/Seoul')
assert pd('Thu, 12 Nov 2026 11:06:35 +09:00') == '2026-11-12T02:06:35+00:00'  # 매일경제·콜론 있는 오프셋
assert pd('Thu, 12 Nov 2026 03:15:05 +0000') == '2026-11-12T03:15:05+00:00'   # 조선비즈 UTC
feeds = json.loads((ROOT / 'channels/finance/feeds.json').read_text())
assert all(f.get('timezone', 'Asia/Seoul') == 'Asia/Seoul' for f in feeds['rss'])
assert not any('fnnews.com' in f['url'] for f in feeds['rss']), '파이낸셜뉴스 시각 형식은 수집기가 읽지 못한다'
assert len(feeds['queries']) <= 25
ch = json.loads((ROOT / 'channels/finance/channel.json').read_text())
assert ch['timezone'] == 'Asia/Seoul' and ch['schedule_utc'] == ['37 20 * * *']
assert '보험' not in json.dumps(ch, ensure_ascii=False), '금융 채널 화면 문구에 보험 표현 없음'
print('finance channel tests passed')
