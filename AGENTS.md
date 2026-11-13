# 흑석일보 (heukseoknews.github.io) — 에이전트 규칙 요약

원본은 [CLAUDE.md](CLAUDE.md)다. 여기에는 모든 에이전트가 지켜야 할 공통 규칙만 요약한다. 두 파일이 어긋나면 CLAUDE.md를 따르고, 규칙을 바꿀 때는 CLAUDE.md를 먼저 고친 뒤 이 요약을 맞춘다.

## 공통 규칙
- 비밀 키(sb_secret_…, service_role)·DB 비밀번호·사용자 비밀번호·학번·실제 login_id·계정 목록은 코드, 로그, 출력, 문서, 커밋 메시지 어디에도 쓰지 않는다. 프런트엔드는 publishable key만 쓴다.
- 공개 저장소다. 문서·코드·푸터에는 이름 'Seungu Sin'만 쓰고 조직명, 개인 이메일, 학교명, IP, 로컬 경로는 쓰지 않는다.
- 커밋은 파일을 지정해서 한다. git add -A, force push, 이력 재작성, 파일 삭제는 허락 없이 하지 않는다.
- data/는 직접 수정하지 않는다. 공식 수집기 옵션을 쓰고 dry-run 보고·승인 뒤에 반영한다.
- 테스트·빌드(tsc, npm test, Python 테스트, 빌드, 비밀 키 검사)가 모두 통과한 뒤에만 push한다. push 전에 `git pull --rebase origin main`.
- 각 세션은 자기 영역만 수정한다. 다른 영역이 필요하면 이유와 최소 변경안을 보고한다(영역 구분은 CLAUDE.md "세션 영역").

## 기존 기사 보존
- 기존 기사의 id·channel은 바꾸지 않는다(북마크·채팅 첨부가 id를 가리킨다). 규칙을 바꿔도 저장된 기사의 id와 날짜는 유지한다.
- 새 필드는 선택 필드로 추가만 한다. 데이터 재작성은 코드 변경과 별도 커밋으로 한다.
- 기사를 지우거나 합치는 작업은 --dry-run으로 바뀌는·삭제되는·id가 바뀌는 기사 수를 보고하고, 삭제나 id 변경이 있으면 승인 뒤에만 반영한다.

## Supabase
- SQL은 supabase/migrations/에 새 번호 파일로 쓰고 사용자가 SQL Editor에서 적용한다. 적용된 파일은 고치지 않는다.
- 서버 규칙을 바꾸면 scripts/admin/verify.mjs에 확인 항목을 더한다. 실제 Supabase 요청은 지시가 있을 때만 한다.

수집 원칙, 화면 원칙, 배포 확인, 사용량 절약 등 나머지는 CLAUDE.md와 docs/를 본다.
