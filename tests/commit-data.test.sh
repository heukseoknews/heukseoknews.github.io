#!/usr/bin/env bash
# scripts/commit-data.sh 재시도·충돌 동작을 가짜 remote(로컬 bare 저장소)로 검증한다.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/commit-data.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export RETRY_SLEEP="0 0" GIT_TERMINAL_PROMPT=0
fail=0
ok()  { echo "  ok  - $1"; }
bad() { echo "  FAIL- $1"; fail=1; }

setup() {  # $1=이름 → $TMP/$1/{remote.git,runner,other}
  local d="$TMP/$1"; mkdir -p "$d"
  git init -q --bare -b main "$d/remote.git"
  git clone -q "$d/remote.git" "$d/runner" 2>/dev/null
  git -C "$d/runner" config user.name t; git -C "$d/runner" config user.email t@t
  mkdir -p "$d/runner/data"; echo '{"v":0}' > "$d/runner/data/status.json"
  git -C "$d/runner" add -A; git -C "$d/runner" commit -q -m init; git -C "$d/runner" push -q origin HEAD:main
  git clone -q "$d/remote.git" "$d/other" 2>/dev/null
  git -C "$d/other" config user.name o; git -C "$d/other" config user.email o@o
  echo "$d"
}
remote_head() { git -C "$1/remote.git" log -1 --format=%s main; }

echo "1) 변경 없으면 커밋·push 없이 성공"
d=$(setup t1); (cd "$d/runner" && bash "$SCRIPT" origin main >/dev/null 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(remote_head "$d")" = init ] && ok "no-op" || bad "no-op rc=$rc"

echo "2) 정상 push"
d=$(setup t2); echo '{"v":1}' > "$d/runner/data/status.json"
(cd "$d/runner" && bash "$SCRIPT" origin main >/dev/null 2>&1); rc=$?
[[ "$(remote_head "$d")" == data:* ]] && [ $rc -eq 0 ] && ok "pushed" || bad "push rc=$rc head=$(remote_head "$d")"

echo "3) 그 사이 다른 push가 있어도(non-ff) rebase 후 성공, 충돌 시 이쪽 데이터 우선"
d=$(setup t3)
echo '{"v":"other"}' > "$d/other/data/status.json"; echo x > "$d/other/data/other.json"
git -C "$d/other" add -A; git -C "$d/other" commit -q -m "other push"; git -C "$d/other" push -q origin HEAD:main
echo '{"v":"mine"}' > "$d/runner/data/status.json"
(cd "$d/runner" && bash "$SCRIPT" origin main >/dev/null 2>&1); rc=$?
mine=$(git -C "$d/remote.git" show main:data/status.json); other=$(git -C "$d/remote.git" show main:data/other.json 2>/dev/null)
[ $rc -eq 0 ] && [ "$mine" = '{"v":"mine"}' ] && [ "$other" = x ] && ok "rebased, 충돌은 이쪽 우선, 남의 변경 보존" || bad "rc=$rc mine=$mine other=$other"

echo "4) 일시 오류 2번 후 3번째 시도에서 성공"
d=$(setup t4); hook="$d/remote.git/hooks/pre-receive"
cat > "$hook" <<H
#!/bin/sh
n=\$(cat "$d/count" 2>/dev/null || echo 0); n=\$((n+1)); echo \$n > "$d/count"
[ \$n -le 2 ] && { echo "fatal error in commit_refs" >&2; exit 1; }
exit 0
H
chmod +x "$hook"; echo '{"v":4}' > "$d/runner/data/status.json"
(cd "$d/runner" && bash "$SCRIPT" origin main >/dev/null 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$(cat "$d/count")" = 3 ] && [[ "$(remote_head "$d")" == data:* ]] && ok "3번째에 성공" || bad "rc=$rc count=$(cat "$d/count")"

echo "5) 3회 모두 실패하면 실패 코드와 에러 메시지, 로컬 커밋·작업 트리는 보존"
d=$(setup t5); printf '#!/bin/sh\necho "fatal error in commit_refs" >&2\nexit 1\n' > "$d/remote.git/hooks/pre-receive"; chmod +x "$d/remote.git/hooks/pre-receive"
echo '{"v":5}' > "$d/runner/data/status.json"
out=$(cd "$d/runner" && bash "$SCRIPT" origin main 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "::error::data 커밋 push가 3회 모두 실패" && [ "$(cat "$d/runner/data/status.json")" = '{"v":5}' ] && [ "$(remote_head "$d")" = init ] \
  && ok "실패 보고, 데이터 보존" || bad "rc=$rc"
[ "$(echo "$out" | grep -c '시도 [0-9]/3')" -ge 3 ] && ok "3회 시도" || bad "시도 횟수"

[ $fail -eq 0 ] && echo "commit-data tests passed" || { echo "commit-data tests FAILED"; exit 1; }
