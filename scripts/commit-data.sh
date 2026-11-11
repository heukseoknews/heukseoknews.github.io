#!/usr/bin/env bash
# data/ 변경을 커밋하고 push한다. GitHub 쪽 일시 오류(remote rejected)나 그 사이 다른 push에 대비해
# 실패하면 pull --rebase(충돌 시 이쪽 수집 결과 우선) 후 최대 3회 재시도한다.
#   사용: scripts/commit-data.sh [remote=origin] [branch=main]
#   환경: RETRY_SLEEP="5 15" (재시도 전 대기 초, 테스트에서 "0 0"으로 덮어씀)
set -u
REMOTE="${1:-origin}"
BRANCH="${2:-main}"
SLEEPS=(${RETRY_SLEEP:-5 15})
MAX=3

git add data
if git diff --cached --quiet; then
  echo "변경 없음 — 커밋 생략"
  exit 0
fi
git commit -q -m "data: 뉴스 수집 $(date -u +%Y-%m-%dT%H:%MZ)" || { echo "::error::git commit 실패"; exit 1; }

for attempt in $(seq 1 "$MAX"); do
  if git push "$REMOTE" "HEAD:$BRANCH"; then
    echo "push 성공 (시도 $attempt/$MAX)"
    exit 0
  fi
  echo "::warning::push 실패 (시도 $attempt/$MAX)"
  [ "$attempt" -eq "$MAX" ] && break
  sleep "${SLEEPS[$((attempt - 1))]:-5}"
  # 원격이 앞서 있으면 받아서 위에 얹는다. rebase에서 -X theirs = 재생되는 우리 커밋(data) 우선.
  if ! git pull --rebase -X theirs "$REMOTE" "$BRANCH"; then
    echo "::warning::pull --rebase 실패 — rebase 중단 후 재시도"
    git rebase --abort 2>/dev/null || true
  fi
done
echo "::error::data 커밋 push가 ${MAX}회 모두 실패했습니다. 사이트에는 이번 수집이 반영되지만 저장소에는 반영되지 않았습니다."
exit 1
