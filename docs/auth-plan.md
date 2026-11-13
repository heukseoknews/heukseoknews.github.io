# 로그인·동기화 설계 (Supabase)

> 상태: 2026-11-13 갱신. 단계 1(SQL·관리 스크립트·보안 검증 스크립트·실행 절차서)은 작성 완료이고, 실행은 관리자가 `docs/auth-runbook.md` 를 따라 한다. 화면도 있다: 로그인(`app/login/`), 채팅(`app/chat/`), 계정(`app/me/account/`). 구현은 10장의 단계 순서로 한다.
> 실제 SQL 은 `supabase/migrations/0001_init.sql`, 관리 스크립트는 `scripts/admin/` 이다. 이 문서와 다르면 그 파일이 기준이다.
> 근거: Supabase 공식 문서·가격표, 공식 저장소(supabase/auth, supabase-js) 소스. 공식 문서에서 확인하지 못한 것은 **(미확인)** 으로 적었고, 구현 단계에서 실측해 확정한다.
> 문서 안의 키·비밀번호·주소는 모두 자리표시자다(`<프로젝트 ref>`, `<publishable 키>` 등). 실제 값은 저장소에 쓰지 않는다.

## 0. 요약

- **구성**: 사이트는 지금처럼 정적 export(GitHub Pages)다. 브라우저가 `@supabase/supabase-js` 로 Supabase Auth(로그인)와 Postgres(사용자 상태·프로필)에 직접 붙는다. 서버 코드는 없다.
- **로그인 방식**: 아이디형 계정만 쓴다. 카카오 등 외부 로그인은 쓰지 않는다. 나중에 병행 추가할 수 있게 계정 식별을 Supabase 사용자 id 에 묶고 로그인 방법을 `lib/auth.ts` 한 곳에 모은다(11장).
- **계정**: 관리자가 만든다. 가입은 닫혀 있다. 아이디 `kim` → 내부 이메일 `kim@users.heukseok.invalid`(메일을 보내지 않는 경로만 쓴다). 표시 이름(헤더·댓글·채팅에 보이는 이름)은 아이디와 따로, 처음에는 관리자가 정하고 이후 사용자가 마이페이지 → 계정에서 바꾼다(서버 함수 `set_display_name` 하나로만, 0002).
- **첫 로그인(확정)**: 초기 비밀번호는 **각자의 학번**이다. 학번으로 로그인하면 **비밀번호 변경 화면으로 강제 이동**하고, 바꾸기 전에는 다른 화면에 들어갈 수 없다. 서버도 바꾸기 전에는 동기화를 거절한다(4.1). 학번은 남이 알 수 있으므로 이것이 핵심 보완 장치다(2.5).
- **화면(확정)**: 사이트 첫 화면은 **로그인 화면이 먼저**다. 처음 접속하면 `/login/`(noindex) → 로그인 후 홈. 로그인 여부는 브라우저에서 검사하는 **화면상의 안내 장벽**이고, 기사 데이터는 공개 정적 파일 그대로다(열람 차단이 아니다). 사용자 기록은 서버(RLS)가 막는다.
- **서버 장애(확정)**: 로그인 서버가 멈추거나(무료 플랜 정지·장애) 연결이 안 되면, 이미 로그인한 사람은 기사 읽기와 이 기기의 북마크가 그대로 동작하고 **동기화만 멈춘다**(연결되면 다시 보냄). 새 로그인은 서버가 돌아올 때까지 안 된다(7.3).
- **동기화**: 지금 구조(localStorage 가 즉시 반응하는 저장소)를 그대로 두고, 그 뒤에서 서버와 맞추는 **로컬 우선 동기화**를 붙인다. 충돌은 기존 `mergeStates`(첫 연결)와 새 3-방향 병합(이후)으로 푼다.
- **권한**: 표 3개(`user_state`·`profiles`·`account_security`). 모든 표에 RLS + 표마다 필요한 GRANT 만 명시. 사용자는 본인 행만, 프로필·비밀번호 상태는 읽기만. anon 은 권한 없음. 검증 절차 포함(4.3).
- **상한(확정)**: 실제 사용 한도(채널당 북마크 1,000·폴더 20·태그 50·메모 200자·북마크당 태그 10)는 **화면에서만** 검사한다. 서버는 악용 방지용 넉넉한 상한(북마크 3,000·폴더 100·태그 200·메모 1,000자·북마크당 태그 50·사용자당 채널 행 10·행 크기 4MB)만 둔다. 두 기기 기록을 합친 결과가 화면 한도를 넘어도 동기화가 거절되지 않게 하기 위해서다(3.3).
- **비밀 키**: secret(service_role) 키는 관리자 PC 의 관리 스크립트에서만. 저장소·CI·브라우저 어디에도 없고, 테스트와 정기 점검으로 확인한다(1.4).
- **개인정보 안내**: 푸터 한두 줄. 긴 처리방침 문서는 만들지 않는다(7.6).
- **되돌리기**: 빌드 환경 변수(Supabase 주소·키)가 없으면 로그인 기능이 꺼지고 지금과 같은 로컬 전용 사이트로 빌드된다. GitHub 변수만 지우고 다시 배포하면 원상복구된다.

## 1. 구조

### 1.1 정적 export 에서 supabase-js 쓰기

- 패키지: `@supabase/supabase-js`(v2, 2.102.0 이상 — 2.5 의 '현재 비밀번호 확인' 때문). `@supabase/ssr` 은 쿠키 기반 서버 렌더링용(베타)이라 서버가 없는 이 사이트에는 맞지 않는다.
- 클라이언트는 `lib/supabase.ts` 한 곳에서 한 번만 만든다(`createClient(url, publishableKey)`). 기본값이 이 사이트에 맞다: `persistSession: true`(localStorage), `autoRefreshToken: true`. 세션은 `sb-<프로젝트 ref>-auth-token` 키로 localStorage 에 저장된다(supabase-js 소스 기준, 공식 문서에는 기본값 명시 없음).
- `detectSessionInUrl` 은 끈다(메일 링크·OAuth 를 쓰지 않으므로 주소창 해시를 세션으로 해석할 이유가 없고, `#import=` 해시와 섞이지 않게).
- 화면 코드는 supabase-js 를 직접 부르지 않고 `lib/auth.ts`(로그인·로그아웃·비밀번호 변경·현재 사용자·계정 상태)와 `lib/sync.ts`(동기화)만 쓴다. 테스트에서 가짜 클라이언트로 바꾸기 쉽고, 외부 로그인을 나중에 붙일 때 고칠 곳이 한 곳이 된다.

### 1.2 환경 변수

| 이름 | 값 | 공개 여부 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<프로젝트 ref>.supabase.co` | 공개(번들에 들어감) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_<…>` | 공개(번들에 들어감) |

- `NEXT_PUBLIC_*` 는 `next build` 때 번들에 문자열로 박힌다. 그래서 값은 **빌드하는 곳**에 있어야 한다.
  - GitHub Actions: 저장소 Settings → Secrets and variables → Actions → **Variables** 에 두 값을 넣고, `deploy.yml` 의 build 잡 `npm run build` 단계에 `env: NEXT_PUBLIC_SUPABASE_URL: ${{ vars.NEXT_PUBLIC_SUPABASE_URL }}` 식으로 넘긴다. 공개 값이라 Secrets 가 아니라 Variables 로 충분하다.
  - 로컬: `.env.local`(이미 `.gitignore` 의 `.env*` 로 제외됨). 이 파일에는 위 두 공개 값만 둔다(secret 키 금지, 1.4).
- 두 값이 없으면 로그인·동기화 기능을 끈 채 빌드한다(지금 사이트와 같음). 동등성 검사·테스트는 이 모드로도 돌 수 있다. 단, **배포 빌드에서는** 값이 없으면 실패하게 한다(`deploy.yml` 에서 검사) — 실수로 로그인 없는 판이 나가지 않게. 의도적으로 끌 때는 9.3 의 끄기 스위치를 쓴다.

### 1.3 공개해도 되는 키와 절대 두면 안 되는 키

| 키 | 역할 | 어디에 |
|---|---|---|
| publishable `sb_publishable_…` (구 `anon`) | 요청을 `anon`/`authenticated` 역할로 실행. 권한은 RLS·GRANT 가 정한다 | 브라우저 번들 OK |
| secret `sb_secret_…` (구 `service_role`) | `service_role` 역할 — **모든 RLS 를 우회** | 관리자 PC 에서 명령을 칠 때만(1.4) |
| DB 비밀번호, JWT secret | DB 직접 접속·토큰 서명 | 관리자의 비밀번호 관리자에만 |

- publishable 키가 공개돼도 안전한 이유: 이 키로 할 수 있는 일은 "로그인 시도"와 "RLS·GRANT 가 허락한 행 접근"뿐이다. 이 설계에서 anon 은 표 권한이 없고(4장), 로그인한 사용자는 자기 행만 본다.
- 구 키(`anon`·`service_role`)는 2026년 말 폐기 예정이다. 처음부터 새 키(publishable/secret)를 쓰고, Settings → API Keys 에서 구 키를 **비활성화**한다.

### 1.4 secret 키 관리 규칙과 검증

규모(10명)와 상관없이 아래 규칙을 지킨다. secret 키 하나가 새면 모든 사용자의 기록·계정을 읽고 바꿀 수 있기 때문이다.

**규칙**

1. 쓰는 곳은 관리 스크립트(`scripts/admin/users.mjs`·`verify.mjs`, 6.3) 하나뿐이다. 사이트 코드·빌드·GitHub Actions 는 secret 키가 필요 없다.
2. 전용 키를 만든다: Settings → API Keys 에서 secret 키를 용도 이름(`admin_script`)으로 따로 만들어 쓰고, 기본 secret 키는 쓰지 않는다. 문제가 생기면 이 키만 지운다(새 키 체계는 secret 키를 여러 개 만들고 각각 폐기할 수 있다).
3. 두지 않는 곳: 저장소의 모든 파일(무시 목록에 든 `.env.local` 포함), 저장소 폴더 안의 어떤 파일, GitHub Secrets·Variables, Actions 로그, 브라우저·번들, URL, 이슈·커밋 메시지, 대화창(Claude Code 포함).
4. 넣는 방법(확정): 관리자 맥의 `~/.heukseok/supabase.env`(권한 600, 경로는 `HEUKSEOK_SECRET_ENV` 로 바꿀 수 있음)에 한 줄로 두고, 스크립트가 이 파일에서만 읽는다. 셸 기록·저장소 폴더에 남기지 않는다. 원본 보관은 비밀번호 관리자에.
5. 스크립트 쪽 방어(구현됨): 키 파일·계정 CSV 가 저장소 폴더 안에 있으면 거절한다, `sb_secret_` 로 시작하지 않으면 거절한다, 키·학번·비밀번호·토큰은 모든 출력에서 [가림] 으로 바꾼다, 브라우저 번들에 들어가지 않는 위치(`scripts/`)에 둔다, 사이트 코드에서 import 하지 않는다(`tests/test_no_secrets.py` 로 확인).
6. Claude Code 는 secret 키를 받지 않고 다루지 않는다. RLS 검사도 시험 계정 로그인(publishable 키)으로만 한다.

**검증(자동)**

| 언제 | 무엇 | 실패 조건 |
|---|---|---|
| CI(`tests/test_no_secrets.py`) 마다 | 저장소 추적 파일 전체 검색(`*.env`·`accounts*.csv`·학번 열 CSV 커밋 포함) | `sb_secret_` 로 시작하는 문자열, `"role":"service_role"` 을 담은 JWT 모양 문자열, `SUPABASE_SECRET_KEY=` 뒤에 값이 붙은 줄 |
| 배포 빌드 직후(`deploy.yml`) | `out/` 전체(HTML·JS 청크) 검색 | 위와 같음 → 배포 중단 |
| CI(`tests/test_no_secrets.py`) 마다 | `app/`·`lib/`·`components/` 에서 `scripts/admin` import 또는 `SUPABASE_SECRET_KEY` 참조 | 1건이라도 있으면 실패 |

**검증(수동, 관리자)**

| 언제 | 무엇 |
|---|---|
| 단계 1 시작 전 1회 | 전체 이력 검색 `git log -p --all \| grep -c 'sb_secret_'` = 0 |
| 계정 작업 뒤마다 | 셸 기록에 키가 없는지(`history \| grep sb_secret_` 0건) |
| 분기 1회 | Settings → API Keys 에서 secret 키 목록 확인 — `admin_script` 외 쓰지 않는 키 삭제. GitHub 저장소 Settings → Secrets and variables 에 Supabase secret 이 없는지 확인 |
| 분기 1회 | 배포된 사이트 JS 청크에서 `sb_secret_` 검색 0건(자동 검사의 재확인) |

**유출 시 순서**(절차서 12장): ① `admin_script` 키 즉시 삭제(Settings → API Keys) ② 새 키 생성 ③ 원인 제거(파일·이력·로그). 공개 저장소 이력에 들어갔으면 키를 지운 뒤에 이력 정리 여부를 따로 정한다 ④ 대시보드 Users·`user_state` 에서 이상 변경 확인. 공개 GitHub 에 올라간 secret 키를 Supabase 가 자동 폐기한다는 안내가 있으나(블로그) 이것에 기대지 않는다.

## 2. 로그인 흐름

### 2.1 경로

| 경로 | 로그인 필요 | 비고 |
|---|---|---|
| `/login/` | 아니요 | noindex. 로그인 상태로 오면 `next` 또는 홈으로 |
| `/login/change-password/` | 예(비밀번호 변경 전에도 들어갈 수 있는 유일한 화면) | noindex. 첫 로그인 강제 변경·본인 변경 |
| `/` (홈), `/<채널>/…` 전부(내 데이터·수집 상태 포함) | 예 + 비밀번호 변경 완료 | |
| `/account/` | 예 + 비밀번호 변경 완료 | 계정 정보·로그아웃(noindex) |
| 404, `/data/…`, `/version.json`, 아이콘·OG 이미지 | 아니요 | 공개 정적 파일(의도된 공개) |

### 2.2 처음 접속 → 로그인 → (첫 로그인이면 비밀번호 변경) → 홈

1. 보호 경로의 HTML `<head>` 첫 부분에 작은 인라인 스크립트(빌드 때 프로젝트 ref 를 넣어 생성)를 둔다. 화면을 그리기 전에 다음 순서로 검사한다.
   - localStorage 에 `sb-<ref>-auth-token` 이 **없으면** `location.replace('/login/?next=' + encodeURIComponent(pathname + search + hash))`.
   - 있으면 그 안의 사용자 id 로 계정 상태 사본 `heukseok-account-v1@<사용자 id>` 를 읽는다. **없거나 `mustChange: true` 이면** `/account/password/?next=…` 로(사본이 없을 때도 변경 화면으로 보내고, 그 화면이 서버에서 확인해 이미 바꾼 계정이면 곧바로 `next` 로 돌려보낸다 — 실패하면 막히는 쪽으로).
   - 이 검사는 "세션이 있어 보이는가"만 본다(서버 확인 아님). 클라이언트 검사이므로 우회는 쉽다 — 기사는 원래 공개 파일이므로 받아들인다. 사용자 데이터 접근은 RLS 가 막고, 비밀번호를 바꾸지 않은 계정은 서버에서도 동기화가 거절된다(4.1).
   - 홈의 `#import=` 이동 스크립트보다 먼저 실행된다. 로그인 안 한 사람이 `/#import=…` 로 오면 `next=/#import=…` 로 로그인 후 홈 → 내 데이터로 이어진다.
2. `/login/`: 아이디·비밀번호 → `signInWithPassword({ email: toEmail(id), password })`.
   - 아이디 형식: 영문 소문자로 시작, 소문자·숫자·`_`·`-`·`.` 3~20자. 입력은 소문자로 바꾸고 앞뒤 공백 제거. `toEmail(id) = id + '@users.heukseok.invalid'`.
   - `.invalid` 는 예약된 최상위 도메인이라 실제 메일이 갈 수 없다. Supabase 서버 소스상 계정 생성·비밀번호 로그인은 형식 검사만 하므로 통과한다. 메일을 보내는 기능(비밀번호 찾기 메일, 이메일 확인, 초대)은 쓰지 않는다 **(호스팅 환경 실측 필요 — 단계 2 완료 기준에 포함)**.
3. 로그인에 성공하면 본인의 `profiles`(표시 이름)와 `account_security`(변경 필요 여부)를 읽어 사본 `heukseok-account-v1@<사용자 id>` = `{ displayName, mustChange, checkedAt }` 에 저장한다.
   - `mustChange: true` → `/account/password/?next=<원래 next>`.
   - 아니면 `next` 로. `next` 는 `/` 로 시작하고 `//`·`/\`·`/login`·`/account/password` 로 시작하지 않는 같은 사이트 경로만 받고(열린 리디렉트 방지), 아니면 `/`.
4. 앱이 열릴 때마다 뒤에서 계정 상태를 다시 읽어 사본을 고친다(관리자가 비밀번호를 초기화하면 다음 방문 때 변경 화면으로).

### 2.3 세션 유지·만료·로그아웃

- access token 은 기본 1시간, supabase-js 가 자동 갱신한다. refresh token 은 만료되지 않지만 한 번만 쓸 수 있다(재사용이 감지되면 세션 전체 폐기).
- 앱 시작 시 `onAuthStateChange` 를 구독한다.
  - `SIGNED_OUT`(토큰 폐기·관리자 삭제·다른 탭 로그아웃): 동기화를 멈추고 `/login/?next=…` 로.
  - 네트워크 오류로 갱신에 실패하면 로그아웃시키지 않는다. 화면은 계속 쓰고 동기화 상태만 '이 기기에만 저장됨'으로 둔다.
- 로그아웃(`/account/` 와 헤더 메뉴, 비밀번호 변경 화면): ① 보내지 못한 변경을 한 번 보내 보고 ② 실패하면 "보내지 못한 변경이 있습니다. 그래도 로그아웃할까요?" ③ `signOut({ scope: 'local' })`(이 기기만. 기본값 `global` 은 모든 기기를 로그아웃시킴) ④ 이 계정의 로컬 사본(5.2 표의 사용자 키)을 지운다 — 같은 브라우저를 다른 사람이 쓸 때 기록이 남지 않게.
- 세션 타임아웃·사용자당 단일 세션은 Pro 플랜 기능이라 쓰지 않는다.

### 2.4 아이디 저장

- 로그인 화면의 '아이디 저장' 체크 → `localStorage['heukseok-login-id'] = 아이디`. 체크를 끄고 로그인하면 지운다. 비밀번호는 어디에도 저장하지 않는다(브라우저 비밀번호 관리자는 막지 않는다: `autocomplete="username"`/`"current-password"`/`"new-password"`).

### 2.5 비밀번호 변경(첫 로그인 강제·본인 변경 공통)

- 화면 `/account/password/`: 현재 비밀번호, 새 비밀번호 2번 → `updateUser({ password, current_password })`.
  - 첫 로그인 강제 변경일 때: 제목 "비밀번호를 바꿔 주세요", 한 줄 "처음 받은 비밀번호는 바꾼 뒤에 이용할 수 있습니다." 헤더 메뉴·채널 이동 없이 이 폼과 '로그아웃'만 보인다.
  - 본인 변경일 때(`/account/` 에서 이동): 제목 "비밀번호 변경", 취소 링크.
- 새 비밀번호 규칙
  - 서버: 최소 8자(설정 완료). 서버 필수 문자 규칙은 켜지 않는다 — 학번 같은 숫자 초기 비밀번호를 관리자가 만들 수 있게 하기 위해서다(관리자 생성에도 서버 규칙이 적용되는지는 **(미확인)**, 단계 2 에서 확인).
  - 화면(제출 전 검사): 8자 이상, 영문과 숫자를 모두 포함, 아이디를 포함하지 않음, 두 칸 일치.
  - 서버는 현재 비밀번호와 같은 새 비밀번호를 거절한다(`same_password`). 학번을 그대로 다시 쓰는 것이 막힌다.
- 변경 완료 판정은 **서버가 한다**: `auth.users` 의 비밀번호가 실제로 바뀌면 DB 트리거가 `account_security.must_change_password = false` 로 바꾼다(4.1). 사용자가 직접 이 값을 고칠 권한은 없다. 성공 후 화면은 계정 상태를 다시 읽어 사본을 고치고 `next` 로 이동한다.
- Supabase 설정: **Require current password** 켬, **Secure password change(재인증 메일)** 끔 — 재인증 nonce 가 메일로 오므로 가짜 이메일 구조에서는 켜면 안 된다.
- 다른 기기 세션은 그대로 둔다. `/account/` 에 '다른 기기에서 모두 로그아웃'(`signOut({ scope: 'others' })`)을 둔다.

### 2.6 화면 문구(오류)

| 상황 | 판정 | 문구 |
|---|---|---|
| 아이디 형식 아님 | 클라이언트 | 아이디를 확인해 주세요. |
| 아이디·비밀번호 틀림 | 400 `invalid_credentials` | 아이디 또는 비밀번호가 맞지 않습니다. |
| 요청 제한 | 429 | 시도가 많습니다. 잠시 후 다시 시도해 주세요. |
| 네트워크·서버 정지 | fetch 실패·5xx | 로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| 새 비밀번호 규칙 위반 | 클라이언트·`weak_password` | 비밀번호는 8자 이상, 영문과 숫자를 섞어 주세요. |
| 새 비밀번호에 아이디 포함 | 클라이언트 | 아이디가 들어가지 않은 비밀번호를 정해 주세요. |
| 두 칸 불일치 | 클라이언트 | 새 비밀번호가 서로 다릅니다. |
| 현재와 같은 비밀번호 | `same_password` | 지금 비밀번호와 다른 비밀번호를 정해 주세요. |
| 현재 비밀번호 틀림 | 400 | 현재 비밀번호가 맞지 않습니다. |

계정 유무를 구분하는 문구는 쓰지 않는다. 오류 원문은 `console.error` 로만(토큰·비밀번호는 로그에 넣지 않는다).

## 3. 데이터 설계

### 3.1 표

| 표 | 행 | 내용 | 사용자 권한 |
|---|---|---|---|
| `profiles` | 사용자 1행 | 아이디(`login_id`)·표시 이름·관리자 표시(`is_admin`) | 본인 행 읽기만(확장 때 로그인 사용자 전체 읽기, 11장) |
| `account_security` | 사용자 1행 | 비밀번호 변경 필요 여부, 바꾼 시각, 관리자 초기화 진행 표시 | 본인 행 읽기만 |
| `user_state` | 사용자 × 채널 1행 | 북마크(기사 스냅샷·폴더·태그·메모·삭제 표시)·내 폴더·내 태그·읽음·확인 시각·보험사 | 본인 행 읽기·쓰기 |

표시 이름과 비밀번호 상태를 다른 표로 나눈 이유: 댓글·채팅을 열면 표시 이름은 다른 사용자에게 보여야 하지만 비밀번호 상태는 본인만 봐야 한다. RLS 는 행 단위라 한 표에서 열마다 다르게 열기 어렵다.

실제 SQL 은 `supabase/migrations/0001_init.sql` 한 파일이다(관리자가 SQL Editor 에 붙여 넣어 실행, 여러 번 실행해도 결과가 같다 — 절차서 2장). 열 요약:

| 표 | 열 |
|---|---|
| `profiles` | `user_id`(auth.users, 지우면 함께 삭제), `login_id`(아이디, 고유, 2.2 형식), `display_name`(표시 이름, 고유, 1~20자, 처음엔 관리자가 정하고 이후 사용자가 `set_display_name` 으로 바꿈), `display_name_changed_at`(사용자가 마지막으로 바꾼 시각, 0002 — 사용자가 직접 고칠 수 없음), `is_admin`(기본 false — 지금은 권한에 쓰지 않고 댓글 관리 등 확장 때 쓸 자리), `created_at` |
| `account_security` | `user_id`, `must_change_password`(기본 true), `password_changed_at`, `reset_pending`(관리자 초기화 진행 중, 6.3) |
| `user_state` | `user_id`(기본 `auth.uid()`), `channel`, `schema_version`, `bookmarks`·`folders`·`tags`·`read_at`(jsonb 객체), `last_confirmed`, `companies`(jsonb 배열), `rev`, `created_at`, `updated_at`. 기본 키 `(user_id, channel)`, 행 크기 상한 4MB |

트리거(함수는 Data API 에 노출되지 않는 `private` 스키마):

- `auth.users` 에 계정이 생기면: `account_security`(변경 필요 = true)를 만들고, 이메일이 `<아이디>@users.heukseok.invalid` 이면 `profiles` 를 만든다. 아이디는 이메일 앞부분, 표시 이름은 관리 스크립트가 `app_metadata.display_name` 으로 넘긴 값(사용자가 고칠 수 없는 영역).
- `auth.users` 의 비밀번호 해시가 실제로 바뀌면: `reset_pending` 이면(관리자 초기화) '변경 필요'를 그대로 두고, 아니면(본인 변경) 끈다.
- `user_state` 를 쓸 때: 수정 시각을 서버 시계로, 서버 상한(3.3) 검사.

- `auth.users` 에 `after insert` 트리거로 프로필을 만드는 것은 공식 문서의 방식이다. `encrypted_password` 열에 거는 트리거는 같은 방식의 응용이며, 실제 동작은 `scripts/admin/verify.mjs` 5·9번이 확인한다. 트리거 함수가 실패하면 계정 생성·비밀번호 변경 자체가 실패하므로 함수는 최소한으로 둔다.
- 기본 키가 `(user_id, …)` 로 시작하므로 RLS 조건에 인덱스가 따로 필요 없다.
- 채널 목록은 DB 가 모른다(새 채널을 열 때 DB 변경 불필요).

### 3.2 크기 추정(실측, v2 형식)

`tests/bookmarks.test.ts` 가 실제 기사(data/insurance)로 북마크를 만들고 폴더 20·태그 50을 채워 JSON 크기를 잰다. 북마크 1건은 기사 스냅샷(평균 약 600바이트) + 메타(저장·수정 시각, 폴더, 태그 3개 약 150바이트) + 메모(한글 1자 3바이트)다. 읽음 1건 약 46바이트.

| 사용 정도(채널 1개) | 북마크 | 메모 | 읽음 | 크기(JSON) |
|---|---:|---:|---:|---:|
| 가벼움 | 50 | 20자 | 300 | 약 64KB |
| 보통 | 300 | 60자 | 1,500(SOFT) | 약 358KB |
| 많음 | 1,000 | 200자(한도) | 5,000(HARD) | 약 1.6MB |

- 10명 × 채널 3개 × 보통 ≈ **11MB**, 전원 '많음'이어도 ≈ 48MB. 무료 플랜 DB 500MB 의 2~10%. jsonb 는 큰 값을 압축(TOAST)하므로 실제로는 더 작다. `profiles`·`account_security` 는 합쳐 수 KB.
- 행 크기 상한은 **4MB**(확정)다. 이 검사는 압축(TOAST) **전** jsonb 크기로 평가된다(JSON 바이트보다 약 7% 큼). 실제 기사로 잰 값(SQL 시험 환경):

| 경우 | 압축 전 크기 | 4MB 안 |
|---|---:|---|
| 화면 한도까지 채운 1기기(북마크 1,000·메모 모두 200자·읽음 5,000) | 약 1.7MB | 예 |
| 두 기기를 합친 결과(북마크 2,000·메모 모두 200자·읽음 5,000) | 약 3.1MB | 예 |
| 서버 상한(북마크 3,000·메모 평균 100자·읽음 5,000) | 약 3.7MB | 예 |
| 서버 상한(북마크 3,000·메모 모두 200자·읽음 5,000) | 약 4.6MB | 아니요(행 크기 상한이 먼저 걸림, 받아들임) |

- **egress(무료 월 5GB)가 더 빠듯하다**: 행 전체를 자주 내려받으면(10명 × 하루 30회 × 3채널 × 358KB ≈ 하루 320MB) 한도를 넘는다. 그래서 3.4 처럼 **`rev` 만 먼저 확인하고 바뀌었을 때만 행 전체를 받는다.** 올릴 때 응답도 `rev` 만 받는다. 이렇게 하면 실제로 바뀐 때만 받으므로 월 수백 MB 이하다.

### 3.3 형식(v2)과 병합 규칙

브라우저 저장 형식(`heukseok-v2:<채널>`, `docs/migration-localstorage.md` 1장)과 서버 행은 같은 모양이다 — `bookmarks`·`folders`·`tags`·`read_at`(브라우저 `readAt`)·`last_confirmed`·`companies`. 브라우저 키 이름은 5.2 표의 `heukseok-v1:` 을 `heukseok-v2:` 로 읽는다(v1 키는 읽기 전용 이전 원본).

| 항목 | 모양 |
|---|---|
| 북마크 | 기사 스냅샷(제목·링크·출처·분류·키워드·보험사·기관·발행 시각·`cluster_id?` 참고용) + `savedAt`·`updatedAt`·`lists`(담긴 목록 id, 여러 개)·`tags`(내 태그 id)·`memo`(200자)·`missing?`. 기준 키는 기사 id |
| 삭제 표시 | `{ id, channel, savedAt, updatedAt, deletedAt }` — 북마크·폴더·태그를 지우면 바로 없애지 않고 남긴다. 30일 뒤 정리 |
| 목록(열 이름 `folders`)·태그 | `{ id, name, createdAt, updatedAt, deletedAt? }`, 직접 만든 목록 3·태그 50(살아 있는 것, 새로 만들 때만). 기본 '북마크'는 저장하지 않는다(살아 있는 북마크 전부) |

| 항목 | 병합 규칙 | 삭제 전달 |
|---|---|---|
| 북마크·폴더·태그 | 같은 id 는 `updatedAt` 이 늦은 쪽(삭제 표시도 같은 기준, 같으면 이 기기). 메모·폴더·태그는 북마크 단위로 함께 | **삭제 표시로 전달된다**(기준본 필요 없음) |
| 읽음 | 합집합, 이른 시각 | 기준본 비교(아래) |
| 확인 시각 | 늦은 쪽 | — |
| 선택한 보험사 | 순서 유지 뒤 추가 | 기준본 비교(아래) |
| 그 뒤 | `pruneReads`(읽음 한도), 기한 지난 삭제 표시 정리 | |

- 브라우저 쪽 `mergeStates(cur, inc)`(가져오기·첫 연결)가 이미 위 규칙이다. 북마크·폴더·태그는 삭제 표시 덕분에 첫 연결 때도 지운 항목이 되살아나지 않는다.
- 삭제 표시가 없는 두 항목 — **'안 읽음으로' 되돌린 읽음 기록과 해제한 보험사** — 만 3-방향 병합이 필요하다. 마지막으로 서버와 맞춘 내용(기준본, `base`)을 기기에 두고 `mergeStates3(base, local, server)` 로 합친다:

| 읽음·보험사의 각 항목 | 이 기기 | 서버 | 결과 |
|---|---|---|---|
| | 있음 | 있음 | 유지(읽음은 이른 시각) |
| | 있음 | 없음 | 기준본에 있었으면 다른 기기에서 지운 것 → 삭제, 없었으면 유지 |
| | 없음 | 있음 | 기준본에 있었으면 이 기기에서 지운 것 → 삭제, 없었으면 유지 |

  북마크·폴더·태그는 `mergeStates3` 안에서도 `updatedAt` 규칙을 그대로 쓴다. 성질(테스트로 확인): `mergeStates3(b, x, b) = x`, `mergeStates3(b, b, y) = y`, 두 번 합쳐도 같다, 기준본이 없으면 `mergeStates` 와 같다.
- 시계: `updatedAt` 은 기기 시계다. 두 기기 시계가 몇 분 어긋나면 그 사이 같은 북마크를 양쪽에서 고친 경우 늦게 고친 쪽이 질 수 있다(10명 규모에서 받아들임). 서버 `updated_at` 은 행 단위라 항목 비교에는 쓰지 않는다.
- 30일 넘게 연결되지 않은 기기는 그 사이 지운 항목의 삭제 표시가 정리된 뒤라, 그 기기의 사본과 합치면 지운 항목이 되살아날 수 있다(받아들임).
- 한도는 만들 때만 검사한다. 두 기기에서 따로 만들어 합친 결과가 한도를 넘어도 지우지 않고, 한도 아래로 줄 때까지 새로 만들기만 막는다.
- **서버 상한과 화면 한도 분리(확정)**: 위 원칙이 지켜지도록 서버는 화면 한도로 막지 않고, 악용 방지용 넉넉한 상한만 둔다.

| 항목 | 화면 한도(새로 만들 때만 막음) | 서버 상한(넘으면 저장 거절, 오류 23514) |
|---|---|---|
| 채널당 북마크(지운 표시 제외) | 1,000(2026-11-13 화면에 적용) | 3,000 |
| 목록(`folders`) | 3(2026-11-13, 예전 폴더 20) | 100 |
| 태그 | 50 | 200 |
| 메모 | 200자 | 1,000자 |
| 북마크당 태그 | 10 | 50 |
| 사용자당 채널 행 | — | 10 |
| 행 크기(압축 전) | — | 4MB |

  - 메모와 북마크당 태그는 합칠 때 이어 붙지 않고 북마크 단위로 한쪽을 고르므로 화면 한도를 넘지 않는다. 서버 값은 API 를 직접 불러 한 항목을 키우는 것만 막는다.
  - 이전 값보다 늘지 않는 변경은 상한을 넘어도 통과한다(상한 위의 행에서 줄이는 변경이 막히지 않게).
  - 정상 사용으로는 서버 상한에 닿지 않으므로 동기화 쪽은 이 오류를 '동기화 실패'로만 다룬다.

### 3.4 서버와 주고받기(낙관적 동시성)

- **받기**: `select rev` → 기준본의 rev 와 같으면 끝. 다르면 `select *` 로 받아 `mergeStates3(base, local, server)` → 로컬 저장 → 결과가 서버와 다르면 올리기.
- **올리기**: `update … set (내용), rev = rev + 1 where user_id = 나 and channel = c and rev = <기준본 rev> returning rev`.
  - 1행이 바뀌면 성공 → 기준본 = 올린 내용, rev 갱신.
  - 0행이면 그 사이 다른 기기가 올린 것 → 받기부터 다시(최대 3회).
  - 행이 아예 없으면(첫 사용) `insert`. 동시에 두 기기가 insert 해서 기본 키 충돌이 나면 받기부터 다시.
- **언제**: 로그인 직후(비밀번호 변경 완료 뒤), 페이지를 열 때, 탭이 다시 보일 때(`visibilitychange`), 보이는 동안 5분마다 받기. 로컬 변경 뒤 2초 모아서(debounce) 올리기. 보내지 못한 변경은 '보낼 것 있음' 표시를 로컬에 남겨 다음 기회에 보낸다.
- 요청 수: 10명 기준 하루 수천 건 수준으로 무료 플랜 한도와 무관하다. 동기화 요청은 Auth 요청 제한(`/auth/v1/token`)에 들어가지 않는다(토큰 갱신만 들어감).

## 4. 접근 규칙(RLS)과 권한(GRANT)

### 4.1 접근 규칙

프로젝트 설정 전제(완료): Data API 의 **Automatically expose new tables 꺼짐**, **Enable automatic RLS 켜짐**. 따라서 새 표에는 역할별 권한이 자동으로 붙지 않는다고 보고, 표마다 필요한 GRANT 를 **모두 명시**한다. RLS 는 자동으로 켜지지만 SQL 에도 적어 둔다(다시 실행해도 같은 결과).

실제 SQL 은 `supabase/migrations/0001_init.sql` 의 'RLS·권한' 부분이다. 요점:

- 세 표 모두 RLS 를 켜고, `public`·`anon`·`authenticated` 의 권한을 모두 회수한 뒤 필요한 것만 준다. `service_role` 에도 표 권한을 명시한다(RLS 는 우회하지만 GRANT 는 필요).
- `profiles`·`account_security`: 본인 행 읽기 정책 하나씩. 쓰기 권한(GRANT) 없음.
- `user_state`: 읽기·만들기·고치기·지우기 정책을 따로 두고, 모두 `(select auth.uid()) = user_id and (select private.password_ready())`. `password_ready()` 는 '프로필이 있는 아이디 계정이고 비밀번호를 바꿨는가'다.

- `(select auth.uid())` 처럼 감싸면 문장당 한 번만 계산된다(공식 권장). `for all` 정책을 쓰지 않고 작업별로 나눈다(공식 권장).
- `profiles`·`account_security` 에는 authenticated 의 insert/update/delete 권한이 **GRANT 단계에서 없다**. 정책을 실수로 추가해도 권한 오류(42501)로 막힌다. 표시 이름을 사용자가 직접 update 하지 못하는 근거가 이것이다. 사용자의 표시 이름 변경은 `public.set_display_name(new_name)`(security definer, authenticated 만 실행, 0002) 한 길로만 열려 있고, 함수가 로그인·아이디 계정·비밀번호 변경 완료(`private.password_ready()` 와 같은 조건)·1~20자·제어 문자 없음·다른 사용자와 겹침 없음(공백을 빼고 소문자로 비교)·10분에 한 번을 검사한 뒤 자기 행만 바꾼다.
- `user_state` 의 `password_ready()` 조건: 비밀번호를 바꾸지 않은 계정과 프로필이 없는 계정(아이디 계정이 아닌 경우)은 동기화 자체가 거절된다(화면 게이트를 우회해도 서버 기록에 닿지 못함). 함수는 `private` 스키마에 있어 Data API 로 직접 부를 수 없다. `private` 스키마에 authenticated 의 usage 를 주는 것은 정책 안에서 이 함수를 부르기 위해서이고, 표는 두지 않는다.
- `update` 의 `with check` 가 `user_id` 를 남의 것으로 바꾸는 것을 막는다.
- SQL 은 저장소의 `supabase/migrations/0001_init.sql` 한 파일이고, 관리자가 SQL Editor 에서 실행한다(절차서 2장). CLI 마이그레이션은 쓰지 않는다(사람 10명 규모에 과함). 이후 변경은 `0002_….sql` 처럼 새 파일로 더한다.

### 4.2 권한 전체표(이 표와 실제가 같아야 한다)

| 표 | anon | authenticated | service_role |
|---|---|---|---|
| `profiles` | 없음 | select(본인 행) | 전체(RLS 우회) |
| `account_security` | 없음 | select(본인 행) | 전체(RLS 우회) |
| `user_state` | 없음 | select·insert·update·delete(본인 행, 비밀번호 변경 완료 계정만) | 전체(RLS 우회) |

실제 권한 조회(SQL Editor, 관리자):

```sql
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
 group by 1, 2 order by 1, 2;

select tablename, rowsecurity from pg_tables where schemaname = 'public';   -- 모두 true
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by 1, 3;
```

결과를 위 표와 맞춰 본다. 표가 늘면 이 절과 4.3 을 같이 고친다.

### 4.3 검증 절차(SQL 을 바꿀 때마다)

**자동화(구현됨)**: `scripts/admin/verify.mjs`(절차서 4장)가 임시 시험 계정 2개(`zz-verify-a`·`zz-verify-b`, 무작위 비밀번호)를 만들어 아래 항목 대부분과 서버 상한·관리자 초기화를 확인하고, 끝나면 지운다. 아래 표는 확인 항목의 정의다.

| # | 누구로 | 하는 일 | 기대 |
|---|---|---|---|
| 1 | A | 자기 `user_state` insert → select | 성공, 1행 |
| 2 | B | A 의 `user_state` select(`user_id = A`) | 0행 |
| 3 | B | A 의 `user_state` update | 0행 바뀜 |
| 4 | B | `user_id = A` 로 insert | RLS 위반 오류 |
| 5 | B | 자기 행의 `user_id` 를 A 로 update | RLS 위반 오류 |
| 6 | B | A 의 `user_state` delete | 0행 |
| 7 | 로그인 없음(publishable 키만) | 세 표 select·insert | 모두 `42501` |
| 8 | A | 서버 상한(3.3) 초과 update / 화면 한도를 넘는 합친 결과 update | check 위반 / 성공 |
| 9 | A | `profiles` 자기 행 select / B 의 행 select | 1행 / 0행 |
| 10 | A | `profiles.display_name` update, `profiles` insert·delete | 모두 `42501` |
| 11 | A | `account_security` 자기 행 select / `must_change_password` update | 1행(false) / `42501` |
| 12 | C(변경 전) | `user_state` insert·select | RLS 위반 / 0행 |
| 13 | C | `updateUser` 로 비밀번호 변경 → `account_security` select → `user_state` insert | true → false 로 바뀜 → 성공(트리거 확인) |
| 14 | C | 같은 비밀번호로 다시 변경 | `same_password` |
| 15 | A | `rpc('password_ready')` 등 private 함수 직접 호출 | 찾을 수 없음(노출 안 됨) |
| 16 | A·C | 끝나면 자기 `user_state` 행 delete | 성공 |

- `verify.mjs` 에서 C 의 역할은 A 가 비밀번호를 바꾸기 전 단계가 맡고, 관리자 초기화 뒤 다시 막히는지도 확인한다.
- 보조 수단: SQL Editor 의 역할 전환(impersonation)으로 같은 조회를 해 본다. SQL Editor 기본 연결은 `postgres` 역할이라 RLS 를 우회하므로, 기본 상태의 결과를 검증으로 삼지 않는다.

## 5. 저장소 어댑터 연결

### 5.1 원칙: 로컬 우선

- 화면은 지금처럼 **동기적으로** localStorage 사본을 읽고 쓴다(클릭 즉시 반영, 오프라인에서도 동작).
- 서버 동기화는 뒤에서 따로 돈다(`lib/sync.ts`). 서버가 느리거나 멈춰도 화면은 막히지 않는다.
- `UserStateStore` 인터페이스(`load`/`save`)는 그대로 두고, 원격 변경을 알리는 선택 메서드 하나만 더한다.

```ts
export interface UserStateStore {
  load(channel: string, legacy?: LegacyKeys): UserState;
  save(channel: string, state: UserState): void;
  /** 동기화로 저장 내용이 바뀌면 알림(같은 탭은 이벤트, 다른 탭은 storage 이벤트). */
  subscribe?(channel: string, onChange: () => void): () => void;
}
```

- `accountStore(userId)`: 같은 localStorage 를 쓰되 키에 사용자 id 를 붙이고, `save` 할 때 `sync.markDirty(channel)` 을 부른다.
- `useSaved` 는 `subscribe` 로 받은 알림에 다시 `load` 한다. 로그인 기능이 꺼진 빌드는 지금의 `localStorageStore` 그대로.

### 5.2 브라우저 저장 키

| 키 | 내용 | 언제 |
|---|---|---|
| `heukseok-v1:<채널>` | 로그인 전·로그인 기능 없던 때의 기록(지금 사용자 데이터) | 읽기만. 지우지 않는다 |
| `actuary-news-hub-v3` 등 옛 키 | 옛 사이트 기록 | 위 키가 없을 때 읽기만(지금과 같음) |
| `heukseok-v1:<채널>@<사용자 id>` | 이 계정의 로컬 사본(화면이 읽고 쓰는 곳) | 로그인 중. 로그아웃 때 삭제 |
| `heukseok-sync-v1:<채널>@<사용자 id>` | 기준본(마지막으로 서버와 맞춘 내용)·rev·보낼 것 있음 표시 | 로그인 중. 로그아웃 때 삭제 |
| `heukseok-account-v1@<사용자 id>` | `{ displayName, mustChange, checkedAt }` — 게이트·메뉴용 사본 | 로그인 중. 로그아웃 때 삭제 |
| `heukseok-claimed-v1:<채널>` | 로그인 전 기록을 어느 계정에 합쳤는지(`{ userId, at }`) | 합친 뒤 |
| `heukseok-login-id` | 저장한 아이디 | '아이디 저장' 체크 시 |
| `sb-<ref>-auth-token` | supabase 세션 | supabase-js 가 관리 |

`heukseok-account-v1` 의 `mustChange` 는 화면 이동용 사본일 뿐이다. 이 값을 고쳐도 서버는 `account_security` 를 기준으로 동기화를 거절한다(4.1).

### 5.3 기존 기록 올리기(첫 로그인)

1. 비밀번호 변경까지 끝난 뒤, 이 브라우저의 로그인 전 기록(`heukseok-v1:<채널>`, 없으면 옛 키)이 비어 있지 않고 `claimed` 표시가 없으면 한 번 묻는다:
   "이 브라우저에 저장된 기록(북마크 N건, 읽음 N건)을 내 계정에 합칠까요? [합치기] [나중에]"
   — 내 데이터 화면의 가져오기 미리보기(건수 표)를 그대로 쓴다.
2. [합치기] → `mergeStates(계정 사본, 로그인 전 기록)` → 계정 사본 저장 → 올리기 → `claimed` 기록. 원본 키는 지우지 않는다(되돌릴 수 있게).
3. [나중에] → 내 데이터 화면에 '이 브라우저의 이전 기록 합치기' 버튼으로 남긴다.
4. 묻는 이유: 같은 컴퓨터를 여러 사람이 쓰면 남의 기록이 내 계정에 섞일 수 있다.

### 5.3-1 구현(2026-11-13)

- 파일: `lib/syncMerge.ts`(행 변환·`mergeStates3`·해시), `lib/sync.ts`(한 번 맞추기, 저장소·서버 주입), `lib/syncBackend.ts`(Supabase, 본인 `user_id` 조건 + RLS, 15초 시간 제한), `lib/syncManager.ts`(언제 돌릴지·재시도), `lib/storage.ts` `accountStore`·`activeUserId`, `lib/claim.ts`·`lib/claimRun.ts`·`components/ClaimPrompt.tsx`(합치기), `components/SyncNote.tsx`(상태). 테스트 `tests/sync.test.ts`.
- 기준본은 크기를 줄이려고 rev·내용 해시·읽음 id·보험사만 둔다(rev 가 같으면 서버 내용 = 마지막으로 맞춘 내용이므로 해시로 올릴지 정한다).
- 치운 기사(`dismissed`)는 서버 열이 없어 기기 사본에만 둔다.
- 로그아웃해도 계정 사본·기준본은 지우지 않는다(보내지 못한 변경이 있으면 잃지 않게). 로그아웃 상태 화면은 로그인 전 기록을 읽으므로 섞이지 않는다.
- SQL 변경 없음(jsonb 안의 필드만 늘었다: `lists`, `cluster_id`).

### 5.4 동기화 상태 표시(최소)

| 상태 | 표시 위치 | 문구 |
|---|---|---|
| 맞춰짐 | 내 데이터 | 모든 기기에 저장됨 · 마지막 동기화 11. 12. 09:30 |
| 보내는 중 | (표시 안 함) | — |
| 실패·오프라인 | 내 데이터 + 헤더 이름 옆 작은 점 | 이 기기에만 저장됨 · 연결되면 자동으로 보냅니다 |
| 세션 만료 | 로그인 화면으로 이동 | — |

실패해도 화면 사용은 막지 않는다. 같은 오류가 반복되면 `console.error` 에만 남긴다.

## 6. 계정 발급

### 6.1 처음 한 번(관리자, 대시보드)

| # | 설정 | 상태 |
|---|---|---|
| 1 | 프로젝트 만들기, 리전 **Seoul(ap-northeast-2)**, DB 비밀번호는 비밀번호 관리자에만 | ✅ 완료 |
| 2 | Authentication → Sign In / Providers: Email provider 켜 둠(끄면 비밀번호 로그인 자체가 막힘) | ✅ 완료(로그인에 필요) |
| 3 | **Allow new users to sign up: 끔** — 기존 계정만 로그인. 관리자 생성은 영향받지 않는다(서버 소스 확인) | ✅ 완료 |
| 4 | **Confirm email: 끔**(메일을 보낼 수 없는 주소) | ✅ 완료 |
| 5 | 비밀번호 최소 길이 **8** | ✅ 완료 |
| 6 | URL Configuration → Site URL `https://heukseoknews.github.io` | ✅ 완료 |
| 7 | Data API: Automatically expose new tables **꺼짐**, Enable automatic RLS **켜짐** | ✅ 완료 |
| 8 | **Require current password: 켬**, **Secure password change: 끔**(2.5) | ✅ 완료 |
| 9 | 비밀번호 필수 문자 규칙: **끔으로 둠**(학번 초기 비밀번호를 허용하려면, 2.5) | ☐ 확인(계정 생성 때 `weak_password` 가 나면 이 설정, 절차서 11장) |
| 10 | Authentication → Rate Limits: 토큰 한도 5분 30회(7.2) | ✅ 완료 |
| 11 | Settings → API Keys: publishable 키 확인, secret 키 `admin_script` 따로 만들기(맥의 `~/.heukseok/supabase.env`), **구 anon·service_role 키 비활성화**(1.4) | ✅ 완료 |
| 12 | GitHub 저장소 Variables 에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 등록 | ☐ 남음 |
| 13 | SQL Editor 에서 `supabase/migrations/0001_init.sql` 실행 → 확인 쿼리(절차서 2장) → `check`·`verify`(3·4장) | ☐ 남음(SQL 작성 완료) |
| 14 | 본인(관리자) 계정 만들기(절차서 5장) — **SQL 실행 뒤에** 만들어야 프로필이 자동으로 생긴다. 시험 계정은 `verify` 가 만들고 지운다 | ☐ 남음 |

### 6.2 계정 만들기(사용자마다)

- 정보: 아이디(2.2 형식), 표시 이름(실명·별명 자유, 1~20자, 다른 사람과 겹치지 않게), 학번. 관리자 맥의 `~/.heukseok/accounts.csv`(열 `login_id,display_name,student_no`)에만 두고 저장소·메모에는 쓰지 않는다.
- **초기 비밀번호(확정)**: 각자의 **학번**. 첫 로그인에서 반드시 바꾼다(화면 강제 + 서버 동기화 거절). 학번은 같은 반 사람이 알 수 있으므로, 계정은 로그인 화면이 배포된 **직후** 만들고 건네자마자 첫 로그인을 하게 한다. 관리자는 `list` 의 '비밀번호' 열로 바꿨는지 확인한다. 학번이 8자 미만이면 쓸 수 없다(서버 최소 8자).
- **방법 — 스크립트**: `create --apply` 한 번으로 CSV 의 모든 계정·표시 이름·'변경 필요'가 정해진다(6.3). 이미 있는 아이디는 건너뛴다.
- 대시보드에서 직접 만들지 않는다(표시 이름이 비고, 이메일 형식을 틀리면 프로필이 생기지 않는다). 만들었다면 지우고 스크립트로 다시 만든다(절차서 11장).

### 6.3 관리 스크립트(관리자 PC 에서만)

`scripts/admin/users.mjs`(구현됨, 사용법은 절차서). 모두 기본이 모의 실행이고 `--apply` 를 붙여야 반영된다. 비밀 키는 `~/.heukseok/supabase.env` 에서, 프로젝트 주소는 `SUPABASE_URL` 또는 `--url` 로 받는다.

```
node scripts/admin/users.mjs check                        # 키·주소·SQL 적용·anon 차단 확인(읽기만)
node scripts/admin/users.mjs create [--apply]             # ~/.heukseok/accounts.csv 일괄 생성(초기 비밀번호 = 학번)
node scripts/admin/users.mjs reset-password <아이디> [--apply]  # 학번으로 다시 초기화 + '변경 필요' 켬
node scripts/admin/users.mjs list                         # 아이디·표시 이름·비밀번호 변경 여부·상태·마지막 로그인
node scripts/admin/users.mjs disable|enable <아이디> [--apply]  # 사용 중지·다시 사용
node scripts/admin/verify.mjs [--apply]                   # 보안 자동 검증(4.3)
```

- `create`: Auth 관리 API 로 이메일 `<아이디>@users.heukseok.invalid`, 비밀번호 = 학번, `email_confirm: true`, `app_metadata: { login_id, display_name }` → 트리거가 프로필·'변경 필요'를 만듦 → 다시 읽어 확인.
- `reset-password`: ① `reset_pending = true` ② 비밀번호를 학번으로(트리거가 `reset_pending` 을 보고 '변경 필요' 유지) ③ `must_change_password = true` 를 한 번 더 쓰고 ④ 다시 읽어 확인. ②가 실패하면 ①을 되돌린다.
- 출력에 학번·비밀번호·키·토큰은 나오지 않는다([가림]).

### 6.4 비밀번호 초기화·표시 이름 변경·계정 삭제

- 비밀번호를 잊으면: 관리자에게 말한다 → 관리자가 `reset-password`(학번으로 초기화) → 사용자는 학번으로 로그인하자마자 변경 화면으로. 메일 재설정은 쓰지 않는다.
- 표시 이름: 사용자가 마이페이지 → 계정에서 직접 바꾼다(0002 적용 뒤). 오류는 한 줄 — '이미 쓰는 이름입니다' / '20자 이하로 정해 주세요' / '잠시 뒤에 다시 바꿀 수 있습니다'(10분) / '로그인이 필요합니다'. 0002 를 적용하기 전에는 저장할 때 '아직 준비 중' 안내만 보인다. 관리자가 대신 바꿀 때는 SQL Editor 에서 `profiles.display_name` 을 고친다(이때는 10분 제한·겹침 검사가 함수 밖이라 unique 제약만 적용).
- 잠시 막기: `disable`(되돌리기 `enable`).
- 삭제 요청: 대시보드 Users → 사용자 삭제. `on delete cascade` 로 세 표의 행이 함께 지워진다(절차서 10장).

## 7. 보안·개인정보 점검 목록

### 7.1 비밀번호

- [x] 서버 최소 8자(설정 완료).
- [ ] **첫 로그인 강제 변경**(2.5) — 서버 최소 길이가 짧은 것을 보완하는 핵심 장치. 화면 게이트 + 서버 동기화 거절(4.1) 두 겹.
- [ ] 화면에서 새 비밀번호 규칙 검사: 8자 이상, 영문+숫자, 아이디 미포함.
- [ ] 초기 비밀번호는 학번(확정). 로그인 화면 배포 직후 만들고 바로 첫 로그인, 관리자가 `list` 로 변경 여부 확인(6.2).
- [ ] 유출 비밀번호 차단(HaveIBeenPwned)은 Pro 전용이라 없음 → 변경 화면에 "다른 사이트에서 쓰는 비밀번호는 피해 주세요." 한 줄.

### 7.2 무차별 대입

- 기본 한도: `/auth/v1/token`(비밀번호 로그인 + 토큰 갱신) IP 당 5분 150회. 계정 단위 잠금은 공식 문서에서 찾지 못했다(없다고 보고 설계).
- [ ] Rate Limits 에서 토큰 한도를 **5분 30회**로 낮춘다(10명이 정상 사용으로 닿지 않는 값. 토큰 갱신도 여기에 들어가므로 너무 낮추지 않는다).
- [ ] CAPTCHA(Cloudflare Turnstile, hCaptcha)는 지원되지만 처음에는 켜지 않는다. 감사 로그(무료 1시간 보관)·사용량 그래프에서 이상 시도가 보이면 켠다(단계 5).
- [ ] 아이디는 짐작 가능하다고 본다. 그래서 초기 비밀번호가 살아 있는 기간(발급~첫 로그인)을 짧게 한다.

### 7.3 무료 플랜 일시 중지·백업 부재

- 7일 동안 활동(DB 요청·API 호출·대시보드 방문)이 적으면 프로젝트가 멈춘다. 멈추기 약 1주 전과 멈춘 뒤 소유자에게 메일이 온다. 대시보드 "Resume project" 로 데이터 그대로 복구(정지 후 1년까지).
- 멈춘 동안(장애도 같음, 확정): 이미 로그인한 기기는 기사 읽기와 이 기기의 북마크가 그대로 동작하고 **동기화만 멈춘다**(연결되면 다시 보냄). **새 로그인은 불가**다.
- [ ] 사용자 10명이 매일 쓰면 멈출 일은 거의 없다. 방학 등을 대비해 관리자가 정지 예고 메일을 받으면 대시보드를 한 번 연다. (자동 유지 요청을 Actions 로 보내는 방법은 '어떤 요청이 활동으로 잡히는지' 공식 기준이 모호해 기본안에서 뺀다.)
- [ ] 자동 백업 없음(무료) → 관리자가 월 1회 `supabase db dump --data-only -f <저장소 밖 경로>`(공식 CLI) 또는 `export` 명령(아직 없음, 10.1). 각 사용자도 내 데이터 → 파일로 내려받기(지금 기능 유지)로 스스로 백업할 수 있다.

### 7.4 저장하는 개인정보(최소화)

| 항목 | 어디 | 비고 |
|---|---|---|
| 아이디(가짜 이메일 형태) | Supabase Auth | 실제 이메일·연락처 받지 않음 |
| 표시 이름 | `profiles` | 관리자가 입력. 실명·별명 자유 |
| 비밀번호 해시 | Supabase Auth | 운영자도 원문을 볼 수 없음. 학번을 초기 비밀번호로 썼어도 해시로만 남고 첫 로그인 때 바뀐다 |
| 비밀번호 변경 필요 여부·바꾼 시각 | `account_security` | |
| 마지막 로그인 시각, 세션의 IP·브라우저 정보 | Supabase Auth | Supabase 가 보안 목적으로 남김(감사 로그 무료 1시간) |
| 채널별 북마크·읽은 기사와 시각·새 뉴스 확인 시각·선택한 보험사 | `user_state` | 사이트 기능에 필요한 것만 |

- 분석·광고 스크립트 없음(지금과 같음). `user_metadata`(사용자가 고칠 수 있는 영역)에 아무것도 넣지 않는다.
- 공개 저장소 규칙: 실제 아이디·표시 이름 목록, 학번, 사용자 수 이외의 정보를 문서·코드·커밋 메시지에 쓰지 않는다.

### 7.5 화면·코드

- [ ] `next` 파라미터 검증(열린 리디렉트 방지, 2.2).
- [ ] 동기화로 받은 북마크도 지금 가져오기와 같은 정리(`cleanState`)를 거친 뒤 화면에 쓴다(링크는 기존 `isSafeUrl` 검사 유지).
- [ ] 표시 이름은 React 텍스트로만 그린다(HTML 해석 금지).
- [ ] 비밀값 검사 테스트·배포 검사(1.4).
- [ ] GitHub Pages 는 응답 헤더를 못 바꾸므로 CSP 는 `<meta http-equiv="Content-Security-Policy">` 로만 가능 — `connect-src 'self' https://<프로젝트 ref>.supabase.co` 를 단계 5 에서 검토(인라인 스크립트가 있어 hash 기반이어야 함).

### 7.6 개인정보 안내(푸터 한두 줄)

긴 처리방침 문서·별도 안내 페이지는 만들지 않는다. 푸터 맨 아래(저작권 줄 위)와 로그인 화면 카드 아래에 같은 두 줄을 둔다.

> 저장하는 정보는 아이디·표시 이름과 북마크·읽음 기록뿐이며, 광고·방문 분석 도구는 쓰지 않습니다.
> 계정과 기록 삭제는 운영자에게 요청해 주세요.

- '읽음 기록'에 새 뉴스 확인 시각과 선택한 보험사(화면 설정)도 포함해 읽힌다고 본다. 더 정확히 쓰려면 "북마크·읽음 기록과 화면 설정"(12장 미정 5).
- 로그인 시각·접속 정보가 Supabase 보안 로그에 짧게(무료 1시간) 남는 것은 서비스 운영 기록이므로 푸터에는 쓰지 않고 이 문서(7.4)에만 둔다.

## 8. 화면 영향

- **로그인 화면 `/login/`**: 가운데 카드 1개(폭 360px) — 워드마크(높이 44px) → 아이디 → 비밀번호 → '아이디 저장' 체크 → [로그인] 버튼 → 오류 줄(`role="alert"`) → 카드 아래 개인정보 두 줄(7.6). 채널 색을 쓰지 않는 중립 색: 버튼 바탕 `--text`(#16202B, 흰 글자 16.5:1), 포커스 2px `--text`. 바탕 `--bg`, 카드 `--surface`, 테두리 `--line`, 입력 테두리 `--line-strong`(3.6:1). 홈과 같은 위 테두리 3px `--text`. 키보드: 아이디 칸 자동 포커스(저장된 아이디가 있으면 비밀번호 칸), Enter 로 제출, 제출 중 버튼 비활성.
- **비밀번호 변경 `/account/password/`**: 로그인 화면과 같은 카드. 현재 비밀번호 → 새 비밀번호 → 새 비밀번호 확인 → [바꾸기] → 오류 줄. 강제 변경일 때는 아래에 '로그아웃'만, 본인 변경일 때는 '취소'. 규칙은 칸 아래 한 줄("8자 이상, 영문과 숫자를 섞어 주세요.").
- **홈 상단 줄**: 지금 오른쪽 '내 데이터' 자리에 **계정 메뉴**(사람 아이콘 + 표시 이름 ▾) → 첫 줄 '아이디 kim'(회색) · 내 데이터 · 비밀번호 변경 · 로그아웃.
- **채널 헤더**: 보조 메뉴의 '내 데이터' 뒤에 같은 계정 메뉴. 모바일(≤640px)은 햄버거 메뉴 안 맨 아래에 '표시 이름 · 로그아웃' 줄. 동기화 실패면 이름 옆 작은 점(5.4).
- **내 데이터**: 안내 문구를 "북마크·읽음 기록·새 뉴스 확인 시각·선택한 보험사는 계정에 저장되어 로그인한 모든 기기에서 같습니다." 로 바꾸고 동기화 상태 한 줄을 더한다. 파일 백업·복원은 그대로 둔다(가져오기는 계정 사본과 합친 뒤 올림). '이 브라우저의 이전 기록 합치기' 버튼(5.3).
- **`/account/`**: 아이디·표시 이름(읽기 전용, 바꾸려면 운영자에게), '비밀번호 변경', '이 기기에서 로그아웃', '다른 기기에서 모두 로그아웃'.
- **푸터**: 개인정보 두 줄(7.6).
- 토큰은 지금 `globals.css` 의 `:root` 토큰만 쓴다. 새 색 없음.

## 9. 테스트 계획

### 9.1 자동(npm test, 로그인 없이 돌아감)

| 대상 | 내용 |
|---|---|
| `mergeStates3` | 3.3 표의 모든 칸, 성질 4개(기준본=서버면 로컬 그대로 등), 읽음 한도 적용, 보험사 순서 |
| `lib/sync.ts`(가짜 Supabase 클라이언트) | rev 같음 → 받지 않음 / 다름 → 병합·올림 / 올리기 0행 → 다시 받기(최대 3회) / insert 충돌 / 네트워크 오류 → 보낼 것 표시 유지 / 로그아웃 시 사용자 키 삭제 / 다른 사용자 키와 섞이지 않음 / 비밀번호 변경 전에는 동기화를 시작하지 않음 |
| 첫 로그인 합치기 | 로그인 전 기록 있음·없음·이미 claimed, 옛 키만 있음 |
| 로그인 게이트 스크립트 | 토큰 없음 → `/login/?next=`(해시 보존) / 토큰 있고 계정 사본 `mustChange: true` 또는 사본 없음 → `/account/password/?next=` / 둘 다 통과 → 그대로 / `/account/password/` 자체는 변경 전에도 통과 / `next` 검증(외부 주소·`//`·`/login`·`/account/password` 거절) |
| 비밀번호 변경 폼 | 8자 미만·영문만·숫자만·아이디 포함·불일치 거절, 서버 오류 코드별 문구(2.6), 성공 후 계정 사본 갱신·`next` 이동 |
| 아이디 → 이메일 | 형식 검사, 소문자화, 공백 제거 |
| 비밀값 검사 | 1.4 자동 검증 세 줄 |
| 로그인 기능 꺼진 빌드 | 환경 변수 없으면 게이트·메뉴·푸터 안내 없음, 지금과 같은 화면(기존 동등성 검사 통과) |

### 9.2 수동·반자동

- RLS·GRANT: 4.2 권한 조회 + 4.3 절차(`scripts/admin/verify.mjs`, 임시 시험 계정 2개). SQL 을 바꿀 때마다.
- Playwright(결과는 /tmp): 로그인 안 한 상태로 `/`·`/insurance/`·`/ai/` → `/login/`(noindex) / 초기 비밀번호로 로그인 → 변경 화면으로 강제 이동, 주소창에 `/insurance/` 를 직접 쳐도 변경 화면으로 / 변경 후 홈 / 아이디 저장 / 틀린 비밀번호 문구 / 로그아웃 후 사용자 키 삭제 / 두 브라우저(같은 계정)에서 북마크 추가·삭제가 서로 전달 / 오프라인 중 변경 → 복구 후 전달 / 1440·390px 캡처.
- 보안 점검: 7장 체크리스트, 1.4 수동 검증, 로그인 연속 실패로 429 문구 확인.

### 9.3 끄기 스위치

- 로그인 전체를 끄기: GitHub Variables 에서 두 값을 지우고(또는 `NEXT_PUBLIC_AUTH=off`) 배포 → 지금 사이트로 돌아감. 사용자 기기의 `heukseok-v1:<채널>@<id>` 사본은 남아 있으므로, 끈 동안에는 로그인 전 키(`heukseok-v1:<채널>`)를 쓴다(그동안 변경은 다시 켤 때 5.3 으로 합칠 수 있음).
- 동기화만 끄기: `NEXT_PUBLIC_SYNC=off` → 로그인은 유지, 계정 사본으로 로컬만 동작.

## 10. 단계별 구현안

각 단계는 별도 커밋. 앞 단계가 끝나야 다음 단계로 간다. 강제 비밀번호 변경이 `account_security` 표를 쓰므로 표·권한을 로그인 화면보다 먼저 만든다.

| 단계 | 내용 | 완료 기준 | 되돌리기 |
|---|---|---|---|
| **0. 준비** (사용자) | 6.1 의 남은 항목 8~12 | 설정 확인, Variables 2개 | 설정 원복 |
| **1. 표·권한·검사** (Claude 작성 완료, 사용자가 실행) | `supabase/migrations/0001_init.sql`, `scripts/admin/users.mjs`(check·create·reset-password·list·disable·enable), `scripts/admin/verify.mjs`, `docs/auth-runbook.md` | 확인 쿼리가 4.2 권한표와 일치, `check`·`verify` 모두 통과, 본인 계정 생성 | `drop table` 세 개 + 트리거·함수 삭제 SQL(같이 작성) |
| **2. 로그인·강제 변경·세션** (Claude) | `@supabase/supabase-js` 추가, `lib/supabase.ts`·`lib/auth.ts`, 게이트 스크립트, `/login/`, `/account/password/`, `/account/`, 홈·헤더 계정 메뉴, 푸터 안내, 비밀값 검사 테스트, deploy.yml 변수 전달·`out/` 검사 | 9.1 게이트·폼·아이디 테스트, 4.3 의 13·14 통과(트리거 실측), `.invalid` 계정으로 실제 로그인·강제 변경 성공(호스팅 실측), Playwright 로그인 흐름, 기존 동등성 검사 통과 | Variables 삭제 후 배포(코드 그대로 꺼짐), 또는 커밋 revert |
| **3. 동기화** (Claude) | `mergeStates3`, `lib/sync.ts`, `accountStore`, `useSaved` 구독, 첫 로그인 합치기, 상태 표시, 로그아웃 시 정리 | 9.1 동기화 테스트, 4.3 의 16 까지 전체 통과, 두 브라우저·오프라인 시험, 1주 사용 중 데이터 유실 신고 없음 | `NEXT_PUBLIC_SYNC=off` |
| **4. 운영** (Claude, 일부 사용자) | 관리 스크립트 나머지(`set-name`·`export`), 내 데이터 문구, docs 갱신(architecture·ops-notes) | 관리자 백업 1회 실행, 1.4 수동 검증 1회 | 커밋 revert |
| **5. 다듬기** (선택) | Rate limit 조정 확인, CAPTCHA 검토, CSP meta 검토 | 7장 체크리스트 완료 | 설정 원복 |

**사용자(관리자)가 직접 하는 일**

- 완료: Supabase 프로젝트(서울 리전), 가입 허용 끔, 이메일 확인 끔, 비밀번호 최소 8자, Site URL, 새 표 자동 노출 끔·자동 RLS 켬, 현재 비밀번호 요구 켬·재인증 메일 끔, 토큰 요청 한도 5분 30회, secret 키 `admin_script` 생성과 구 키 비활성화.
- 남음: 6.1 의 9(필수 문자 규칙 끔 확인)·12(GitHub Variables)·13(SQL 실행·`check`·`verify`)·14(본인 계정).
- 운영: 계정 발급(로그인 화면 배포 직후, 학번 초기 비밀번호), `list` 로 변경 여부 확인, 정지 예고 메일 확인, 월 1회 백업, 분기 1회 키 점검(1.4), 표시 이름 변경·삭제 요청 처리.

### 10.1 남은 일

| 누가 | 일 |
|---|---|
| 관리자 | 6.1 의 9·12·13·14(절차서 2~5장 순서) |
| 세션 A(화면) | 단계 2(로그인·강제 변경·세션), 단계 3(동기화) |
| 세션 A(화면) | **화면 북마크 한도 채널당 1,000건** 추가 — 지금 `lib/bookmarks.ts` 의 `LIMITS` 에 북마크 수 한도가 없다. 폴더·태그처럼 새로 만들 때만 막고, 합친 결과는 줄이지 않는다(3.3) |
| 세션 A(화면) | 동기화가 서버 상한 오류(23514)를 받으면 '동기화 실패'로 처리 |
| Claude(관리 스크립트) | 단계 4 의 `set-name`·`export` |

**Claude Code 가 하는 일**: 코드·테스트·문서, SQL·검사 스크립트·관리 스크립트 작성(실행은 관리자), 배포 확인. secret 키·계정 파일은 읽지 않고, 실제 Supabase 에 요청하지 않는다.

## 11. 확장 지점(다음 단계, 방향만)

- **외부 로그인(카카오 등)**: 지금은 쓰지 않는다. 붙일 때를 위해 지금 지키는 것 — 모든 사용자 데이터를 이메일이 아니라 Supabase 사용자 id(`auth.users.id`)에 묶는다, 로그인 방법은 `lib/auth.ts` 에만 둔다, 표시 이름은 `profiles` 에 따로 둔다. 붙이는 방법은 가입을 닫은 채로 **기존 아이디 계정에 외부 계정을 연결**(`linkIdentity`, 대시보드에서 manual linking 켜기)하는 방식으로 한다 — 같은 사용자 id 를 유지하므로 북마크·표시 이름이 그대로다. 이때 콜백 경로(`/auth/callback/`)에서만 `detectSessionInUrl` 을 켜고, Redirect URLs 에 그 주소를 등록한다.
- **표시 이름 공개**: 댓글·채팅을 열 때 `profiles` 의 select 정책을 "로그인 사용자 전체"로 넓힌다(`using (true)` to authenticated). `account_security` 는 계속 본인만. `auth.users` 는 노출하지 않는다.
- **댓글**: `comments(id bigint identity pk, channel text, article_id text /* 16자리 기사 id */, user_id uuid default auth.uid(), body text check (char_length(body) between 1 and 1000), created_at timestamptz default now(), deleted_at timestamptz)`, 인덱스 `(channel, article_id, created_at)`. 화면에는 `profiles.display_name` 을 붙여 보인다. RLS: select 는 authenticated 전체(`deleted_at is null`), insert 는 `user_id = auth.uid()` 이고 `password_ready()`, update(본문 수정·삭제 표시)는 본인만, 실제 delete 는 관리자만. 같은 기사가 다른 채널에도 있을 수 있어 키는 `(channel, article_id)`.
- **전체 채팅방**: `chat_messages(id bigint identity pk, user_id uuid default auth.uid(), body text check (char_length(body) between 1 and 500), created_at timestamptz default now())`. 최근 것만 보관 — 넣을 때 트리거로 최근 500건(또는 30일)만 남긴다. 실시간은 Supabase Realtime(Postgres Changes 또는 Broadcast). 무료 한도: 동시 연결 200, 월 메시지 200만, 초당 100 — 10명에게 충분. RLS: select·insert 는 authenticated(insert 는 `password_ready()`), update 없음, delete 는 본인·관리자.
- 공통: 모든 표는 `revoke all … from public, anon, authenticated` 후 필요한 권한만 `grant`(service_role 포함 명시), 작업별 정책, `(select auth.uid())`, 4.2 권한표와 4.3 검사 항목을 같이 늘린다. 글 내용은 React 텍스트로만 그린다(HTML 해석 금지). 신고·차단은 10명 규모라 관리자가 대시보드에서 처리.

## 12. 결정 사항

### 확정

| 항목 | 결정 |
|---|---|
| 사이트 첫 화면 | 로그인 화면이 먼저. 화면상의 안내 장벽이고 기사 데이터는 공개 그대로(0장·2.2) |
| 로그인 서버 장애·정지 | 이미 로그인한 사람은 기사 읽기와 기기 북마크가 그대로, 동기화만 멈춤. 새 로그인은 서버가 돌아올 때까지 불가(7.3) |
| 초기 비밀번호 | 각자의 학번, 첫 로그인에서 반드시 변경(화면 강제 + 서버 동기화 거절). 계정은 로그인 화면 배포 직후 만든다(6.2) |
| 계정 목록 | 관리자 맥의 `~/.heukseok/accounts.csv` 에만. 저장소에 두지 않는다 |
| secret 키 | `admin_script` 키, 관리자 맥의 `~/.heukseok/supabase.env` 에만(1.4) |
| 내부 이메일 | `<아이디>@users.heukseok.invalid` |
| 표시 이름 | 처음엔 관리자가 정함. 사용자는 마이페이지 → 계정에서 `set_display_name`(0002)으로만 변경 — 1~20자, 대소문자·공백만 다른 이름도 겹침으로 거절, 10분에 한 번. profiles 직접 고치기는 계속 막힘 |
| 토큰 요청 한도 | 5분 30회(7.2) |
| 상한 | 실제 사용 한도(북마크 1,000·폴더 20·태그 50·메모 200자·북마크당 태그 10)는 화면에서만. 서버는 악용 방지용(북마크 3,000·폴더 100·태그 200·메모 1,000자·북마크당 태그 50·채널 행 10)(3.3) |
| 행 크기 상한 | 4MB(3.2) |
| SQL 위치 | `supabase/migrations/0001_init.sql` 한 파일, SQL Editor 에서 실행 |

### 미정

1. **검색 노출**: 로그인 화면이 먼저 나오므로 자바스크립트를 실행하는 검색 로봇은 로그인 화면(noindex)만 보게 되어 사실상 검색에서 빠진다. 그대로 둘지(기본안), 채널 페이지를 명시적으로 noindex 할지.
2. **첫 로그인 합치기**를 묻고 합칠지(기본안), 묻지 않고 자동으로 합칠지.
3. **새 비밀번호 화면 규칙**: 8자 이상 + 영문·숫자 + 아이디 미포함(기본안) 또는 8자 이상만.
4. **수집 상태 페이지**(`/<채널>/status/`)도 로그인 뒤에 둘지(기본안: 다른 페이지와 같이 로그인 필요).
5. **푸터 문구**: "아이디·표시 이름과 북마크·읽음 기록뿐"(기본안, 확인 시각·보험사 선택을 읽음 기록에 포함해 읽음) 또는 "…북마크·읽음 기록과 화면 설정".
6. **헤더 메뉴 이름**: 표시 이름을 보일지(기본안, 메뉴 첫 줄에 아이디) 아이디를 보일지.
