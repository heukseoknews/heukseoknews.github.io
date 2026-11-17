"""수동 점수 갱신 도구: 최신 받기 → 점수 없는 기사 찾기 → 채점 → 요약 → 확인(Enter) → 점수 파일만 commit·push.

    python scripts/local/run_scoring.py                    # 전체 흐름(커밋 전 Enter 확인)
    python scripts/local/run_scoring.py --dry-run --limit 5  # 채점만 해 보고 아무것도 쓰지 않음(push 없음)
    python scripts/local/run_scoring.py --yes              # 확인 생략(자동 실행용)

옵션: --channels insurance,ai  --since 7(일) 또는 2026-11-01  --limit N(1회 상한 1,500)
채점·저장은 llm_score.py 를 그대로 불러 쓴다. 커밋은 data/<채널>/llm/<YYYY-MM>.json 만, 경로를 지정해서 한다.
토큰·비밀번호는 다루지 않는다. push 인증은 git(윈도우 자격 증명 관리자)이 처리한다. 사용법: docs/llm-scoring.md 4절."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llm_score as L  # noqa: E402

ROOT = L.ROOT
MAX_TARGETS = 1500                 # 1회 상한
SEC_PER_ARTICLE = 3.0              # 예상 시간 계산용(학교 PC 벤치마크 평균 3.05s)
MIN_FREE_RAM_GB = 5.0
MAX_FILE_BYTES = 5_000_000         # 점수 파일 하나의 크기 상한
DEFAULT_SINCE = '7'
CHANNEL_ORDER = ('insurance', 'ai', 'finance')   # 출력·커밋 메시지 순서(나머지는 이름순으로 뒤에)
LLM_FILE = re.compile(r'^data/([^/]+)/llm/(\d{4}-\d{2})\.json$')
LOCAL_HOSTS = ('localhost', '127.0.0.1', '[::1]')


class Stop(Exception):
    """멈추고 상황을 알린다(종료 코드 2)."""


# ───────────────────────── git ─────────────────────────

def find_git() -> str | None:
    """PATH 에 없으면 Git for Windows 의 기본 설치 위치를 찾는다."""
    g = shutil.which('git')
    if g:
        return g
    for base in (os.environ.get('ProgramFiles'), os.environ.get('ProgramW6432'), os.environ.get('ProgramFiles(x86)'),
                 os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs')):
        if base:
            p = Path(base) / 'Git' / 'cmd' / 'git.exe'
            if p.exists():
                return str(p)
    return None


class Git:
    def __init__(self, root: Path, exe: str | None = None):
        self.root = root
        self.exe = exe or find_git()
        if not self.exe:
            raise Stop('git 을 찾을 수 없습니다. Git for Windows 를 설치하거나 PATH 에 git 을 추가하세요.')

    def run(self, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        r = subprocess.run([self.exe, *args], cwd=self.root, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if check and r.returncode != 0:
            raise Stop(f'git {" ".join(args)} 실패:\n{(r.stderr or r.stdout).strip()}')
        return r

    def out(self, *args: str) -> str:
        return self.run(*args).stdout.strip()

    def config(self, key: str) -> str:
        return self.run('config', '--get', key, check=False).stdout.strip()

    def changes(self) -> list[str]:
        """작업 트리·인덱스의 바뀐 경로(추적 안 되는 새 파일 포함, 무시 목록 제외). 저장소 기준 '/' 경로."""
        raw = self.run('status', '--porcelain=v1', '-z', '--untracked-files=all').stdout
        parts = raw.split('\0'); out = []; i = 0
        while i < len(parts):
            e = parts[i]; i += 1
            if len(e) < 4:
                continue
            out.append(e[3:])
            if e[0] in 'RC':           # 이름 바꾸기는 옛 경로가 하나 더 붙는다
                out.append(parts[i]); i += 1
        return sorted(set(out))

    def staged(self) -> list[str]:
        return [p for p in self.run('diff', '--cached', '--name-only', '-z').stdout.split('\0') if p]

    def head_file(self, rel: str) -> bytes | None:
        r = subprocess.run([self.exe, 'show', f'HEAD:{rel}'], cwd=self.root, capture_output=True)
        return r.stdout if r.returncode == 0 else None

    def git_dir(self) -> Path:
        return Path(self.out('rev-parse', '--absolute-git-dir'))

    def ignored(self, rel: str) -> bool:
        return self.run('check-ignore', '-q', rel, check=False).returncode == 0


# ───────────────────────── 잠금·로그 ─────────────────────────

def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == 'win32':
        import ctypes
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = k.GetExitCodeProcess(h, ctypes.byref(code)); k.CloseHandle(h)
        return bool(ok) and code.value == 259          # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class Lock:
    """<git 폴더>/run_scoring.lock(git 이 추적하지 않는 곳). 살아 있는 실행이 있으면 멈추고, 죽은 실행의 잠금은 넘겨받는다."""

    def __init__(self, git_dir: Path):
        self.path = git_dir / 'run_scoring.lock'
        self.held = False

    def __enter__(self):
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                try:
                    pid = int(json.loads(self.path.read_text(encoding='utf-8')).get('pid', 0))
                except (OSError, ValueError, AttributeError):
                    pid = 0
                if pid_alive(pid):
                    raise Stop(f'다른 점수 갱신이 실행 중입니다(pid {pid}). 끝난 뒤 다시 실행하세요.')
                print(f'이전 실행의 잠금이 남아 있어 넘겨받습니다(pid {pid} 종료됨).')
                self.path.unlink(missing_ok=True)
                continue
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump({'pid': os.getpid(), 'started': datetime.now(timezone.utc).isoformat()}, f)
            self.held = True
            return self
        raise Stop(f'잠금 파일을 만들 수 없습니다: {self.path}')

    def __exit__(self, *exc):
        if self.held:
            self.path.unlink(missing_ok=True)
        return False


class Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, s):
        for st in self.streams:
            st.write(s)
        return len(s)

    def flush(self):
        for st in self.streams:
            st.flush()


def open_log(root: Path, git: Git, now: datetime):
    """logs/run_scoring-<시각>.log. git 이 무시하는 경로일 때만 쓴다(.gitignore 의 *.log)."""
    rel = f'logs/run_scoring-{now.strftime("%Y%m%d-%H%M%S")}.log'
    if not git.ignored(rel):
        print(f'경고: {rel} 이 git 무시 목록에 없어 실행 기록을 남기지 않습니다.')
        return None, None
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    return open(p, 'w', encoding='utf-8', newline='\n'), rel


# ───────────────────────── Ollama·메모리 ─────────────────────────

def free_ram_gb() -> float | None:
    """사용 가능한 물리 메모리(GB). 윈도우·리눅스만, 그 밖은 None."""
    try:
        if sys.platform == 'win32':
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong)] + \
                           [(n, ctypes.c_ulonglong) for n in ('total', 'avail', 'tpf', 'apf', 'tv', 'av', 'aev')]
            m = MS(); m.dwLength = ctypes.sizeof(MS)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
                return m.avail / 1024 ** 3
        elif Path('/proc/meminfo').exists():
            for line in Path('/proc/meminfo').read_text().splitlines():
                if line.startswith('MemAvailable:'):
                    return int(line.split()[1]) / 1024 ** 2
    except Exception:
        pass
    return None


def find_ollama() -> str | None:
    o = shutil.which('ollama')
    if o:
        return o
    p = Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'Ollama' / 'ollama.exe'
    return str(p) if p.exists() else None


def launch_ollama(exe: str) -> subprocess.Popen:
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    return subprocess.Popen([exe, 'serve'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)


def ensure_ollama(client, launcher=None, wait: float = 30.0, sleep=time.sleep):
    """켜져 있으면 None. 꺼져 있고 이 컴퓨터 주소면 `ollama serve` 를 켜고 그 프로세스를 돌려준다(끝날 때 이 도구가 끈다)."""
    try:
        client.version(); return None
    except L.OllamaError:
        pass
    host = client.base.split('://', 1)[-1].rsplit(':', 1)[0]
    if host not in LOCAL_HOSTS:
        raise Stop(f'Ollama({client.base})에 연결할 수 없습니다. 원격 주소는 이 도구가 켜지 않습니다.')
    if launcher is None:
        exe = find_ollama()
        if not exe:
            raise Stop('Ollama 를 찾을 수 없습니다. ollama.com 에서 설치하세요.')
        launcher = lambda: launch_ollama(exe)
    print('Ollama 가 꺼져 있어 켭니다(끝나면 이 도구가 끕니다).')
    proc = launcher()
    t0 = time.time()
    while time.time() - t0 < wait:
        try:
            client.version(); return proc
        except L.OllamaError:
            sleep(1)
    stop_ollama(proc)
    raise Stop('Ollama 를 켰지만 응답이 없습니다.')


def stop_ollama(proc) -> None:
    if proc is None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()


# ───────────────────────── 검증 ─────────────────────────

def channel_names(root: Path, channels: list[str]) -> dict[str, str]:
    out = {}
    for ch in channels:
        try:
            out[ch] = json.loads((root / 'channels' / ch / 'channel.json').read_text(encoding='utf-8')).get('name') or ch
        except (OSError, ValueError):
            out[ch] = ch
    return out


def order_channels(chs) -> list[str]:
    chs = list(chs)
    return [c for c in CHANNEL_ORDER if c in chs] + sorted(c for c in chs if c not in CHANNEL_ORDER)


def validate(root: Path, git: Git, paths: list[str]) -> tuple[dict[str, int], list[str]]:
    """바뀐 점수 파일을 HEAD 판과 비교한다. 반환: (채널별 새 기록 수, 문제 목록).
    JSON 구조 {id: [기록…]}, 기록 필드·점수 0~5, 기존 기록은 그대로(추가만), 기사 파일에 있는 id, 크기 상한, LF."""
    added: dict[str, int] = {}
    errs: list[str] = []
    for rel in paths:
        m = LLM_FILE.match(rel)
        if not m:
            errs.append(f'{rel}: 점수 파일 경로가 아님'); continue
        ch, month = m.groups()
        p = root / rel
        if not p.exists():
            errs.append(f'{rel}: 파일이 삭제됨'); continue
        raw = p.read_bytes()
        if len(raw) > MAX_FILE_BYTES:
            errs.append(f'{rel}: 크기 {len(raw):,}바이트가 상한 {MAX_FILE_BYTES:,}을 넘음')
        if b'\r' in raw:
            errs.append(f'{rel}: 줄 끝이 LF 가 아님')
        try:
            new = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, ValueError) as e:
            errs.append(f'{rel}: JSON 아님({e})'); continue
        if not isinstance(new, dict):
            errs.append(f'{rel}: 최상위가 객체가 아님'); continue
        old_raw = git.head_file(rel)
        try:
            old = json.loads(old_raw.decode('utf-8')) if old_raw else {}
        except ValueError:
            old = {}
        art_file = root / 'data' / ch / f'{month}.json'
        try:
            ids = {a['id'] for a in L.read_json(art_file)}
        except (OSError, ValueError, KeyError, TypeError):
            errs.append(f'{rel}: 기사 파일 data/{ch}/{month}.json 을 읽을 수 없음'); continue
        for aid, recs in old.items():
            if new.get(aid, [])[:len(recs)] != recs:
                errs.append(f'{rel}: 기존 기록이 바뀌거나 지워짐(id {aid})')
        n = 0
        for aid, recs in new.items():
            if not isinstance(recs, list) or not recs:
                errs.append(f'{rel}: id {aid} 의 값이 기록 목록이 아님'); continue
            if aid not in ids:
                errs.append(f'{rel}: 기사 파일에 없는 id {aid}')
            for r in recs[len(old.get(aid, [])):]:
                if not L.valid_record(r) or not isinstance(r.get('provisional'), bool) or not isinstance(r.get('scored_at'), str):
                    errs.append(f'{rel}: id {aid} 의 기록 형식·점수 범위(0~5) 오류'); continue
                n += 1
            versions = [(r.get('model'), r.get('prompt_version')) for r in recs if isinstance(r, dict)]
            if len(versions) != len(set(versions)):
                errs.append(f'{rel}: id {aid} 에 같은 모델·프롬프트 기록이 중복')
        added[ch] = added.get(ch, 0) + n
    return added, errs


def commit_message(added: dict[str, int], names: dict[str, str]) -> str:
    total = sum(added.values())
    return f'data(llm): 점수 {total}건 (' + ', '.join(f'{names.get(c, c)} {added.get(c, 0)}' for c in order_channels(names)) + ')'


# ───────────────────────── 커밋·push ─────────────────────────

REJECTED = ('rejected', 'fetch first', 'non-fast-forward', 'failed to push some refs')


def push_with_retry(git: Git) -> None:
    """git push origin HEAD:main. 거절되면 pull --rebase 후 한 번만 재시도. force 는 쓰지 않는다."""
    r = git.run('push', 'origin', 'HEAD:main', check=False)
    if r.returncode == 0:
        print('push 완료.'); return
    msg = (r.stderr or r.stdout).strip()
    if not any(k in msg for k in REJECTED):
        raise Stop(f'push 실패(거절이 아닌 오류라 다시 시도하지 않음):\n{msg}\n커밋은 이 컴퓨터에 남아 있습니다. 원인을 해결한 뒤 `git push origin HEAD:main`.')
    print('push 가 거절되어 최신을 받아(pull --rebase) 한 번만 다시 시도합니다.')
    pr = git.run('pull', '--rebase', 'origin', 'main', check=False)
    if pr.returncode != 0:
        aborted = ''
        gd = git.git_dir()
        if (gd / 'rebase-merge').exists() or (gd / 'rebase-apply').exists():
            git.run('rebase', '--abort', check=False); aborted = '\nrebase 를 취소해 받기 전 상태로 되돌렸습니다(커밋은 남아 있음).'
        raise Stop(f'pull --rebase 실패:\n{(pr.stderr or pr.stdout).strip()}{aborted}\n직접 확인한 뒤 다시 실행하세요.')
    r = git.run('push', 'origin', 'HEAD:main', check=False)
    if r.returncode != 0:
        raise Stop(f'다시 시도한 push 도 실패:\n{(r.stderr or r.stdout).strip()}\n커밋은 이 컴퓨터에 남아 있습니다.')
    print('push 완료(다시 시도).')


# ───────────────────────── 흐름 ─────────────────────────

def parse_args(argv):
    ap = argparse.ArgumentParser(description='수동 점수 갱신(docs/llm-scoring.md 4절)')
    ap.add_argument('--dry-run', action='store_true', help='채점만 해 보고 쓰지 않음, commit·push 없음')
    ap.add_argument('--yes', action='store_true', help='확인 생략(자동 실행용). 메모리가 모자라면 멈춘다')
    ap.add_argument('--channels', default='', help='쉼표 구분(기본: 모든 채널)')
    ap.add_argument('--since', default=DEFAULT_SINCE, help='며칠 전(숫자) 또는 날짜(YYYY-MM-DD) 이후 수집. 기본 7')
    ap.add_argument('--limit', type=int, default=MAX_TARGETS, help=f'최대 건수(1~{MAX_TARGETS})')
    a = ap.parse_args(argv)
    if not 1 <= a.limit <= MAX_TARGETS:
        ap.error(f'--limit 은 1~{MAX_TARGETS}')
    return a


def pick_newest(targets: list, channels: list[str], limit: int) -> list:
    """상한에 걸리면 채널과 상관없이 수집 시각이 가장 최신인 limit 건을 고른다.
    고른 뒤에는 llm_score 의 처리 순서(같은 채널끼리 묶고 채널 안에서 수집 시각 순)로 되돌린다."""
    t_of = lambda t: L.article_time(t[2]) or datetime.min.replace(tzinfo=timezone.utc)
    chosen = sorted(targets, key=lambda t: (t_of(t), t[2]['id']), reverse=True)[:limit]
    return sorted(chosen, key=lambda t: (channels.index(t[0]), t_of(t), t[2]['id']))


def confirm(ask, question: str, default_yes: bool) -> bool:
    """default_yes 면 Enter 만 눌러도 예. 입력을 받을 수 없으면(EOF) 아니오."""
    try:
        a = ask(question).strip().lower()
    except EOFError:
        return False
    return a in ('y', 'yes', '네', 'ㅇ') or (default_yes and a == '')


def run(args, root: Path, git: Git, client, ask, launcher=None) -> int:
    prompts = L.load_prompts()
    channels = order_channels([c for c in args.channels.split(',') if c] if args.channels else prompts)
    bad = [c for c in channels if c not in prompts]
    if bad:
        raise Stop(f'프롬프트 설정이 없는 채널: {bad}')
    names = channel_names(root, order_channels(prompts))

    # 1. 저장소 상태·최신 받기
    branch = git.out('rev-parse', '--abbrev-ref', 'HEAD')
    if branch != 'main':
        raise Stop(f'main 브랜치가 아닙니다({branch}). `git switch main` 뒤 다시 실행하세요.')
    if git.staged():
        raise Stop('이미 스테이징된 변경이 있습니다(함께 커밋될 수 있어 멈춤):\n  ' + '\n  '.join(git.staged()))
    if not args.dry_run and not (git.config('user.name') and git.config('user.email')):
        raise Stop('커밋 작성자(user.name·user.email)가 설정되어 있지 않습니다. 이메일은 추측하지 않습니다.\n'
                   '  git config user.name "Seungu Sin"\n'
                   '  git config user.email "<번호>+<GitHub 아이디>@users.noreply.github.com"   # GitHub 설정 > Emails 의 noreply 주소')
    print('최신 받기(git pull --ff-only)…')
    pr = git.run('pull', '--ff-only', 'origin', 'main', check=False)
    if pr.returncode != 0:
        raise Stop(f'최신 받기 실패(빨리 감기 불가 또는 충돌 위험):\n{(pr.stderr or pr.stdout).strip()}')
    before = git.changes()
    others = [p for p in before if not LLM_FILE.match(p)]
    leftover = [p for p in before if LLM_FILE.match(p)]
    if others:
        print('알림: 점수 파일이 아닌 변경이 있습니다. 건드리지 않고 커밋에서 뺍니다:\n  ' + '\n  '.join(others))
    if leftover:
        print('알림: 이전 실행에서 커밋되지 않은 점수 파일이 있습니다. 함께 검증해 커밋합니다:\n  ' + '\n  '.join(leftover))

    # 2. 대상
    now = datetime.now(timezone.utc)
    targets = L.select_targets(root, prompts, channels, L.parse_since(args.since, now))
    total_found = len(targets)
    found = {ch: sum(1 for t in targets if t[0] == ch) for ch in channels}
    targets = pick_newest(targets, channels, args.limit)
    print(f'\n대상: 최근 {args.since}{"일" if args.since.isdigit() else " 이후"} 수집 · 숨김 아님 · 현재 프롬프트 점수 없음')
    for ch in channels:
        n = sum(1 for t in targets if t[0] == ch)
        more = f' (찾은 {found[ch]}건)' if found[ch] > n else ''
        print(f'  {names.get(ch, ch)}: {n}건{more}  [{prompts[ch]["prompt_version"]}{", 임시" if prompts[ch].get("provisional") else ""}]')
    cut = f' (찾은 {total_found}건 중 상한 {args.limit}건)' if total_found > len(targets) else ''
    print(f'  합계 {len(targets)}건{cut}, 예상 {L.fmt_dur(len(targets) * SEC_PER_ARTICLE)} (기사당 약 {SEC_PER_ARTICLE:.0f}초)')
    if not targets and not leftover:
        print('\n새로 채점할 기사가 없습니다.'); return 0

    # 3. 채점
    proc = None
    result = None
    if targets:
        proc = ensure_ollama(client, launcher)
        try:
            L.preflight(client, L.MODEL)
            ram = free_ram_gb()
            if ram is not None and ram < MIN_FREE_RAM_GB:
                print(f'경고: 사용 가능한 메모리 {ram:.1f}GB 가 {MIN_FREE_RAM_GB:.0f}GB 미만입니다(모델 약 5GB). 큰 프로그램을 닫길 권합니다.')
                if args.yes:
                    raise Stop('--yes 실행이라 메모리가 모자란 상태로는 진행하지 않습니다.')
                if not confirm(ask, '그래도 계속할까요? [y/N] ', default_yes=False):
                    raise Stop('메모리 부족으로 그만뒀습니다.')
            print(f'\n채점 시작({"드라이런, 쓰지 않음" if args.dry_run else "20건마다 저장"})…')
            t0 = time.time()
            try:
                result = L.run_scoring(root, client, prompts, targets, L.MODEL, apply=not args.dry_run)
            except KeyboardInterrupt:
                print('\n중단: 저장된 데까지 남았습니다. 다시 실행하면 검증 후 이어서 합니다.')
                return 130
            finally:
                client.unload(L.MODEL)
            L.report(result)
            print(f'걸린 시간 {L.fmt_dur(time.time() - t0)}')
        finally:
            stop_ollama(proc)
            if proc is not None:
                print('이 도구가 켠 Ollama 를 껐습니다.')
    if args.dry_run:
        print('\n드라이런: 아무것도 쓰지 않았고 commit·push 하지 않았습니다.')
        return 0

    # 4. 검증
    after = git.changes()
    new_other = [p for p in after if not LLM_FILE.match(p) and p not in others]
    if new_other:
        raise Stop('채점 중 점수 파일이 아닌 파일이 바뀌었습니다(커밋하지 않음):\n  ' + '\n  '.join(new_other))
    paths = [p for p in after if LLM_FILE.match(p)]
    if not paths:
        print('\n바뀐 점수 파일이 없습니다(모두 실패했거나 이미 있음).')
        return 1 if result and (result['counts']['format'] + result['counts']['error']) else 0
    added, errs = validate(root, git, paths)
    if errs:
        raise Stop('검증 실패(커밋하지 않음):\n  ' + '\n  '.join(errs[:30]))
    msg = commit_message(added, names)
    print('\n검증 통과: JSON 구조·점수 0~5·추가만·기사 id·크기·LF')
    for p in paths:
        print(f'  {p}  ({(root / p).stat().st_size:,}바이트)')
    print(f'커밋 메시지: {msg}')

    # 5. 확인 → 커밋·push
    if not args.yes and not confirm(ask, '\nEnter 를 누르면 커밋·push 합니다(그만두려면 n): ', default_yes=True):
        print('그만뒀습니다. 점수 파일은 커밋하지 않은 채 남아 있고, 다음 실행 때 함께 검증·커밋합니다.')
        return 0
    git.run('add', '--', *paths)
    staged = sorted(git.staged())
    if staged != sorted(paths):
        git.run('reset', '-q', '--', *staged, check=False)
        raise Stop(f'스테이징 범위가 예상과 다릅니다(되돌림): {staged}')
    git.run('commit', '-q', '-m', msg, '--', *paths)
    print(f'커밋: {git.out("rev-parse", "--short", "HEAD")} {msg}')
    push_with_retry(git)
    return 0


def main(argv=None, root: Path = ROOT, client=None, git: Git | None = None, ask=input, launcher=None) -> int:
    L.setup_console()
    args = parse_args(argv)
    orig = sys.stdout
    logf = None
    try:
        git = git or Git(root)
        logf, rel = open_log(root, git, datetime.now())
        if logf:
            sys.stdout = Tee(orig, logf)
            print(f'실행 기록: {rel}')
        with Lock(git.git_dir()):
            return run(args, root, git, client or L.Ollama(), ask, launcher)
    except Stop as e:
        print(f'\n멈춤: {e}')
        return 2
    except SystemExit as e:              # llm_score.preflight 의 안내(Ollama 연결·모델 없음)
        if isinstance(e.code, str):
            print(f'\n멈춤: {e.code}'); return 2
        raise
    finally:
        sys.stdout = orig
        if logf:
            logf.close()


if __name__ == '__main__':
    sys.exit(main())
