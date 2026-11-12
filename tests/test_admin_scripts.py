"""계정 관리 스크립트 단위 테스트 실행기: python tests/test_admin_scripts.py

scripts/admin/test_admin.mjs(Node, 의존성 없음)를 실행한다. Supabase 에 요청하지 않는다(가짜 서버).
CI 수집 잡의 'Test collector' 단계가 tests/test_*.py 를 돌리므로 여기서 Node 테스트를 부른다.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
node = shutil.which('node')
if not node:
    sys.exit('node 가 없습니다(계정 관리 스크립트 테스트에 필요)')
r = subprocess.run([node, str(ROOT / 'scripts' / 'admin' / 'test_admin.mjs')], cwd=ROOT, capture_output=True, text=True, timeout=120)
sys.stdout.write(r.stdout)
sys.stderr.write(r.stderr)
if r.returncode:
    sys.exit(f'계정 관리 스크립트 테스트 실패(종료 코드 {r.returncode})')
