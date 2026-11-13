# 흑석일보 (heukseoknews.github.io)

## 서비스
보험·AI·금융 뉴스를 매일 자동 수집해 보여 주는 정적 사이트(소수의 친구들이 사용). 수집(Python collector) → data/ JSON → Next.js 정적 빌드 → GitHub Pages. 채널은 channels/<채널>/ 설정으로 정의한다. 구조 상세는 docs/architecture.md, 문서 목록은 맨 아래.

## 작업 방식
- 답변·보고는 한국어, 결과 중심으로 짧게. 표를 쓰고 과정 서술은 줄인다.
- 요청 범위 밖의 변경(점수 산식, 분류 규칙, 새 소스, 다른 세션 영역)은 하지 않고 먼저 묻는다.
- 프롬프트가 지시한 내용·결정·규칙이 이 문서보다 우선한다.
- 모르는 것은 추측하지 말고 코드·문서를 읽어 확인한다. 확인할 수 없으면 그렇다고 보고한다.

## 사용량 절약
- 서브에이전트는 기본적으로 쓰지 않는다. 프롬프트가 허용했거나 독립적인 대량 조사일 때만 읽기 전용으로 쓴다. 수정·커밋·push·data 변경은 메인 세션에서만 한다.
- 전체 테스트·빌드는 push 직전에 한 번만 돌린다. 그 전에는 관련 테스트 파일만 돌린다.
- 큰 파일은 필요한 부분만 읽고 같은 파일을 반복해 읽지 않는다.
- 화면 캡처·Playwright는 프롬프트가 요구할 때만 하고 저장은 /tmp에 한다.
- 보고는 핵심만: 결과, 변경 파일, 검증 결과, 내가 결정해야 할 것.
- 한 작업이 끝나면 인수인계 메모(끝낸 것/남은 것/주의점)를 남기고 새 세션을 권한다. 사용량 한도로 중단된 뒤에는 git status와 git log로 진행 상황을 먼저 확인하고 끝난 부분은 다시 하지 않는다.

## 세션 영역
여러 세션이 병렬로 일할 때 영역을 나눈다. 다른 영역의 수정이 필요하면 하지 말고 보고서에 이유와 최소 변경안을 적는다.
- 화면 세션(A): app/, components/, lib/, public/, 프런트엔드 테스트, 화면 문구, docs/design-plan.md, docs/architecture.md.
- 품질·수집 세션(B, 별도 worktree, 브랜치 quality): collector/, channels/*/ 설정 파일, scripts/audit/, supabase/, scripts/admin/, docs/data-contract.md, docs/article-quality*.md, docs/auth-runbook.md.
- 예외: 화면 세션은 channels/<채널>/channel.json의 화면 문구(탭 이름 등)만 최소 변경할 수 있다.
- 품질 세션의 push: `git pull --rebase origin main && git push origin quality:main`.

## Git·배포
- 커밋은 파일을 지정해서 한다. git add -A, force push, 이력 재작성, 파일 삭제는 허락 없이 하지 않는다. 작업 단위로 커밋하고 설정 변경과 data 변경은 커밋을 분리한다.
- push 전에 `git pull --rebase origin main`(자동 data 커밋과 다른 세션의 push가 있다). 충돌이 나면 멈추고 보고한다. push 전에 `gh run list`로 실행 중·대기 중인 워크플로가 없는지 확인한다.
- push 후 Actions 성공과 배포된 version.json의 commit 일치, / /insurance/ /ai/ /finance/ 200을 확인한다.
- data/는 직접 편집하지 않는다. 바꿀 때는 공식 수집기 옵션(--quality, --reclassify, --normalize-sources, --dedupe-months 등)을 쓰고, 커밋 전에 dry-run과 요약(건수, 파일 크기, 샘플)을 보고하고 승인을 받는다.
- 수동 수집은 gh workflow run으로 한다(오래된 실행의 Re-run은 옛 코드를 재배포한다).
- 테스트 명령: (적용 세션이 package.json과 워크플로를 보고 정확한 명령으로 채운다)

## 수집 원칙
- 제목, 링크, 출처, 발행 시각과 우리 메타만 저장한다. 본문·이미지·첨부 저장 금지.
- robots.txt를 지키고 요청 간 1.2초 이상. 로그인·CAPTCHA·우회 금지.
- 수집은 하루 1회(20:37 UTC)가 기본이고, 피드가 얕은 AI 채널만 하루 3회를 허용한다.
- 소스·카테고리·키워드·점수·보험사·기관은 channels/<채널>/ 설정 파일로 관리하고 코드에 하드코딩하지 않는다. 엔진 변경이 필요하면 최소 변경안을 보고하고 멈춘다.
- 같은 사건 묶기와 score_v2는 채널 설정의 enabled 플래그로 켜고 끈다. 끄는 절차는 docs/ops-notes.md.

## 화면 원칙
- 채널은 색과 내용만 바뀌고 틀은 같다. 헤더 메뉴 위치, 탭(새 뉴스·전체 뉴스·공식 발표·북마크), 컨테이너 폭·여백, 채널 이동 줄은 모든 채널에서 같은 자리다.
- 사용자 화면에는 필요한 정보만 보인다. 설정 파일 경로, 운영자용 설명, "~할 수 있습니다" 식의 기능 안내, 기술 용어, 알고리즘·점수 설명은 넣지 않는다. 설명이 필요하면 짧은 한 줄이나 툴팁으로 하고 운영 정보는 docs/에만 둔다.
- 화면 문구는 한국어 신문 톤으로 담백하게 쓴다. 코드 주석과 화면 문구를 구분한다.

## 로그인 (Supabase)
- 로그인은 아이디+비밀번호 계정이고 관리자가 만든다. 로그인 화면 먼저는 화면상의 안내 장벽일 뿐 기사 데이터는 공개 파일이다. REQUIRE_LOGIN 스위치가 꺼져 있으면 사이트는 로그인 도입 전과 똑같이 동작해야 한다.
- 프런트엔드에는 publishable key만 쓴다. 비밀 키(sb_secret_…, service_role)·비밀번호·학번·계정 목록은 저장소, 코드, 로그, 출력, 문서 어디에도 쓰지 않는다. 계정 목록은 저장소 밖 로컬 파일에 둔다.
- 실제 Supabase 요청은 프롬프트가 지시했을 때만 한다.

## 개인정보·공개
- 공개 저장소다. 문서·코드·푸터에는 이름 'Seungu Sin'만 쓴다. 조직명, 이메일, 학교, IP, 로컬 경로는 쓰지 않는다(규칙에 그 값을 직접 적지도 않는다).
- 비밀번호·토큰·API 키를 저장소에 넣지 않는다. 저장소의 비밀 유출 검사 테스트가 통과해야 push한다.

## 문서
docs/architecture.md(구조), ai-channel-plan.md, finance-channel-plan.md(채널 계획), design-plan.md(화면), data-contract.md(데이터 필드), article-quality-plan.md(기사 품질), auth-plan.md(로그인 설계), auth-runbook.md(계정 운영), ops-notes.md(운영 절차).