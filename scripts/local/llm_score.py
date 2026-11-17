"""로컬 LLM(Ollama)으로 기사 제목의 '취업·연구 중요도'를 0~5 로 매긴다(1단계: 점수 파일만, 화면·순위는 쓰지 않음).

    python scripts/local/llm_score.py                     # 드라이런(기본): 대상 건수·예상 시간·샘플 10건 점수, 아무것도 쓰지 않음
    python scripts/local/llm_score.py --apply             # data/<채널>/llm/<YYYY-MM>.json 에 쓴다
    python scripts/local/llm_score.py --benchmark 10      # N건 실제 채점, 시간·앞부분 재사용만 보고(저장 없음)
    python scripts/local/llm_score.py --merge <파일> ...  # 다른 컴퓨터 결과 합치기(드라이런, --apply 일 때만 씀)

옵션: --channel insurance,ai  --since 3(일) 또는 2026-11-01  --limit N  --sample 10
설계와 실험 근거: docs/llm-scoring.md. 기사 파일(data/<채널>/YYYY-MM.json)은 읽기만 한다.
표준 라이브러리만 쓰고 Mac·윈도우·리눅스에서 같은 방식으로 동작한다(경로는 pathlib, 파일은 UTF-8·LF)."""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROMPTS = Path(__file__).resolve().parent / 'prompts'
MODEL = 'exaone3.5:7.8b'
DEFAULT_SEC = 3.0            # 벤치마크 전 예상 시간 계산용 기사당 초(이 Mac 실험 평균 3.3s)
SAVE_EVERY = 20              # --apply 중간 저장 간격(끊겨도 이만큼만 다시 하면 됨)
OPTIONS = {'temperature': 0, 'seed': 42, 'num_predict': 160, 'num_ctx': 4096}
SCHEMA = {'type': 'object', 'properties': {'score': {'type': 'integer', 'enum': [0, 1, 2, 3, 4, 5]}}, 'required': ['score']}
MONTH_FILE = '????-??.json'


# ───────────────────────── 출력·환경 ─────────────────────────

def setup_console() -> None:
    """윈도우 콘솔(cp949 등)에서도 한글이 깨지지 않게 표준 출력을 UTF-8 로."""
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass


def ollama_base(env: str | None = None) -> str:
    """OLLAMA_HOST(예: 127.0.0.1:11434, http://host:11435, 0.0.0.0) → http://host:port. 기본 http://localhost:11434"""
    v = (env if env is not None else os.environ.get('OLLAMA_HOST', '')).strip().rstrip('/')
    if not v:
        return 'http://localhost:11434'
    if '://' not in v:
        v = 'http://' + v
    scheme, rest = v.split('://', 1)
    host = rest.split('/', 1)[0]
    if host.startswith('['):                       # IPv6 [::1]:port
        name, _, port = host.partition(']')
        name += ']'; port = port.lstrip(':')
    else:
        name, _, port = host.rpartition(':') if host.count(':') == 1 else (host, '', '')
    if name in ('0.0.0.0', ''):                    # 서버 바인드 주소는 클라이언트에서 localhost 로
        name = 'localhost'
    return f'{scheme}://{name}:{port or 11434}'


def memory_warning() -> str | None:
    """Mac 에서만 메모리 압력 확인(sysctl). 다른 운영체제·실패 시 조용히 None."""
    if sys.platform != 'darwin':
        return None
    try:
        lvl = int(subprocess.run(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], capture_output=True, text=True, timeout=5).stdout.strip())
    except Exception:
        return None
    if lvl >= 2:
        return f'메모리 압력이 높습니다(level {lvl}: 2=경고, 4=심각). 다른 앱을 닫고 실행하길 권합니다.'
    return None


class OllamaError(Exception):
    pass


class Ollama:
    """OLLAMA_HOST 한 곳과만 통신한다."""

    def __init__(self, base: str | None = None, timeout: int = 300):
        self.base = base or ollama_base(); self.timeout = timeout

    def _req(self, path: str, body: dict | None = None, timeout: int | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode('utf-8')
        req = urllib.request.Request(self.base + path, data=data, headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            raise OllamaError(f'HTTP {e.code} {path}: {e.read()[:200].decode("utf-8", "replace")}') from e
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            raise OllamaError(f'{self.base} 연결 실패: {e}') from e

    def version(self) -> str:
        return self._req('/api/version', timeout=5).get('version', '')

    def model_digest(self, model: str) -> str | None:
        for m in self._req('/api/tags', timeout=10).get('models', []):
            if m.get('name') == model or m.get('model') == model:
                return m.get('digest')
        return None

    def loaded(self) -> list[str]:
        try:
            return [m.get('name', '') for m in self._req('/api/ps', timeout=5).get('models', [])]
        except OllamaError:
            return []

    def chat(self, body: dict) -> dict:
        return self._req('/api/chat', body)

    def unload(self, model: str) -> None:
        """CLI 명령 대신 API(keep_alive 0)로 메모리에서 내린다(운영체제 무관)."""
        try:
            self._req('/api/generate', {'model': model, 'keep_alive': 0}, timeout=30)
        except OllamaError:
            pass


# ───────────────────────── 프롬프트·응답 ─────────────────────────

def load_prompts(prompts_dir: Path = PROMPTS) -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text(encoding='utf-8')) for p in sorted(prompts_dir.glob('*.json'))}


def system_prompt(cfg: dict) -> str:
    """고정 부분(지시·목적·척도·예시). 실험 e2(run5.py system_prompt)와 같은 문자열. 채널마다 같아서 앞부분 재사용이 된다."""
    s = (f'너는 뉴스 큐레이터다. 기사 제목과 매체만 보고, 아래 독자에게 이 기사가 얼마나 중요한지 0~5 정수로 매긴다.\n'
         f'독자: {cfg["purpose"]}\n점수: {cfg["scale"]}\n'
         f'출력은 JSON 한 개만: {{"score": 정수}}\n')
    if cfg.get('examples'):
        s += '\n예시(사람이 매긴 점수):\n' + '\n'.join(f'- 제목: {e["title"]} | 매체: {e["source"]} → {e["score"]}' for e in cfg['examples']) + '\n'
    return s


def chat_body(cfg: dict, art: dict, model: str = MODEL) -> dict:
    """기사 제목·매체는 맨 뒤(user 메시지)에만 둔다."""
    return {'model': model, 'stream': False, 'keep_alive': '15m', 'format': SCHEMA,
            'messages': [{'role': 'system', 'content': system_prompt(cfg)},
                         {'role': 'user', 'content': f'제목: {art["title"]}\n매체: {art.get("source", "")}'}],
            'options': dict(OPTIONS), 'logprobs': True, 'top_logprobs': 10}


def parse_response(d: dict) -> tuple[int | None, float | None, dict | None]:
    """(score_int, score_ev, probs). score_int 는 모델이 고른 정수(온도 0 이라 가장 확률 높은 값).
    score_ev 는 run5.py 와 같다: 출력에서 처음 나오는 숫자 토큰 자리의 후보 중 한 자리 0~5 만 모아 확률을 정규화한 기대값."""
    score = None
    try:
        v = json.loads(d.get('message', {}).get('content', '')).get('score')
        if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 5:
            score = v
    except (ValueError, AttributeError, TypeError):
        pass
    ev = probs = None
    for t in d.get('logprobs') or []:
        if str(t.get('token', '')).strip().isdigit():
            p: dict[int, float] = {}
            for c in t.get('top_logprobs') or []:
                k = str(c.get('token', '')).strip()
                if len(k) == 1 and k in '012345' and isinstance(c.get('logprob'), (int, float)):
                    p[int(k)] = p.get(int(k), 0.0) + math.exp(c['logprob'])
            z = sum(p.values())
            if z > 0:
                probs = {k: v / z for k, v in sorted(p.items())}
                ev = sum(k * v for k, v in probs.items())
            break
    return score, ev, probs


def score_one(client, cfg: dict, art: dict, model: str = MODEL) -> tuple[int | None, float | None, str, list[dict]]:
    """한 기사 채점. 상태: ok / no_ev(기대값 없음, 한 번 재시도 후) / format(형식 오류, 건너뜀) / error(통신 오류).
    반환: (score_int, score_ev, 상태, Ollama 응답 메타 목록)"""
    metas: list[dict] = []
    score = None
    for attempt in range(2):                     # 통신 오류·기대값 없음만 한 번 재시도
        try:
            d = client.chat(chat_body(cfg, art, model))
        except OllamaError as e:
            metas.append({'error': str(e)})
            continue
        metas.append({k: d.get(k) for k in ('total_duration', 'load_duration', 'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration')})
        s, e, _ = parse_response(d)
        if s is None:                            # 형식이 아예 틀림: 재시도하지 않고 건너뜀(앞 시도에서 정수를 얻었으면 그것을 씀)
            break
        score = s
        if e is not None:
            return s, e, 'ok', metas
    if score is not None:
        return score, None, 'no_ev', metas
    return None, None, ('error' if metas and all('error' in m for m in metas) else 'format'), metas


# ───────────────────────── 데이터 ─────────────────────────

def read_json(p: Path):
    return json.loads(p.read_text(encoding='utf-8'))


def write_json_atomic(p: Path, obj) -> None:
    """같은 폴더 임시 파일(UTF-8·LF)에 쓴 뒤 os.replace 로 교체. 중간에 끊겨도 기존 파일은 온전하다."""
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + p.name + '.', suffix='.tmp', dir=p.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + '\n')
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def llm_path(root: Path, ch: str, month: str) -> Path:
    return root / 'data' / ch / 'llm' / f'{month}.json'


def load_llm(p: Path) -> dict[str, list[dict]]:
    return read_json(p) if p.exists() else {}


def has_version(recs: list[dict], model: str, pv: str) -> bool:
    return any(r.get('model') == model and r.get('prompt_version') == pv for r in recs)


def parse_since(v: str, now: datetime) -> datetime:
    if v.isdigit():
        return now - timedelta(days=int(v))
    d = datetime.fromisoformat(v)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def article_time(a: dict) -> datetime | None:
    for k in ('collected_at', 'published_at'):
        try:
            d = datetime.fromisoformat(str(a[k]).replace('Z', '+00:00'))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
    return None


def select_targets(root: Path, prompts: dict[str, dict], channels: list[str], since: datetime, model: str = MODEL,
                   skip_scored: bool = True) -> list[tuple[str, str, dict]]:
    """(채널, 월, 기사). 관련 있음(relevant 가 false 아님 = 숨김 아님) · 수집 시각이 since 이후 · 이 (model, prompt_version) 점수가 없는 기사.
    같은 채널끼리 묶고 채널 안에서는 수집 시각 순(앞부분 재사용)."""
    out = []
    for ch in channels:
        cfg = prompts[ch]; d = root / 'data' / ch
        for p in sorted(d.glob(MONTH_FILE)):
            done = load_llm(llm_path(root, ch, p.stem))
            for a in read_json(p):
                if a.get('relevant') is False:
                    continue
                t = article_time(a)
                if t is None or t < since:
                    continue
                if skip_scored and has_version(done.get(a['id'], []), model, cfg['prompt_version']):
                    continue
                out.append((ch, p.stem, a))
    out.sort(key=lambda x: (channels.index(x[0]), str(x[2].get('collected_at', '')), x[2]['id']))
    return out


def make_record(score: int, ev: float | None, cfg: dict, model: str, digest: str | None, ver: str, now: datetime) -> dict:
    r = {'score_int': score, 'model': model, 'model_digest': digest, 'ollama_version': ver,
         'prompt_version': cfg['prompt_version'], 'scored_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'provisional': bool(cfg.get('provisional'))}
    if ev is not None:
        r['score_ev'] = round(ev, 3)
    return r


def add_record(store: dict[str, list[dict]], aid: str, rec: dict) -> bool:
    """같은 (id, model, prompt_version)이 있으면 그대로 두고 False. 버전이 다르면 덧붙인다(덮어쓰지 않음)."""
    recs = store.setdefault(aid, [])
    if has_version(recs, rec['model'], rec['prompt_version']):
        return False
    recs.append(rec)
    return True


def valid_record(r) -> bool:
    if not isinstance(r, dict) or not isinstance(r.get('model'), str) or not isinstance(r.get('prompt_version'), str):
        return False
    si = r.get('score_int')
    if not isinstance(si, int) or isinstance(si, bool) or not 0 <= si <= 5:
        return False
    ev = r.get('score_ev')
    return ev is None or (isinstance(ev, (int, float)) and not isinstance(ev, bool) and 0 <= ev <= 5)


# ───────────────────────── 실행 모드 ─────────────────────────

def fmt_dur(sec: float) -> str:
    sec = int(round(sec))
    return f'{sec // 3600}시간 {sec % 3600 // 60}분' if sec >= 3600 else f'{sec // 60}분 {sec % 60}초'


def distribution(evs: list[float]) -> str:
    if not evs:
        return '없음'
    bins = {k: 0 for k in range(6)}
    for v in evs:
        bins[min(5, max(0, int(round(v))))] += 1
    return ' '.join(f'{k}:{n}' for k, n in bins.items()) + f' (평균 {statistics.fmean(evs):.2f})'


def preflight(client: Ollama, model: str) -> tuple[str, str | None]:
    try:
        ver = client.version()
    except OllamaError as e:
        sys.exit(f'Ollama 에 연결할 수 없습니다({e}).\n  Ollama 앱을 켜거나 `ollama serve` 를 실행하세요. 다른 주소는 환경변수 OLLAMA_HOST 로 지정합니다.')
    digest = client.model_digest(model)
    if not digest:
        sys.exit(f'모델 {model} 이(가) 없습니다. `ollama pull {model}` 로 받은 뒤 다시 실행하세요.')
    w = memory_warning()
    if w:
        print('경고:', w)
    others = [m for m in client.loaded() if m and m != model]
    if others:
        print(f'경고: 다른 모델이 메모리에 올라와 있습니다({", ".join(others)}). 메모리가 작으면 먼저 내리세요(한 번에 모델 하나).')
    return ver, digest


def run_scoring(root: Path, client, prompts: dict, targets: list, model: str, apply: bool, log=print) -> dict:
    """targets 를 차례로 채점. apply 면 월 파일에 SAVE_EVERY 건마다 원자적으로 저장. 요약 dict 반환."""
    ver, digest = client.version(), client.model_digest(model)
    stores: dict[tuple[str, str], dict] = {}
    dirty: set = set()
    counts = {'ok': 0, 'no_ev': 0, 'format': 0, 'error': 0, 'added': 0}
    failed: list[tuple[str, str, str]] = []
    results: list[tuple[str, dict, int, float | None]] = []
    t0 = time.time(); secs: list[float] = []

    def flush():
        for key in list(dirty):
            write_json_atomic(llm_path(root, *key), stores[key])
        dirty.clear()

    try:
        for n, (ch, month, art) in enumerate(targets, 1):
            cfg = prompts[ch]; t1 = time.time()
            score, ev, status, _ = score_one(client, cfg, art, model)
            secs.append(time.time() - t1)
            counts[status] += 1
            if status in ('format', 'error'):
                failed.append((ch, art['id'], status))
            else:
                results.append((ch, art, score, ev))
                if apply:
                    key = (ch, month)
                    if key not in stores:
                        stores[key] = load_llm(llm_path(root, ch, month))
                    if add_record(stores[key], art['id'], make_record(score, ev, cfg, model, digest, ver, datetime.now(timezone.utc))):
                        counts['added'] += 1; dirty.add(key)
                    if counts['added'] % SAVE_EVERY == 0:
                        flush()
            if n == 1 or n % 10 == 0 or n == len(targets):
                avg = statistics.fmean(secs[1:]) if len(secs) > 1 else secs[0]
                log(f'  {n}/{len(targets)}  경과 {fmt_dur(time.time() - t0)}  남은 시간 약 {fmt_dur(avg * (len(targets) - n))}')
    finally:
        if apply:
            flush()
    return {'counts': counts, 'failed': failed, 'results': results, 'secs': secs}


def cmd_score(args, root: Path, client: Ollama, prompts: dict) -> int:
    now = datetime.now(timezone.utc)
    targets = select_targets(root, prompts, args.channels, parse_since(args.since, now), args.model)
    if args.limit:
        targets = targets[:args.limit]
    by_ch = {ch: sum(1 for t in targets if t[0] == ch) for ch in args.channels}
    print(f'대상(관련 있음 · {args.since}{"일" if args.since.isdigit() else ""} 이후 수집 · {args.model} 점수 없음):')
    for ch in args.channels:
        print(f'  {ch:<10} {by_ch[ch]:>5}건  prompt {prompts[ch]["prompt_version"]}{" (임시)" if prompts[ch].get("provisional") else ""}  '
              f'예상 {fmt_dur(by_ch[ch] * args.sec_per_article)}')
    print(f'  합계 {len(targets)}건, 예상 {fmt_dur(len(targets) * args.sec_per_article)} (기사당 {args.sec_per_article}s 가정, --benchmark 로 이 컴퓨터 값을 잴 수 있음)')
    if not targets:
        return 0
    if not args.apply and min(args.sample, len(targets)) == 0:
        print('드라이런: --sample 0, 모델 호출 없이 끝. 아무것도 쓰지 않았습니다.')
        return 0
    ver, _ = preflight(client, args.model)
    if not args.apply:
        k = min(args.sample, len(targets))
        step = len(targets) / k   # 채널·기간에 고르게 퍼진 샘플(같은 채널끼리는 붙어 있음)
        sample = sorted({int(i * step) for i in range(k)})
        print(f'\n드라이런: 샘플 {len(sample)}건만 실제로 채점합니다(쓰지 않음).')
        try:
            r = run_scoring(root, client, prompts, [targets[i] for i in sample], args.model, apply=False)
        finally:
            client.unload(args.model)
        report(r)
        print('\n드라이런이라 아무것도 쓰지 않았습니다. 쓰려면 --apply.')
        return 0
    print(f'\n--apply: {len(targets)}건 채점 후 data/<채널>/llm/<YYYY-MM>.json 에 저장(Ollama {ver}).')
    try:
        r = run_scoring(root, client, prompts, targets, args.model, apply=True)
    except KeyboardInterrupt:
        print('\n중단: 저장된 데까지 남았습니다. 같은 명령으로 다시 실행하면 이어서 합니다.')
        client.unload(args.model)
        return 130
    client.unload(args.model)
    report(r)
    print(f'저장: 새 점수 {r["counts"]["added"]}건. 기사 파일은 바꾸지 않았습니다.')
    return 1 if r['counts']['format'] + r['counts']['error'] else 0


def report(r: dict) -> None:
    c = r['counts']
    evs = [ev for _, _, _, ev in r['results'] if ev is not None]
    print(f'\n결과: 성공 {c["ok"]} · 기대값 없음(정수만) {c["no_ev"]} · 형식 오류(건너뜀) {c["format"]} · 통신 오류(건너뜀) {c["error"]}')
    print(f'score_ev 분포(반올림 단계별 건수): {distribution(evs)}')
    for ch, art, s, ev in r['results'][:10]:
        print(f'  [{ch}] {"—" if ev is None else f"{ev:.2f}"} ({s})  {art["title"][:60]}  · {art.get("source", "")}')
    for ch, aid, st in r['failed'][:20]:
        print(f'  실패 [{ch}] {aid}: {st}')
    if len(r['secs']) > 1:
        print(f'기사당 시간: 평균 {statistics.fmean(r["secs"][1:]):.1f}s (첫 건 {r["secs"][0]:.1f}s 제외)')


def cmd_benchmark(args, root: Path, client: Ollama, prompts: dict) -> int:
    """N건 실제 채점, 저장 없음. 첫 건(모델 로딩) 따로. 대조군: 채널 프롬프트를 번갈아 바꿔 앞부분 재사용을 끊은 4건."""
    now = datetime.now(timezone.utc)
    # 저장하지 않으므로 이미 점수가 있는 기사도 쓴다. 기간 안 기사가 모자라면 기간을 무시하고 최근 기사로 채운다.
    targets = select_targets(root, prompts, args.channels, parse_since(args.since, now), args.model, skip_scored=False)
    if len(targets) < args.benchmark:
        targets = select_targets(root, prompts, args.channels, datetime(2000, 1, 1, tzinfo=timezone.utc), args.model, skip_scored=False)
    ch0 = max(args.channels, key=lambda c: sum(1 for t in targets if t[0] == c)) if targets else None   # 기사가 가장 많은 채널
    grouped = [t for t in targets if t[0] == ch0][-args.benchmark:]
    if not grouped:
        print('벤치마크할 기사가 없습니다.'); return 1
    ver, _ = preflight(client, args.model)
    client.unload(args.model)   # 첫 건이 모델 로딩을 포함하도록
    print(f'벤치마크: {ch0} {len(grouped)}건(같은 채널 연속), Ollama {ver}, 저장 없음')
    rows = []
    for ch, _, art in grouped:
        t1 = time.time(); s, ev, st, metas = score_one(client, prompts[ch], art, args.model)
        rows.append((time.time() - t1, metas[-1], st))
    other = next((c for c in prompts if c != ch0), None)
    ctrl = []
    if other:   # 대조군: 같은 기사들을 두 채널 프롬프트로 번갈아(고정 부분이 매번 바뀜)
        for i, (ch, _, art) in enumerate(grouped[:4]):
            cfg = prompts[other] if i % 2 == 0 else prompts[ch0]
            t1 = time.time(); s, ev, st, metas = score_one(client, cfg, art, args.model)
            ctrl.append((time.time() - t1, metas[-1], st))
    client.unload(args.model)
    ms = lambda ns: None if ns is None else ns / 1e6
    med = lambda xs: (lambda v: '—' if not v else f'{statistics.median(v):.0f}')([x for x in xs if x is not None])
    print('\n| # | 시간 | 모델 로딩 | 프롬프트 토큰(처리) | 프롬프트 처리 ms | 상태 |\n|---|---|---|---|---|---|')
    for i, (sec, m, st) in enumerate(rows, 1):
        print(f'| {i}{" (첫 건)" if i == 1 else ""} | {sec:.2f}s | {med([ms(m.get("load_duration"))])}ms | {m.get("prompt_eval_count")} | {med([ms(m.get("prompt_eval_duration"))])} | {st} |')
    warm = [r[0] for r in rows[1:]]
    pe_g = [ms(r[1].get('prompt_eval_duration')) for r in rows[1:]]
    if warm:
        per = statistics.fmean(warm)
        print(f'\n첫 건(로딩 포함) {rows[0][0]:.1f}s · 이후 평균 {per:.2f}s · 중앙값 {statistics.median(warm):.2f}s')
        print(f'이 컴퓨터에서 하루 600건 예상: {fmt_dur(rows[0][0] + per * 599)} (로딩 1회 + 599×평균)')
    if ctrl and pe_g:
        pe_c = [ms(r[1].get('prompt_eval_duration')) for r in ctrl]
        tok_g = [r[1].get('prompt_eval_count') for r in rows[1:]]; tok_c = [r[1].get('prompt_eval_count') for r in ctrl]
        print(f'\n앞부분 재사용 확인(같은 채널 연속 vs 채널 프롬프트 번갈아 {len(ctrl)}건):')
        print(f'  프롬프트 처리 시간 중앙값: 연속 {med(pe_g)}ms · 번갈아 {med(pe_c)}ms')
        print(f'  처리한 프롬프트 토큰 중앙값: 연속 {med(tok_g)} · 번갈아 {med(tok_c)}')
        print(f'  기사당 전체 시간 중앙값: 연속 {statistics.median(warm):.2f}s · 번갈아 {statistics.median([r[0] for r in ctrl]):.2f}s')
    return 0


def merge(root: Path, paths: list[Path], apply: bool) -> dict:
    """다른 컴퓨터의 결과 파일({id: [기록…]})을 합친다. 기사 id 로 채널·월을 찾아 넣고,
    같은 (id, model, prompt_version)은 기존 값 유지, 새 것만 더한다. 모르는 id·잘못된 기록은 건너뛴다."""
    where: dict[str, tuple[str, str]] = {}
    for d in sorted((root / 'data').iterdir()):
        if d.is_dir():
            for p in sorted(d.glob(MONTH_FILE)):
                for a in read_json(p):
                    where.setdefault(a['id'], (d.name, p.stem))
    s = {'added': 0, 'kept_existing': 0, 'unknown_id': 0, 'invalid': 0, 'files': 0}
    stores: dict[tuple[str, str], dict] = {}
    changed: set = set()
    for path in paths:
        data = read_json(path)
        if not isinstance(data, dict):
            s['invalid'] += 1; continue
        s['files'] += 1
        for aid, recs in sorted(data.items()):
            if aid not in where:
                s['unknown_id'] += len(recs) if isinstance(recs, list) else 1; continue
            key = where[aid]
            if key not in stores:
                stores[key] = load_llm(llm_path(root, *key))
            for r in recs if isinstance(recs, list) else [recs]:
                if not valid_record(r):
                    s['invalid'] += 1
                elif add_record(stores[key], aid, r):
                    s['added'] += 1; changed.add(key)
                else:
                    s['kept_existing'] += 1
    if apply:
        for key in sorted(changed):
            write_json_atomic(llm_path(root, *key), stores[key])
    s['changed_files'] = [f'data/{c}/llm/{m}.json' for c, m in sorted(changed)]
    return s


def main(argv: list[str] | None = None, root: Path = ROOT, client=None) -> int:
    setup_console()
    ap = argparse.ArgumentParser(description='로컬 LLM 중요도 점수(docs/llm-scoring.md)')
    ap.add_argument('--apply', action='store_true', help='파일을 쓴다(없으면 드라이런)')
    ap.add_argument('--benchmark', type=int, nargs='?', const=10, help='N건(기본 10) 시간만 잰다, 저장 없음')
    ap.add_argument('--merge', nargs='+', type=Path, help='다른 컴퓨터에서 만든 data/<채널>/llm/*.json')
    ap.add_argument('--channel', default='', help='쉼표 구분(기본: prompts/ 의 모든 채널)')
    ap.add_argument('--since', default='3', help='며칠 전(숫자) 또는 날짜(YYYY-MM-DD) 이후 수집된 기사. 기본 3')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--sample', type=int, default=10, help='드라이런에서 실제로 채점해 보여 줄 건수(0 이면 모델 호출 없음)')
    ap.add_argument('--sec-per-article', type=float, default=DEFAULT_SEC, help='예상 시간 계산용 기사당 초')
    ap.add_argument('--model', default=MODEL)
    args = ap.parse_args(argv)
    prompts = load_prompts()
    args.channels = [c for c in (args.channel.split(',') if args.channel else prompts) if c]
    bad = [c for c in args.channels if c not in prompts]
    if bad:
        ap.error(f'프롬프트 설정이 없는 채널: {bad} (scripts/local/prompts/<채널>.json)')
    if args.merge:
        s = merge(root, args.merge, args.apply)
        print(f'합치기{"" if args.apply else "(드라이런)"}: 파일 {s["files"]}개, 추가 {s["added"]}건, 기존 유지(같은 id·모델·프롬프트) {s["kept_existing"]}건, '
              f'모르는 id {s["unknown_id"]}건, 잘못된 기록 {s["invalid"]}건')
        for f in s['changed_files']:
            print('  ' + ('씀 ' if args.apply else '바뀔 파일 ') + f)
        if not args.apply and s['added']:
            print('드라이런이라 쓰지 않았습니다. 쓰려면 --apply.')
        return 0
    client = client or Ollama()
    if args.benchmark:
        return cmd_benchmark(args, root, client, prompts)
    return cmd_score(args, root, client, prompts)


if __name__ == '__main__':
    sys.exit(main())
