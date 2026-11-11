"""엔진 일반화 테스트: 영어 매처(match_mode 'en'), 관련도 판정 모드, 공식 발표 관련도 조건, 점수 선택 항목,
피드별 타임존, 소스 설정 이전(직접 RSS·구글 언어). 보험 채널(기본값)의 동작이 그대로인지도 함께 확인한다."""
import json, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import channel
import collect
from classify import Classifier, Matcher, _squash
from trends import week_start

hit = lambda k, t, mode='en': Matcher(k, mode).find(t.casefold(), _squash(t)) >= 0

# 1) 영어 매처: 복수형·하이픈 변형·버전 경계·단어 경계
EN = [
    ('ai', 'Sam Altman said the deal is final', False),      # said 안의 ai
    ('ai', 'OpenAI unveils new model', False),                # 회사명 안의 AI
    ('ai', 'AI chips surge', True),
    ('model', 'Google releases two new models', True),         # 복수형
    ('llm', 'LLMs are getting cheaper', True),
    ('world model', 'DeepMind world models explained', True),
    ('open source', 'Meta open-sources Llama 5', True),        # 하이픈 + 동사형
    ('open source', 'opensource tools', True),
    ('gpt-4.5', 'OpenAI ships GPT-4.5 Turbo', True),
    ('gpt-4.5', 'GPT-4.55 benchmark', False),                  # 버전 번호 경계
    ('gpt-4', 'GPT-4.5 is out', False),
    ('llama 3.1', 'Llama 3.10 rumor', False),
    ('llama 3.1', 'Llama 3.1 405B', True),
    ('jepa', 'V-JEPA 2 released', True),
    ('c++', 'new C++ compiler', True),
    ('월드모델', '엔비디아 월드 모델 공개', True),                 # 한글은 띄어쓰기 무시 부분일치 그대로
]
for k, t, exp in EN:
    assert hit(k, t) is exp, (k, t, exp)
# 일반 단어 'world' 는 키워드로 쓰면 오탐한다(World Cup) → 키워드는 'world model' 처럼 구로만 쓴다
assert hit('world', 'World Cup final') is True and hit('world model', 'World Cup final') is False

# 2) 'ko' 모드(기본, 보험 채널)는 지금까지와 같다: 복수형 미처리, 마침표 있는 영문은 부분일치, 한글 부분일치
assert hit('model', 'two new models', 'ko') is False
assert hit('gpt-4.5', 'GPT-4.55', 'ko') is True
assert hit('GA', 'GA 설계사 수수료', 'ko') is True and hit('GA', 'GAAP 기준', 'ko') is False
assert hit('실손보험', '실손 보험 청구', 'ko') is True
try:
    Matcher('x', 'fr'); raise AssertionError('잘못된 mode 는 오류')
except ValueError:
    pass

# 3) 관련도 판정: 'substring'(보험 기본) vs 'word'(match_mode 'en' 기본)
base_cfg = {'priority': ['A'], 'categories': {'A': {'strong': ['model']}}, 'relevance_keywords': ['ai']}
ko = Classifier({**base_cfg}, {})
en = Classifier({**base_cfg, 'match_mode': 'en'}, {})
assert ko.classify('Altman said yes')['relevant'] is True        # 기존 동작(부분일치) 그대로
assert en.classify('Altman said yes')['relevant'] is False
assert en.classify('New AI rules')['relevant'] is True
assert Classifier({**base_cfg, 'match_mode': 'en', 'relevance_mode': 'substring'}, {}).classify('Altman said yes')['relevant'] is True
assert en.classify('Two new models')['category'] == 'A'

# 4) 점수 항목은 모두 선택: 빈 score 설정이면 base 2, 상한 5
c = en.classify('Two new models')
assert c['score'] == 2
assert Classifier({**base_cfg, 'match_mode': 'en'}, {'base': 1, 'max': 3, 'keyword_thresholds': [{'top_at_least': 3, 'add': 5}]}).classify('new model')['score'] == 3

# 5) 공식 발표(press) 관련도 조건: 보험 채널은 설정 낱말이 없으면 관련도 낮음, 키가 없는 채널은 조건 없음
ins = collect.load_classifier()
assert ins.press_ok('금융위, 실손보험 개선') and not ins.press_ok('금융위, 은행 예대율 규제 완화')
assert en.press_ok('OpenAI announces GPT-6')
assert collect.judge('금융위, 은행 예대율 규제 완화', 'press', '금융위원회 RSS')[0] is False

# 6) 피드별 타임존: 타임존 없는 시각은 피드 설정으로 해석(기본 Asia/Seoul = 이전의 -9h), 타임존 있는 시각은 그대로
naive = {'published': '2026-11-20 09:00:00', 'published_parsed': time.strptime('2026-11-20 09:00:00', '%Y-%m-%d %H:%M:%S')}
assert collect.parse_date(naive) == '2026-11-20T00:00:00+00:00'
assert collect.parse_date(naive, 'Asia/Seoul') == '2026-11-20T00:00:00+00:00'
assert collect.parse_date(naive, 'America/New_York') == '2026-11-20T14:00:00+00:00'   # 11월 = EST(UTC-5)
assert collect.parse_date(naive, 'UTC') == '2026-11-20T09:00:00+00:00'
aware = {'published': 'Fri, 20 Nov 2026 09:00:00 GMT', 'published_parsed': time.strptime('2026-11-20 09:00:00', '%Y-%m-%d %H:%M:%S')}
assert collect.parse_date(aware, 'America/New_York') == '2026-11-20T09:00:00+00:00'
assert week_start('2026-11-15T16:00:00+00:00') == '2026-11-16'                       # KST 월요일 01시
assert week_start('2026-11-15T16:00:00+00:00', 'UTC') == '2026-11-09'

# 7) 소스 설정: 보험 채널의 직접 RSS 4개가 예전 코드 상수와 같은 순서·값으로 설정에서 온다
rows, queries, max_age = collect.load_sources(channel.config_path('insurance'))
assert [r[:4] for r in rows[:4]] == [
    ('보험매일', 'https://www.fins.co.kr/rss/allArticle.xml', 'media', '보험매일'),
    ('보험저널', 'https://www.insjournal.co.kr/rss/allArticle.xml', 'media', '보험저널'),
    ('한국보험신문', 'https://www.insnews.co.kr/rss/allArticle.xml', 'media', '한국보험신문'),
    ('금융위원회 RSS', 'https://www.fsc.go.kr/about/fsc_bbs_rss/?fid=0111', 'press', '금융위원회')]
assert all(r[4]['timezone'] == 'Asia/Seoul' for r in rows) and max_age == 180
assert all(r[1].endswith('&hl=ko&gl=KR&ceid=KR:ko') for r in rows if r[0] in queries) and len(queries) == len(rows) - 4

# 구글 언어·타임존은 쿼리별/피드별로 바꿀 수 있다
with tempfile.TemporaryDirectory() as d:
    (Path(d) / 'feeds.json').write_text(json.dumps({'default_timezone': 'UTC', 'google_lang': 'en',
        'rss': [{'name': 'R', 'url': 'https://x/rss', 'timezone': 'America/New_York'}, {'name': 'K', 'url': 'https://y/rss'}],
        'queries': [{'name': 'Q1', 'q': 'AI'}, {'name': 'Q2', 'q': '인공지능', 'lang': 'ko'}]}), encoding='utf-8')
    rows, queries, _ = collect.load_sources(Path(d))
    tz = {r[0]: r[4]['timezone'] for r in rows}
    assert tz == {'R': 'America/New_York', 'K': 'UTC', 'Q1': 'UTC', 'Q2': 'UTC'}
    url = {r[0]: r[1] for r in rows}
    assert url['Q1'].endswith('&hl=en-US&gl=US&ceid=US:en') and url['Q2'].endswith('&hl=ko&gl=KR&ceid=KR:ko')
    assert collect.load_substitutes(Path(d)) == {}
try:
    collect.google('x', lang='fr'); raise AssertionError('지원하지 않는 lang 은 오류')
except ValueError:
    pass
assert channel.timezone() == 'Asia/Seoul'

# 8) 피드별 기사 최대 나이(전체 이력을 주는 공식 블로그 RSS 용), 출처 유형 가산(score.json source_type_bonus)
with tempfile.TemporaryDirectory() as d:
    (Path(d) / 'feeds.json').write_text(json.dumps({'max_age_days': 180, 'rss': [{'name': 'R', 'url': 'https://x/rss', 'max_age_days': 30}, {'name': 'S', 'url': 'https://y/rss'}]}), encoding='utf-8')
    rows, _, max_age = collect.load_sources(Path(d))
    assert [r[4]['max_age_days'] for r in rows] == [30, None] and max_age == 180
assert all(r[4]['max_age_days'] is None for r in collect.load_sources(channel.config_path('insurance'))[0][:4])  # 보험 RSS 는 제한 없음(이전과 같음)
bonus = Classifier({**base_cfg, 'match_mode': 'en'}, {'max': 5, 'source_type_bonus': {'press': 1}})
assert bonus.source_bonus(2, 'press') == 3 and bonus.source_bonus(5, 'press') == 5 and bonus.source_bonus(2, 'media') == 2 and bonus.source_bonus(2, None) == 2
assert ins.source_bonus(3, 'press') == 3   # 보험 채널은 가산 없음
print('engine tests passed')
