"""scripts/local/run_scoring.py 테스트(가짜 Ollama + 임시 git 저장소·원격). 실행: python tests/test_run_scoring.py
대상 선정(7일·점수 있음·숨김·상한), 드라이런 무변경, 검증(구조·범위·추가만·id·크기·LF), 스테이징 범위(다른 변경 불변),
커밋 메시지, push 거절 시 rebase 후 한 번 재시도·충돌 시 멈춤, 작성자 이메일 없음, 잠금, 메모리 경고, Ollama 켜고 끄기."""
import contextlib
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'local'))
import llm_score as L  # noqa: E402
import run_scoring as R  # noqa: E402

GIT = R.find_git()
assert GIT, 'git 이 필요합니다'
NOW = datetime.now(timezone.utc)
TMP = Path(tempfile.mkdtemp(prefix='run_scoring_test_'))
# 사용자·시스템 git 설정(자격 증명 도우미 등)과 섞이지 않게
(TMP / 'gitconfig').write_text('', encoding='utf-8')
os.environ['GIT_CONFIG_GLOBAL'] = str(TMP / 'gitconfig')
os.environ['GIT_CONFIG_NOSYSTEM'] = '1'
R.free_ram_gb = lambda: 16.0


def g(cwd: Path, *args, check=True) -> str:
    r = subprocess.run([GIT, *args], cwd=cwd, capture_output=True, text=True, encoding='utf-8')
    if check and r.returncode != 0:
        raise AssertionError(f'git {args}: {r.stderr}')
    return r.stdout.strip()


class Fake:
    """Ollama 가짜. 제목에 FORMAT 이 있으면 JSON 이 아닌 응답."""
    base = 'http://localhost:11434'

    def __init__(self):
        self.calls = 0; self.unloaded = 0
    def version(self): return '0.40.16'
    def model_digest(self, m): return 'sha256:test' if m == L.MODEL else None
    def loaded(self): return []
    def unload(self, m): self.unloaded += 1
    def chat(self, body):
        self.calls += 1
        if 'FORMAT' in body['messages'][1]['content']:
            return {'message': {'content': 'not json'}}
        lp = lambda t, p: {'token': t, 'logprob': math.log(p)}
        return {'message': {'content': json.dumps({'score': 4})},
                'logprobs': [{'token': '4', 'logprob': math.log(0.6), 'top_logprobs': [lp('4', 0.6), lp('3', 0.4)]}]}


def art(i, title, days_ago=1.0, relevant=True):
    d = NOW - timedelta(days=days_ago)
    a = {'id': i, 'title': title, 'source': '한국경제', 'collected_at': d.isoformat(), 'published_at': d.isoformat()}
    if relevant is not None:
        a['relevant'] = relevant
    return a


ARTS = {
    'insurance': [art('i1', '보험사 실적'), art('i2', '숨김', relevant=False), art('i3', '6일 전', days_ago=6), art('i4', '8일 전', days_ago=8),
                  art('i5', '이미 점수 있음'), art('i6', 'FORMAT 이상한 응답')],
    'ai': [art('a1', 'New model released')],
    'finance': [art('f1', '기준금리 동결')],
}
NAMES = {'insurance': '보험', 'ai': 'AI', 'finance': '금융'}
month_of = lambda a: a['collected_at'][:7]
EXISTING = {'model': L.MODEL, 'model_digest': 'sha256:old', 'ollama_version': '0.30.8', 'prompt_version': 'v1-e2ev',
            'provisional': False, 'score_int': 2, 'score_ev': 2.1, 'scored_at': '2026-11-01T00:00:00Z'}


def write(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes((json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + '\n').encode('utf-8'))


def make_repo(name: str) -> tuple[Path, Path]:
    """(작업 저장소, 원격 bare). 기사·채널 이름·기존 점수 1건(i5)을 커밋해 원격에 올린다."""
    base = TMP / name; remote = base / 'remote.git'; work = base / 'work'
    remote.mkdir(parents=True); work.mkdir()
    g(remote, 'init', '-q', '--bare', '-b', 'main')
    g(work, 'init', '-q', '-b', 'main')
    g(work, 'config', 'user.name', 'Test'); g(work, 'config', 'user.email', 'test@example.invalid')
    g(work, 'config', 'core.autocrlf', 'false')
    g(work, 'remote', 'add', 'origin', str(remote))
    (work / '.gitignore').write_text('*.log\n', encoding='utf-8')
    (work / 'README.md').write_text('readme\n', encoding='utf-8')
    for ch, rows in ARTS.items():
        write(work / 'channels' / ch / 'channel.json', {'slug': ch, 'name': NAMES[ch]})
        for m in sorted({month_of(a) for a in rows}):
            write(work / 'data' / ch / f'{m}.json', [a for a in rows if month_of(a) == m])
    i5 = next(a for a in ARTS['insurance'] if a['id'] == 'i5')
    write(work / 'data' / 'insurance' / 'llm' / f'{month_of(i5)}.json', {'i5': [EXISTING]})
    g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'init'); g(work, 'push', '-q', 'origin', 'main')
    g(work, 'branch', '--set-upstream-to=origin/main', 'main')
    return work, remote


def clone(remote: Path, name: str) -> Path:
    d = remote.parent / name
    g(remote.parent, 'clone', '-q', str(remote), str(d))
    g(d, 'config', 'user.name', 'Other'); g(d, 'config', 'user.email', 'other@example.invalid'); g(d, 'config', 'core.autocrlf', 'false')
    return d


def run_tool(work: Path, argv: list[str], ask=lambda q: '', client=None, launcher=None) -> tuple[int, str]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = R.main(argv, root=work, client=client or Fake(), ask=ask, launcher=launcher)
    return rc, buf.getvalue()


def no_ask(q):
    raise AssertionError(f'묻지 않아야 함: {q}')


def llm_files(work: Path) -> list[str]:
    return sorted(p.relative_to(work).as_posix() for p in work.glob('data/*/llm/*.json'))


# ───── 옵션 ─────
for bad in (['--limit', '1501'], ['--limit', '0']):
    with contextlib.redirect_stderr(io.StringIO()):
        try:
            R.parse_args(bad); raise AssertionError(bad)
        except SystemExit:
            pass
a = R.parse_args([])
assert a.limit == 1500 and a.since == '7' and not a.dry_run and not a.yes
assert R.order_channels(['finance', 'zeta', 'ai', 'insurance']) == ['insurance', 'ai', 'finance', 'zeta']
# 상한: 채널과 상관없이 최신 기사부터, 고른 뒤에는 채널별 묶음·시간순
T = [('insurance', 'm', art('old1', 'x', days_ago=5)), ('insurance', 'm', art('new1', 'x', days_ago=0.1)),
     ('ai', 'm', art('old2', 'x', days_ago=6)), ('ai', 'm', art('new2', 'x', days_ago=0.2)), ('finance', 'm', art('mid', 'x', days_ago=2))]
CH = ['insurance', 'ai', 'finance']
assert [t[2]['id'] for t in R.pick_newest(T, CH, 3)] == ['new1', 'new2', 'mid']
assert [t[2]['id'] for t in R.pick_newest(T, CH, 2)] == ['new1', 'new2']
assert [t[2]['id'] for t in R.pick_newest(T, CH, 9)] == ['old1', 'new1', 'old2', 'new2', 'mid']
assert R.commit_message({'insurance': 3, 'finance': 1}, NAMES) == 'data(llm): 점수 4건 (보험 3, AI 0, 금융 1)'

# ───── 드라이런: 대상 선정, 아무것도 쓰지 않음 ─────
work, remote = make_repo('dry')
head0 = g(work, 'rev-parse', 'HEAD')
fake = Fake()
rc, out = run_tool(work, ['--dry-run'], ask=no_ask, client=fake)
assert rc == 0, out
# 대상: i1·i3·i6(보험), a1, f1 = 5. 제외: i2(숨김)·i4(8일 전)·i5(점수 있음)
assert '합계 5건' in out and fake.calls == 5, out               # 형식 오류(FORMAT)는 재시도하지 않음
assert g(work, 'rev-parse', 'HEAD') == head0 and g(work, 'status', '--porcelain') == '', '드라이런은 아무것도 바꾸지 않음'
assert llm_files(work) == [f'data/insurance/llm/{month_of(ARTS["insurance"][4])}.json'] and fake.unloaded >= 1
assert '드라이런: 아무것도 쓰지 않았고' in out

# 상한
rc, out = run_tool(work, ['--dry-run', '--limit', '2'], ask=no_ask)
assert '합계 2건 (찾은 5건 중 상한 2건)' in out, out
# 채널 지정
rc, out = run_tool(work, ['--dry-run', '--channels', 'ai'], ask=no_ask)
assert '합계 1건' in out, out

# 실행 기록: logs/ 에 남고 git 은 무시한다
logs = list((work / 'logs').glob('run_scoring-*.log'))
assert logs and '대상:' in logs[0].read_text(encoding='utf-8') and g(work, 'status', '--porcelain') == ''

# ───── 전체 흐름: 점수 파일만 커밋·push, 다른 변경은 그대로 ─────
work, remote = make_repo('full')
(work / 'README.md').write_text('local edit\n', encoding='utf-8')     # 추적 파일 수정(커밋에서 빠져야 함)
(work / 'notes.txt').write_text('memo\n', encoding='utf-8')           # 새 파일(커밋에서 빠져야 함)
asked = []
rc, out = run_tool(work, [], ask=lambda q: asked.append(q) or '')
assert rc == 0, out
assert len(asked) == 1 and 'Enter' in asked[0]
assert '점수 파일이 아닌 변경이 있습니다' in out and 'README.md' in out and 'notes.txt' in out
assert '실패 [insurance] i6: format' in out
committed = g(work, 'show', '--name-only', '--format=%s', 'HEAD').splitlines()
assert committed[0] == 'data(llm): 점수 4건 (보험 2, AI 1, 금융 1)', committed
assert all(R.LLM_FILE.match(p) for p in committed[1:] if p), committed
assert g(work, 'rev-parse', 'HEAD') == g(remote, 'rev-parse', 'main'), 'push 됨'
st = g(work, 'status', '--porcelain')
assert 'M README.md' in st and '?? notes.txt' in st and 'data/' not in st, st
assert (work / 'README.md').read_text(encoding='utf-8') == 'local edit\n'
# 기존 기록 유지, 금융은 provisional
ins = json.loads((work / f'data/insurance/llm/{month_of(ARTS["insurance"][4])}.json').read_text(encoding='utf-8'))
assert ins['i5'] == [EXISTING]
fin = json.loads((work / f'data/finance/llm/{month_of(ARTS["finance"][0])}.json').read_text(encoding='utf-8'))
assert fin['f1'][0]['provisional'] is True and fin['f1'][0]['prompt_version'] == 'v1-e2ev-noex' and fin['f1'][0]['score_ev'] == 3.6
assert b'\r' not in (work / f'data/finance/llm/{month_of(ARTS["finance"][0])}.json').read_bytes()
# 다시 실행: 새 대상은 실패했던 i6 하나뿐, 성공 없음 → 커밋 없음
head1 = g(work, 'rev-parse', 'HEAD')
rc, out = run_tool(work, [], ask=no_ask)
assert '합계 1건' in out and g(work, 'rev-parse', 'HEAD') == head1, out

# ───── 확인에서 그만두기 → 다음 실행 때 남은 파일을 검증·커밋 ─────
work, remote = make_repo('decline')
rc, out = run_tool(work, [], ask=lambda q: 'n')
assert rc == 0 and '그만뒀습니다' in out and g(work, 'log', '--format=%s', '-1') == 'init'
assert any(R.LLM_FILE.match(p) for p in g(work, 'status', '--porcelain').split())
rc, out = run_tool(work, ['--yes', '--channels', 'ai'], ask=no_ask)     # ai 는 이미 채점됨 → 대상 0, 남은 파일만
assert rc == 0 and '이전 실행에서 커밋되지 않은 점수 파일' in out, out
assert g(work, 'log', '--format=%s', '-1') == 'data(llm): 점수 4건 (보험 2, AI 1, 금융 1)'
assert g(work, 'status', '--porcelain') == ''

# ───── push 거절 → pull --rebase → 한 번 재시도 성공 ─────
work, remote = make_repo('retry')
other = clone(remote, 'other')


def ask_and_race(q):
    (other / 'other.md').write_text('x\n', encoding='utf-8')
    g(other, 'add', 'other.md'); g(other, 'commit', '-q', '-m', 'other'); g(other, 'push', '-q', 'origin', 'main')
    return ''


rc, out = run_tool(work, [], ask=ask_and_race)
assert rc == 0 and 'push 가 거절되어' in out and 'push 완료(다시 시도)' in out, out
log = g(remote, 'log', '--format=%s', 'main').splitlines()
assert log[0].startswith('data(llm): 점수') and log[1] == 'other', log

# ───── 재시도 중 충돌 → rebase 취소하고 멈춤(force 없음) ─────
work, remote = make_repo('conflict')
other = clone(remote, 'other')
fmonth = month_of(ARTS['finance'][0])


def ask_and_conflict(q):
    write(other / 'data' / 'finance' / 'llm' / f'{fmonth}.json', {'f1': [dict(EXISTING, prompt_version='v1-e2ev-noex', provisional=True)]})
    g(other, 'add', '-A'); g(other, 'commit', '-q', '-m', 'other llm'); g(other, 'push', '-q', 'origin', 'main')
    return ''


rc, out = run_tool(work, [], ask=ask_and_conflict)
assert rc == 2 and 'pull --rebase 실패' in out and 'rebase 를 취소' in out, out
gd = Path(g(work, 'rev-parse', '--absolute-git-dir'))
assert not (gd / 'rebase-merge').exists() and not (gd / 'rebase-apply').exists()
assert g(work, 'log', '--format=%s', '-1').startswith('data(llm)'), '로컬 커밋은 남음'
assert g(remote, 'log', '--format=%s', '-1', 'main') == 'other llm', '원격은 덮어쓰지 않음'

# ───── 작성자 이메일 없음 → 채점 전에 멈춤 ─────
work, remote = make_repo('noemail')
g(work, 'config', '--unset', 'user.email')
fake = Fake()
rc, out = run_tool(work, [], ask=no_ask, client=fake)
assert rc == 2 and 'user.email' in out and fake.calls == 0, out
rc, out = run_tool(work, ['--dry-run', '--limit', '1'], ask=no_ask)   # 드라이런은 커밋하지 않으므로 가능
assert rc == 0, out

# ───── 다른 브랜치·미리 스테이징된 변경 → 멈춤 ─────
work, remote = make_repo('guards')
(work / 'README.md').write_text('staged\n', encoding='utf-8'); g(work, 'add', 'README.md')
rc, out = run_tool(work, ['--yes'], ask=no_ask)
assert rc == 2 and '이미 스테이징된 변경' in out, out
g(work, 'reset', '-q'); g(work, 'switch', '-q', '-c', 'side')
rc, out = run_tool(work, ['--yes'], ask=no_ask)
assert rc == 2 and 'main 브랜치가 아닙니다' in out, out

# ───── 검증 ─────
work, remote = make_repo('validate')
git = R.Git(work)
i5m = month_of(ARTS['insurance'][4]); rel = f'data/insurance/llm/{i5m}.json'
new_ok = dict(EXISTING, prompt_version='v2', score_int=5, score_ev=4.9)


def check(obj, raw: bytes | None = None):
    p = work / rel
    p.write_bytes(raw if raw is not None else (json.dumps(obj, ensure_ascii=False) + '\n').encode('utf-8'))
    return R.validate(work, git, [rel])


added, errs = check({'i5': [EXISTING, new_ok], 'i1': [new_ok]})
assert errs == [] and added == {'insurance': 2}, errs
assert any('기존 기록이 바뀌거나' in e for e in check({'i5': [dict(EXISTING, score_int=3)]})[1])
assert any('기존 기록이 바뀌거나' in e for e in check({'i1': [new_ok]})[1]), 'i5 삭제'
assert any('0~5' in e for e in check({'i5': [EXISTING], 'i1': [dict(new_ok, score_int=7)]})[1])
assert any('0~5' in e for e in check({'i5': [EXISTING], 'i1': [dict(new_ok, score_ev=5.5)]})[1])
assert any('기사 파일에 없는 id' in e for e in check({'i5': [EXISTING], 'zz': [new_ok]})[1])
assert any('중복' in e for e in check({'i5': [EXISTING], 'i1': [new_ok, new_ok]})[1])
assert any('JSON 아님' in e for e in check(None, b'{broken')[1])
assert any('객체가 아님' in e for e in check([1, 2])[1])
assert any('LF' in e for e in check(None, b'{"i5": []}\r\n')[1])
old_max = R.MAX_FILE_BYTES; R.MAX_FILE_BYTES = 10
assert any('상한' in e for e in check({'i5': [EXISTING]})[1])
R.MAX_FILE_BYTES = old_max
assert any('경로가 아님' in e for e in R.validate(work, git, ['README.md'])[1])

# ───── 잠금 ─────
work, remote = make_repo('lock')
lock = Path(g(work, 'rev-parse', '--absolute-git-dir')) / 'run_scoring.lock'
lock.write_text(json.dumps({'pid': os.getpid()}), encoding='utf-8')
rc, out = run_tool(work, ['--dry-run'], ask=no_ask)
assert rc == 2 and '다른 점수 갱신이 실행 중' in out and lock.exists(), out
dead = subprocess.Popen([sys.executable, '-c', 'pass']); dead.wait()
lock.write_text(json.dumps({'pid': dead.pid}), encoding='utf-8')
rc, out = run_tool(work, ['--dry-run', '--limit', '1'], ask=no_ask)
assert rc == 0 and '넘겨받습니다' in out and not lock.exists(), out

# ───── 메모리 경고 ─────
work, remote = make_repo('ram')
R.free_ram_gb = lambda: 3.2
rc, out = run_tool(work, ['--yes'], ask=no_ask)
assert rc == 2 and '3.2GB' in out and '--yes' in out, out
rc, out = run_tool(work, [], ask=lambda q: '')          # Enter 는 '아니오'
assert rc == 2 and '메모리 부족으로 그만뒀습니다' in out, out
qs = []
rc, out = run_tool(work, ['--dry-run', '--limit', '1'], ask=lambda q: qs.append(q) or 'y')
assert rc == 0 and len(qs) == 1, out
R.free_ram_gb = lambda: 16.0
assert g(work, 'status', '--porcelain') == ''

# ───── Ollama 켜고 끄기 ─────


class Down(Fake):
    def __init__(self, up_after):
        super().__init__(); self.n = 0; self.up_after = up_after
    def version(self):
        self.n += 1
        if self.n <= self.up_after:
            raise L.OllamaError('down')
        return '0.40.16'


class Proc:
    terminated = False
    def terminate(self): self.terminated = True
    def wait(self, timeout=None): return 0
    def kill(self): pass


procs = []
launcher = lambda: procs.append(Proc()) or procs[-1]
nosleep = lambda s: None
assert R.ensure_ollama(Fake(), launcher, sleep=nosleep) is None and not procs, '켜져 있으면 켜지 않음'
with contextlib.redirect_stdout(io.StringIO()):
    p = R.ensure_ollama(Down(3), launcher, sleep=nosleep)
assert p is procs[0] and not p.terminated
remote_client = Down(99); remote_client.base = 'http://192.168.0.9:11434'
try:
    R.ensure_ollama(remote_client, launcher, sleep=nosleep); raise AssertionError
except R.Stop as e:
    assert '원격' in str(e) and len(procs) == 1
# 전체 흐름에서: 도구가 켠 경우에만 끈다
work, remote = make_repo('ollama')
procs.clear()
rc, out = run_tool(work, ['--dry-run', '--limit', '1'], ask=no_ask, client=Down(1), launcher=launcher)
assert rc == 0 and len(procs) == 1 and procs[0].terminated and '이 도구가 켠 Ollama 를 껐습니다' in out, out
procs.clear()
rc, out = run_tool(work, ['--dry-run', '--limit', '1'], ask=no_ask, client=Fake(), launcher=launcher)
assert rc == 0 and not procs and '이 도구가 켠' not in out

# ───── 파일 형식(윈도우 호환) ─────
bat = (ROOT / '점수매기기.bat').read_bytes()
assert all(c < 128 for c in bat) and b'\r\n' in bat and bat.count(b'\n') == bat.count(b'\r\n'), 'bat: ASCII·CRLF'
assert b'chcp 65001' in bat and b'Git\\cmd' in bat and b'run_scoring.py %*' in bat
src = (ROOT / 'scripts' / 'local' / 'run_scoring.py').read_bytes()
assert b'\r' not in src and b"'add', '-A'" not in src and b'--force' not in src and b'reset --hard' not in src

def _rm_readonly(func, path, _):
    os.chmod(path, 0o700); func(path)     # 윈도우에서 git 객체 파일은 읽기 전용


shutil.rmtree(TMP, onerror=_rm_readonly)
print('test_run_scoring: ok')
