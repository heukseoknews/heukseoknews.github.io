"""사람 라벨 회귀 테스트: tests/label_eval_samples.json(2026-11-15 /label/ 라벨 239건: 보험 150·AI 89)의 제목·출처·피드를
현재 채널 설정으로 다시 판정해, 필요한 기사(라벨 2 이상)를 숨기는 비율과 라벨 0(불필요)을 숨기는 비율이 나빠지지 않는지 확인한다.
분류·숨김 규칙을 바꿔 이 테스트가 깨지면 라벨 결과(놓침·제거 건수)를 보고 기준을 함께 고친다. 실행: python3 tests/test_label_eval.py"""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'collector'))
import channel
import collect

SAMPLES = json.loads((ROOT / 'tests' / 'label_eval_samples.json').read_text(encoding='utf-8'))['articles']


def judge_all(ch: str) -> list[dict]:
    cd = channel.use(ch)
    boards = cd / 'boards.json'
    collect.RELEVANT_DEPTS.clear()
    collect.RELEVANT_DEPTS.update(json.loads(boards.read_text(encoding='utf-8')).get('relevant_departments', []) if boards.exists() else [])
    collect.ALWAYS_RELEVANT.clear()
    collect.ALWAYS_RELEVANT.update(collect.load_always_relevant(cd))
    rows = [dict(r) for r in SAMPLES if r['channel'] == ch]
    for r in rows:
        r['rel'] = collect.judge(r['title'], r['source_type'], r['feed_name'], r.get('department'))[0]
    return rows


def stats(rows: list[dict]) -> dict:
    hidden = [r for r in rows if not r['rel']]
    return {'n': len(rows), 'hidden': len(hidden),
            'need_hidden': sorted(r['id'] for r in hidden if r['label'] >= 2),
            'zero_hidden': sum(r['label'] == 0 for r in hidden)}


# 기준(2026-11-15 규칙 변경 후 값). 놓침은 이 목록 밖으로 늘면 실패, 라벨 0 제거는 이보다 줄면 실패, 숨김 비율은 상한
EXPECT = {
    'insurance': {'need_hidden': {'b62c2939e452bf40'}, 'zero_hidden_min': 33, 'hidden_max_ratio': 0.35},
    'ai': {'need_hidden': {'341363dd4020e2e5', '562b8d374f78738b', '113c86696146288e', '9fce5e200f61001f', 'bbf546066c07aef1', '08fa4e5f4178f222'},
           'zero_hidden_min': 4, 'hidden_max_ratio': 0.30},
}
by_ch = {}
for ch, exp in EXPECT.items():
    rows = judge_all(ch)
    by_ch[ch] = {r['id']: r for r in rows}
    s = stats(rows)
    extra = set(s['need_hidden']) - exp['need_hidden']
    assert not extra, f'{ch}: 필요한 기사(라벨 2+)가 새로 숨겨짐 {sorted(extra)}'
    assert s['zero_hidden'] >= exp['zero_hidden_min'], f"{ch}: 라벨 0 숨김 {s['zero_hidden']} < {exp['zero_hidden_min']}"
    assert s['hidden'] <= exp['hidden_max_ratio'] * s['n'], f"{ch}: 숨김 {s['hidden']}/{s['n']} 이 상한을 넘음"
    print(f"{ch}: 라벨 {s['n']}건, 숨김 {s['hidden']}, 라벨2+ 숨김 {len(s['need_hidden'])}, 라벨0 숨김 {s['zero_hidden']}")

# 고정 사례
ins, ai = by_ch['insurance'], by_ch['ai']
assert ins['05467752d0456c50']['rel']          # 금감원 지배구조 발표(라벨 3): press_include 로 보임
assert ins['637356f9ae571a42']['rel']          # 자동차보험 연령특약 '확인 방법'(라벨 2): 숨김 규칙 낱말에서 뺀 사례
for i in ('6655611298204535', '754ed80c150c4727', '30d6907372cf3ec5', '25ea3f5a8e22d010', '5621241205e9d41a', '3baa9d0bad455822',
          'a8a908611879b7f0', '3adbfe236cb74a3f'):   # 사진·주가 단신·사회공헌·보험과 무관한 시장 기사(라벨 0)
    assert not ins[i]['rel'], ins[i]['title']
for i in ('d3b9ba6f7bd01af0', '67672a694e389b29', '94ee28b93f9d2d83'):   # 고객 사례(라벨 2~3): 숨기지 않음
    assert ai[i]['rel'], ai[i]['title']
print('label eval tests passed')
