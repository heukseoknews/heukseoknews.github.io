"""비밀 유출 검사(docs/auth-plan.md 1.4, docs/auth-runbook.md). 실행: python tests/test_no_secrets.py

저장소가 추적하는 모든 파일에서 다음이 없어야 한다.
1. 새 방식 비밀 키 모양: sb_secret_ 뒤에 20자 이상(문서의 'sb_secret_…', 'sb_secret_<…>' 같은 자리표시자는 통과)
2. 역할이 service_role 인 JWT 모양 문자열(예전 방식 비밀 키)
3. SUPABASE_SECRET_KEY= 바로 뒤에 실제 키처럼 생긴 값(sb_secret_…·JWT·30자 이상 무작위 토큰)이 붙은 줄
   (<…>, $변수, 코드 주석·설명 문장은 통과)
4. 비밀·계정 파일: *.env, accounts*.csv, 머리줄에 student_no 가 있는 CSV
5. 사이트 코드(app·lib·components)가 scripts/admin 을 import 하거나 SUPABASE_SECRET_KEY 를 참조하는 것
"""
import base64
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRET_KEY = re.compile(r'sb_secret_[A-Za-z0-9_\-]{20,}')
JWT = re.compile(r'eyJ[A-Za-z0-9_\-]{10,}\.(eyJ[A-Za-z0-9_\-]{10,})\.[A-Za-z0-9_\-]{10,}')
KEY_LINE = re.compile(r'SUPABASE_SECRET_KEY\s*=\s*["\']?([A-Za-z0-9_.\-]+)')
KEY_LIKE = re.compile(r'^(sb_secret_[A-Za-z0-9_\-]{8,}|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\..*|[A-Za-z0-9_\-]{30,})$')
SKIP_SUFFIX = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip', '.gz')


def tracked() -> list[Path]:
    try:
        out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True).stdout
        return [ROOT / p for p in out.decode('utf-8').split('\0') if p]
    except (OSError, subprocess.CalledProcessError):   # git 이 없으면 폴더를 훑는다(무시 목록 폴더 제외)
        skip = {'.git', 'node_modules', '.next', 'out', '.venv', '__pycache__'}
        return [p for p in ROOT.rglob('*') if p.is_file() and not (set(p.relative_to(ROOT).parts) & skip)]


def jwt_role(payload: str) -> str | None:
    try:
        return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get('role')
    except Exception:
        return None


def scan(files: list[Path]) -> list[str]:
    problems = []
    for p in files:
        rel = p.relative_to(ROOT).as_posix()
        name = p.name.lower()
        if name.endswith('.env') or re.fullmatch(r'accounts.*\.csv', name):
            problems.append(f'{rel}: 비밀·계정 파일은 저장소에 두지 않는다')
        if rel.lower().endswith(SKIP_SUFFIX) or not p.exists():
            continue
        try:
            text = p.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        if name.endswith('.csv') and 'student_no' in text.split('\n', 1)[0].lower():
            problems.append(f'{rel}: 학번 열(student_no)이 있는 CSV')
        for m in SECRET_KEY.finditer(text):
            problems.append(f'{rel}: 비밀 키 모양(sb_secret_…) {m.start()}번째 글자')
        for m in JWT.finditer(text):
            if jwt_role(m.group(1)) == 'service_role':
                problems.append(f'{rel}: service_role JWT 모양 문자열')
        for m in KEY_LINE.finditer(text):
            if KEY_LIKE.match(m.group(1)):
                problems.append(f'{rel}: SUPABASE_SECRET_KEY= 뒤에 값이 있음')
        if rel.split('/')[0] in ('app', 'lib', 'components') and (re.search(r'scripts/admin', text) or 'SUPABASE_SECRET_KEY' in text):
            problems.append(f'{rel}: 사이트 코드가 관리 스크립트·비밀 키를 참조')
    return problems


# 검사기 자체 확인(가짜 값은 실행 중에 조립해 이 파일이 걸리지 않게)
def _selftest():
    import tempfile
    fake = 'sb_' + 'secret_' + 'A' * 24
    payload = base64.urlsafe_b64encode(json.dumps({'role': 'service_' + 'role'}).encode()).decode().rstrip('=')
    with tempfile.TemporaryDirectory(dir=ROOT) as d:
        dd = Path(d)
        (dd / 'a.txt').write_text(f'key={fake}\nSUPABASE_SECRET_KEY=' + 'Q7' * 16 + '\n', encoding='utf-8')
        (dd / 'b.md').write_text('eyJhbGciOiJIUzI1NiJ9.' + payload + '.c2lnbmF0dXJlMTIz\nSUPABASE_SECRET_KEY=<비밀 키>\n sb_secret_… 로 시작\n', encoding='utf-8')
        (dd / 'people.csv').write_text('login_id,display_name,student_no\nkim,김,00000000\n', encoding='utf-8')
        (dd / 'accounts.csv').write_text('x\n', encoding='utf-8')
        (dd / 'supabase.env').write_text('', encoding='utf-8')
        got = scan(sorted(dd.iterdir()))
    kinds = ' '.join(got)
    assert sum('a.txt' in g for g in got) == 2, got            # sb_secret_ 모양 + KEY= 값
    assert sum('b.md' in g for g in got) == 1, got             # service_role JWT 만(자리표시자는 통과)
    assert 'people.csv' in kinds and 'accounts.csv' in kinds and 'supabase.env' in kinds, got


_selftest()
problems = scan(tracked())
for p in problems:
    print('✗', p)
if problems:
    sys.exit(f'비밀 유출 의심 {len(problems)}건')
print('no-secrets test passed')
