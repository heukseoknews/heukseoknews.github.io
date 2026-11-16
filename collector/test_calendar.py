"""일정 캘린더 수집(calendar_collect.py) 테스트: 시간대 변환, ccfddl·보험개발원 파서(직접 만든 짧은 샘플), 실패 시 이전 데이터 유지,
하루 한 번 제한, 304(바뀌지 않음) 처리. 네트워크는 쓰지 않는다."""
import json
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import calendar_collect as cc

KST = timezone(timedelta(hours=9))
kst = lambda iso: datetime.fromisoformat(iso).astimezone(KST).strftime('%Y-%m-%d %H:%M')

# ───── 시간대 ─────
assert cc.tz_of('AoE').utcoffset(None) == timedelta(hours=-12)
assert cc.tz_of(None).utcoffset(None) == timedelta(hours=-12)          # 표기가 없으면 AoE(ccfddl 규칙)
assert cc.tz_of('UTC').utcoffset(None) == timedelta(0)
assert cc.tz_of('UTC+8').utcoffset(None) == timedelta(hours=8)
assert cc.tz_of('UTC-7').utcoffset(None) == timedelta(hours=-7)
assert cc.tz_of('Mars') is None
iso = cc.local_iso('2027-01-28 23:59:59', cc.tz_of('AoE'))
assert iso == '2027-01-28T23:59:59-12:00' and kst(iso) == '2027-01-29 20:59', iso   # AoE 23:59 = 한국 다음 날 20:59
assert kst(cc.local_iso('2026-05-07 11:59:59', cc.tz_of('UTC+0'))) == '2026-05-07 20:59'
pt_summer, pt_winter = cc.local_iso('2026-07-01 23:59', cc.tz_of('PT')), cc.local_iso('2026-12-01 23:59', cc.tz_of('PT'))
assert pt_summer.endswith('-07:00') and pt_winter.endswith('-08:00'), (pt_summer, pt_winter)   # PT 는 서머타임 반영
assert cc.local_iso('2026-03-01', cc.tz_of('AoE')) == '2026-03-01T23:59:59-12:00'          # 시각이 없으면 그날 끝
assert cc.local_iso('TBD', cc.tz_of('AoE')) is None and cc.local_iso('2026-01-01', None) is None

# ───── 학회 개최 기간 ─────
assert cc.conf_dates('June 22-25, 2027') == ('2027-06-22', '2027-06-25')
assert cc.conf_dates('May 01-04, 2023') == ('2023-05-01', '2023-05-04')
assert cc.conf_dates('November 28-December 1, 2022') == ('2022-11-28', '2022-12-01')
assert cc.conf_dates('July 6, 2027') == ('2027-07-06', '2027-07-06')
assert cc.conf_dates('December 8-10 (Sydney), December 9-11 (Atlanta), 2026') is None   # 여러 곳 표기는 넣지 않음
assert cc.conf_dates('TBD') is None and cc.conf_dates(None) is None

# ───── ccfddl 파서(짧은 샘플) ─────
YML = """
- title: TESTCONF
  sub: AI
  confs:
    - year: 2024
      id: tc24
      link: https://example.org/2024
      timeline:
        - deadline: '2024-01-10 23:59:59'
      timezone: AoE
      date: May 1-3, 2024
    - year: 2027
      id: tc27
      link: https://example.org/2027
      timeline:
        - abstract_deadline: '2027-01-21 23:59:59'
          deadline: '2027-01-28 23:59:59'
          rebuttal_deadline: '2027-03-01 23:59:59'
          decision_deadline: '2027-05-01 23:59:59'
          comment: ARR Submission
        - deadline: '2027-02-01 23:59:59'
          comment: 'Separate satellite event: August 15-17, 2027, somewhere'
        - deadline: 'TBD'
      timezone: AoE
      date: July 10-15, 2027
"""
today = datetime(2026, 11, 16).date()
ev = cc.parse_ccfddl(YML, 'tc', today, '2026-11-16')
titles = [e['title'] for e in ev]
assert titles == ['TESTCONF 2027 초록 마감 (ARR Submission)', 'TESTCONF 2027 논문 마감 (ARR Submission)', 'TESTCONF 2027 결과 발표 (ARR Submission)',
                  'TESTCONF 2027 논문 마감', 'TESTCONF 2027 학회 개최'], titles   # 긴 설명은 제목에 넣지 않음
assert all(e['kind'] == 'conf' and e['channel'] == 'ai' and e['source'] == 'ccfddl' and e['org'] == 'TESTCONF' for e in ev)
assert ev[1]['start'] == '2027-01-28T23:59:59-12:00' and ev[1]['tz'] == 'AoE' and ev[1]['link'] == 'https://example.org/2027'
assert ev[4]['start'] == '2027-07-10' and ev[4]['end'] == '2027-07-15' and ev[4]['tz'] is None
assert len({e['id'] for e in ev}) == len(ev)
assert not any('2024' in t for t in titles), '지난해보다 오래된 회차는 넣지 않음'

# ───── 보험개발원 파서(짧은 샘플, 실제 페이지와 같은 표 구조: 날짜 칸 th·내용 칸 td, 머리줄 th·th) ─────
HTML = """<div class="cont-area"><h3>2026년도 보험전문인시험 연간시험일정</h3>
<h4>제49회 보험전문인 제1차시험 일정표</h4><div class="table-overflow-x"><table class="type-table-01"><thead><tr><th>일자</th><th>주요일정</th></tr></thead><tbody>
<tr><th>2026. 1. 9.(금)</th><td>- 시험실시 공고(신문, 홈페이지)</td></tr>
<tr><th>상시운영</th><td>- 영어성적 인터넷 상시 등록</td></tr>
<tr><th>2026. 2. 24.(화) 09:30 ~ 2026. 2. 27.(금) 18:00</th><td>- 응시원서 교부 및 접수 (인터넷접수, 우편접수)</td></tr>
<tr><th>2026. 4. 12.(일)</th><td>- 시험실시</td></tr>
<tr><th>2026. 5. 29.(금)</th><td>- 합격자발표</td></tr></tbody></table></div>
<h4>제49회 보험전문인 제2차시험 일정표</h4><div class="table-overflow-x"><table class="type-table-01"><tbody>
<tr><td>2026. 7. 25.(토)</td><td>- 시험실시 보험계리사 3과목 : 과목 A, 과목 B</td></tr>
<tr><td>2026. 7. 26.(일)</td><td>- 시험실시 보험계리사 2과목 : 과목 C</td></tr></tbody></table></div>
<h4>제32회 보험중개사시험</h4><div class="table-overflow-no"><table class="type-table-01"><tbody>
<tr><td>2026. 12. 18.(금)</td><td>- 합격자발표</td></tr></tbody></table></div></div>"""
URL = 'https://example.org/schedule'
kv = cc.parse_kidi(HTML, URL, '2026-11-16')
got = [(e['title'], e['start'], e.get('end')) for e in kv]
assert got == [
    ('제49회 보험계리사·손해사정사 제1차시험 시행 공고', '2026-01-09', None),
    ('제49회 보험계리사·손해사정사 제1차시험 원서 접수', '2026-02-24T09:30:00+09:00', '2026-02-27T18:00:00+09:00'),
    ('제49회 보험계리사·손해사정사 제1차시험 시험', '2026-04-12', None),
    ('제49회 보험계리사·손해사정사 제1차시험 합격자 발표', '2026-05-29', None),
    ('제49회 보험계리사·손해사정사 제2차시험 시험(1일차)', '2026-07-25', None),
    ('제49회 보험계리사·손해사정사 제2차시험 시험(2일차)', '2026-07-26', None),
    ('제32회 보험중개사시험 합격자 발표', '2026-12-18', None),
], got
assert all(e['org'] == '보험개발원' and e['kind'] == 'exam' and e['channel'] == 'insurance' and e['link'] == URL and e['tz'] == 'KST' for e in kv)
assert len({e['id'] for e in kv}) == len(kv), '같은 단계가 두 번 나와도 id 가 겹치지 않음'
assert cc.parse_kidi('<html><body>점검 중</body></html>', URL, 'x') == []

# ───── 수집 전체: 실패 시 이전 데이터 유지·하루 한 번·304 ─────
class R:
    def __init__(self, code=200, text='', headers=None):
        self.status_code, self.text, self.content, self.headers = code, text, text.encode('utf-8'), headers or {}

def run(tmp, now, ccf, kidi, force=False):
    return cc.collect(tmp / 'data', tmp / 'channels', now=now, force=force, session=object(),
                      fetchers={'ccfddl': ccf, 'kidi': kidi})

with tempfile.TemporaryDirectory() as d:
    tmp = Path(d)
    (tmp / 'channels' / 'ai').mkdir(parents=True); (tmp / 'channels' / 'insurance').mkdir(parents=True)
    (tmp / 'channels' / 'ai' / 'calendar.json').write_text(json.dumps({'sources': [{'id': 'ccfddl', 'type': 'ccfddl', 'base_url': 'https://x/',
        'conferences': [{'name': 'TC', 'path': 'AI/tc.yml'}]}]}))
    (tmp / 'channels' / 'insurance' / 'calendar.json').write_text(json.dumps({'sources': [{'id': 'kidi', 'type': 'kidi', 'url': URL}]}))
    cc.DELAY_S = 0
    t0 = datetime(2026, 11, 16, 19, 0, tzinfo=timezone.utc)
    calls = []
    ok_ccf = lambda s, u, h=None: calls.append(('ccf', h)) or R(200, YML, {'ETag': '"v1"'})
    ok_kidi = lambda s, u, h=None: calls.append(('kidi', h)) or R(200, HTML)
    run(tmp, t0, ok_ccf, ok_kidi)
    auto = json.loads((tmp / 'data' / 'auto.json').read_text()); st = json.loads((tmp / 'data' / 'status.json').read_text())
    assert len(auto['events']) == 5 + 7
    assert st['sources']['kidi']['ok'] and st['sources']['ccfddl']['validators']['AI/tc.yml'] == {'etag': '"v1"', 'v': cc.PARSER_VERSION}
    assert all(set(e) <= {'id', 'title', 'org', 'kind', 'channel', 'start', 'end', 'tz', 'link', 'source', 'checked'} for e in auto['events']), '저장 필드 제한'
    assert [e['start'] for e in auto['events']] == sorted(e['start'] for e in auto['events'])
    # 같은 날 다시 실행하면 요청하지 않음(하루 한 번)
    calls.clear(); run(tmp, t0 + timedelta(hours=3), ok_ccf, ok_kidi)
    assert calls == []
    # 다음 날: 보험개발원 실패(예외)·빈 페이지 → 이전 일정 유지, 실패와 시각 기록. ccfddl 은 304 → 이전 일정 유지(확인일만 오늘)
    t1 = t0 + timedelta(days=1)
    boom = lambda s, u, h=None: (_ for _ in ()).throw(RuntimeError('HTTP 503'))
    not_modified = lambda s, u, h=None: calls.append(('ccf', h)) or R(304)
    calls.clear(); run(tmp, t1, not_modified, boom)
    assert calls == [('ccf', {'If-None-Match': '"v1"'})], calls
    auto2 = json.loads((tmp / 'data' / 'auto.json').read_text()); st2 = json.loads((tmp / 'data' / 'status.json').read_text())
    assert [e['id'] for e in auto2['events']] == [e['id'] for e in auto['events']], '실패·304 에도 일정 그대로'
    assert {e['checked'] for e in auto2['events'] if e['source'] == 'ccfddl'} == {'2026-11-18'}, '304 = 오늘 확인(KST)'
    assert {e['checked'] for e in auto2['events'] if e['source'] == 'kidi'} == {'2026-11-17'}, '실패한 출처의 확인일은 그대로'
    k = st2['sources']['kidi']
    assert k['ok'] is False and 'HTTP 503' in k['error'] and k['last_error_at'] == t1.isoformat() and k['last_success_at'] == t0.isoformat()
    # 비정상적으로 적은 결과(이전 7건 → 0건)도 덮어쓰지 않음
    run(tmp, t1 + timedelta(days=1), not_modified, lambda s, u, h=None: R(200, '<html>점검 중</html>'))
    st3 = json.loads((tmp / 'data' / 'status.json').read_text())
    assert st3['sources']['kidi']['ok'] is False and '0건' in st3['sources']['kidi']['error']
    assert sum(1 for e in json.loads((tmp / 'data' / 'auto.json').read_text())['events'] if e['source'] == 'kidi') == 7
    # 다시 성공하면 실패 표시가 풀림
    run(tmp, t1 + timedelta(days=2), not_modified, ok_kidi)
    st4 = json.loads((tmp / 'data' / 'status.json').read_text())['sources']['kidi']
    assert st4['ok'] is True and 'error' not in st4 and st4['last_success_at'] == (t1 + timedelta(days=2)).isoformat()
    # ccfddl 학회 하나가 망가진 YAML 이면 그 학회만 이전 일정 유지, 출처 전체가 실패면 ok=False
    run(tmp, t1 + timedelta(days=3), lambda s, u, h=None: R(200, ': : not yaml ['), ok_kidi)
    st5 = json.loads((tmp / 'data' / 'status.json').read_text())['sources']['ccfddl']
    assert st5['ok'] is False and sum(1 for e in json.loads((tmp / 'data' / 'auto.json').read_text())['events'] if e['source'] == 'ccfddl') == 5
    # 파서 버전이 바뀌면 조건부 요청 없이 새로 받는다(304 로 옛 제목이 남지 않게)
    cc.PARSER_VERSION += 1
    calls.clear(); run(tmp, t1 + timedelta(days=4), ok_ccf, ok_kidi)
    assert calls[0] == ('ccf', {}), calls
    cc.PARSER_VERSION -= 1
    # dry-run 은 파일을 쓰지 않는다
    before = (tmp / 'data' / 'auto.json').read_text()
    cc.collect(tmp / 'data', tmp / 'channels', now=t1 + timedelta(days=9), dry_run=True, session=object(), fetchers={'ccfddl': ok_ccf, 'kidi': boom})
    assert (tmp / 'data' / 'auto.json').read_text() == before

# ───── 저장소 설정: 기본 학회 12곳, 보험개발원 주소 ─────
ROOT = Path(__file__).resolve().parent.parent
names = [c['name'] for c in json.loads((ROOT / 'channels/ai/calendar.json').read_text())['sources'][0]['conferences']]
assert names == ['NeurIPS', 'ICML', 'ICLR', 'AAAI', 'IJCAI', 'ACL', 'EMNLP', 'NAACL', 'CVPR', 'ICCV', 'ECCV', 'KDD'], names
assert json.loads((ROOT / 'channels/insurance/calendar.json').read_text())['sources'][0]['url'].startswith('https://certi.kidi.or.kr')
print('calendar collector tests passed')
