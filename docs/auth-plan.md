# 로그인·동기화 설계 (Supabase)

> 상태: 설계안(2026-11-12, 추가 결정 반영). 코드는 아직 없다. 구현은 10장의 단계 순서로 한다.
> 근거: Supabase 공식 문서·가격표, 공식 저장소(supabase/auth, supabase-js) 소스. 공식 문서에서 확인하지 못한 것은 **(미확인)** 으로 적었고, 구현 단계에서 실측해 확정한다.
> 문서 안의 키·비밀번호·주소는 모두 자리표시자다(`<프로젝트 ref>`, `<publishable 키>` 등). 실제 값은 저장소에 쓰지 않는다.

## 0. 요약

- **구성**: 사이트는 지금처럼 정적 export(GitHub Pages)다. 브라우저가 `@supabase/supabase-js` 로 Supabase Auth(로그인)와 Postgres(사용자 상태·프로필)에 직접 붙는다. 서버 코드는 없다.
- **로그인 방식**: 아이디형 계정만 쓴다. 카카오 등 외부 로그인은 쓰지 않는다. 나중에 병행 추가할 수 있게 계정 식별을 Supabase 사용자 id 에 묶고 로그인 방법을 `lib/auth.ts` 한 곳에 모은다(11장).
- **계정**: 관리자가 만든다. 가입은 닫혀 있다. 아이디 `kim` → 내부 이메일 `kim@users.heukseok.invalid`(메일을 보내지 않는 경로만 쓴다). 표시 이름(댓글·채팅에 보이는 이름)은 아이디와 따로, 관리자가 정하고 사용자는 바꾸지 못한다.
- **첫 로그인**: 초기 비밀번호(무작위 또는 학번)로 로그인하면 **비밀번호 변경 화면으로 강제 이동**하고, 바꾸기 전에는 다른 화면에 들어갈 수 없다. 서버 최소 길이가 8자이므로 이것이 핵심 보완 장치다(2.5).
- **화면**: 처음 접속하면 `/login/`(noindex) → 로그인 후 홈. 로그인 여부는 브라우저에서 검사한다. 기사 데이터는 공개 정적 파일이므로 이 로그인은 **이용 구분**이지 열람 차단이 아니다.
- **동기화**: 지금 구조(localStorage 가 즉시 반응하는 저장소)를 그대로 두고, 그 뒤에서 서버와 맞추는 **로컬 우선 동기화**를 붙인다. 충돌은 기존 `mergeStates`(첫 연결)와 새 3-방향 병합(이후)으로 푼다.
- **권한**: 표 3개(`user_state`·`profiles`·`account_security`). 모든 표에 RLS + 표마다 필요한 GRANT 만 명시. 사용자는 본인 행만, 프로필·비밀번호 상태는 읽기만. anon 은 권한 없음. 검증 절차 포함(4.3).
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

1. 쓰는 곳은 관리 스크립트(`scripts/admin/users.mjs`, 6.3) 하나뿐이다. 사이트 코드·빌드·GitHub Actions 는 secret 키가 필요 없다.
2. 전용 키를 만든다: Settings → API Keys 에서 secret 키를 용도 이름(`admin-script`)으로 따로 만들어 쓰고, 기본 secret 키는 쓰지 않는다. 문제가 생기면 이 키만 지운다(새 키 체계는 secret 키를 여러 개 만들고 각각 폐기할 수 있다).
3. 두지 않는 곳: 저장소의 모든 파일(무시 목록에 든 `.env.local` 포함), 저장소 폴더 안의 어떤 파일, GitHub Secrets·Variables, Actions 로그, 브라우저·번들, URL, 이슈·커밋 메시지, 대화창(Claude Code 포함).
4. 넣는 방법: 명령을 칠 때 `read -s SUPABASE_SECRET_KEY` 로 화면에 보이지 않게 입력하고 같은 셸에서 스크립트를 실행한다. 셸 기록·파일에 남기지 않는다. 보관은 비밀번호 관리자에만.
5. 스크립트 쪽 방어: 키를 `process.env` 로만 읽는다, `sb_secret_` 로 시작하지 않으면 거절한다, 키·비밀번호를 출력·로그하지 않는다(새로 만든 무작위 비밀번호만 한 번 출력), 브라우저 번들에 들어가지 않는 위치(`scripts/`)에 둔다, 사이트 코드에서 import 하지 않는다(테스트로 확인).
6. Claude Code 는 secret 키를 받지 않고 다루지 않는다. RLS 검사도 시험 계정 로그인(publishable 키)으로만 한다.

**검증(자동)**

| 언제 | 무엇 | 실패 조건 |
|---|---|---|
| `npm test` 마다 | 저장소 추적 파일 전체 검색 | `sb_secret_` 로 시작하는 문자열, `"role":"service_role"` 을 담은 JWT 모양 문자열, `SUPABASE_SECRET_KEY=` 뒤에 값이 붙은 줄 |
| 배포 빌드 직후(`deploy.yml`) | `out/` 전체(HTML·JS 청크) 검색 | 위와 같음 → 배포 중단 |
| `npm test` 마다 | `app/`·`lib/`·`components/` 에서 `scripts/admin` import 또는 `SUPABASE_SECRET_KEY` 참조 | 1건이라도 있으면 실패 |

**검증(수동, 관리자)**

| 언제 | 무엇 |
|---|---|
| 단계 1 시작 전 1회 | 전체 이력 검색 `git log -p --all \| grep -c 'sb_secret_'` = 0 |
| 계정 작업 뒤마다 | 셸 기록에 키가 없는지(`history \| grep sb_secret_` 0건) |
| 분기 1회 | Settings → API Keys 에서 secret 키 목록 확인 — `admin-script` 외 쓰지 않는 키 삭제. GitHub 저장소 Settings → Secrets and variables 에 Supabase secret 이 없는지 확인 |
| 분기 1회 | 배포된 사이트 JS 청크에서 `sb_secret_` 검색 0건(자동 검사의 재확인) |

**유출 시 순서**: ① `admin-script` 키 즉시 삭제(Settings → API Keys) ② 새 키 생성 ③ 원인 제거(파일·이력·로그). 공개 저장소 이력에 들어갔으면 키를 지운 뒤에 이력 정리 여부를 따로 정한다 ④ 대시보드 Users·`user_state` 에서 이상 변경 확인. 공개 GitHub 에 올라간 secret 키를 Supabase 가 자동 폐기한다는 안내가 있으나(블로그) 이것에 기대지 않는다.

## 2. 로그인 흐름

### 2.1 경로

| 경로 | 로그인 필요 | 비고 |
|---|---|---|
| `/login/` | 아니요 | noindex. 로그인 상태로 오면 `next` 또는 홈으로 |
| `/account/password/` | 예(비밀번호 변경 전에도 들어갈 수 있는 유일한 화면) | noindex. 첫 로그인 강제 변경·본인 변경 |
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
| `profiles` | 사용자 1행 | 표시 이름 | 본인 행 읽기만(확장 때 로그인 사용자 전체 읽기, 11장) |
| `account_security` | 사용자 1행 | 비밀번호 변경 필요 여부, 바꾼 시각 | 본인 행 읽기만 |
| `user_state` | 사용자 × 채널 1행 | 북마크(기사 스냅샷·폴더·태그·메모·삭제 표시)·내 폴더·내 태그·읽음·확인 시각·보험사 | 본인 행 읽기·쓰기 |

표시 이름과 비밀번호 상태를 다른 표로 나눈 이유: 댓글·채팅을 열면 표시 이름은 다른 사용자에게 보여야 하지만 비밀번호 상태는 본인만 봐야 한다. RLS 는 행 단위라 한 표에서 열마다 다르게 열기 어렵다.

```sql
-- 001_schema.sql (단계 1, 관리자가 SQL Editor 에서 실행)

create table public.profiles (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  display_name text        not null unique
               check (char_length(display_name) between 1 and 20 and display_name = btrim(display_name)),
  created_at   timestamptz not null default now()
);

create table public.account_security (
  user_id              uuid        primary key references auth.users(id) on delete cascade,
  must_change_password boolean     not null default true,
  password_changed_at  timestamptz
);

create table public.user_state (
  user_id        uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  channel        text        not null check (channel ~ '^[a-z0-9-]{1,32}$'),
  schema_version int         not null default 2,             -- 브라우저 저장 형식과 같은 번호(3.3)
  bookmarks      jsonb       not null default '{}'::jsonb,   -- { 기사 id: 북마크 | 삭제 표시 } (3.3)
  folders        jsonb       not null default '{}'::jsonb,   -- { 폴더 id: { id, name, createdAt, updatedAt, deletedAt? } }
  tags           jsonb       not null default '{}'::jsonb,   -- { 태그 id: 같은 모양 }
  read_at        jsonb       not null default '{}'::jsonb,   -- { 기사 id: ISO 시각 }
  last_confirmed timestamptz,
  companies      jsonb       not null default '[]'::jsonb,   -- [정식명]
  rev            bigint      not null default 1,             -- 낙관적 동시성(3.4)
  updated_at     timestamptz not null default now(),
  primary key (user_id, channel),
  constraint user_state_size check (pg_column_size(bookmarks) + pg_column_size(folders) + pg_column_size(tags) + pg_column_size(read_at) + pg_column_size(companies) < 2000000)
);

-- 트리거 함수는 Data API 에 노출되지 않는 private 스키마에 둔다
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 수정 시각은 서버 시계로
create function private.touch_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger user_state_touch before update on public.user_state
  for each row execute function private.touch_updated_at();

-- 계정이 만들어지면 프로필(표시 이름 = 아이디로 임시)과 '변경 필요' 상태를 만든다
create function private.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name) values (new.id, split_part(new.email, '@', 1));
  insert into public.account_security (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- 비밀번호가 실제로 바뀌면 '변경 필요'를 끈다(사용자 변경·관리자 초기화 모두 여기를 지난다)
create function private.handle_password_change() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  update public.account_security
     set must_change_password = false, password_changed_at = now()
   where user_id = new.id;
  return new;
end $$;
create trigger on_auth_password_changed after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.handle_password_change();

revoke execute on all functions in schema private from public, anon, authenticated;
```

- `auth.users` 에 `after insert` 트리거로 프로필을 만드는 것은 공식 문서의 방식이다. `encrypted_password` 열에 거는 `after update` 트리거는 같은 방식의 응용이며 열 이름은 Auth 서버 소스 기준이다 **(단계 1 검사 항목 #13 으로 실측)**. 트리거 함수가 실패하면 계정 생성·비밀번호 변경 자체가 실패하므로 함수는 최소한으로 둔다.
- 관리자가 비밀번호를 초기화해도 이 트리거가 '변경 필요'를 끈다. 그래서 관리 스크립트는 **비밀번호를 바꾼 다음** `must_change_password = true` 를 다시 켠다(6.3, 순서 중요).
- 기본 키가 `(user_id, …)` 로 시작하므로 RLS 조건에 인덱스가 따로 필요 없다.
- 채널 목록은 DB 가 모른다(새 채널을 열 때 DB 변경 불필요).
- 2MB 상한은 오류·악용으로 행이 커지는 것을 막는 안전장치다. `pg_column_size` 는 압축(TOAST) 뒤 크기라 JSON 문자열 크기보다 작게 잡힌다. JSON 기준으로도 3.2 의 '많음'(1.6MB)까지 들어간다.

### 3.2 크기 추정(실측, v2 형식)

`tests/bookmarks.test.ts` 가 실제 기사(data/insurance)로 북마크를 만들고 폴더 20·태그 50을 채워 JSON 크기를 잰다. 북마크 1건은 기사 스냅샷(평균 약 600바이트) + 메타(저장·수정 시각, 폴더, 태그 3개 약 150바이트) + 메모(한글 1자 3바이트)다. 읽음 1건 약 46바이트.

| 사용 정도(채널 1개) | 북마크 | 메모 | 읽음 | 크기(JSON) |
|---|---:|---:|---:|---:|
| 가벼움 | 50 | 20자 | 300 | 약 64KB |
| 보통 | 300 | 60자 | 1,500(SOFT) | 약 358KB |
| 많음 | 1,000 | 200자(한도) | 5,000(HARD) | 약 1.6MB |

- 10명 × 채널 3개 × 보통 ≈ **11MB**, 전원 '많음'이어도 ≈ 48MB. 무료 플랜 DB 500MB 의 2~10%. jsonb 는 큰 값을 압축(TOAST)하므로 실제로는 더 작다. `profiles`·`account_security` 는 합쳐 수 KB.
- 한 행 2MB 상한에는 북마크 약 1,200건(메모를 모두 200자로 채운 경우)에서 닿는다. 채널당 북마크 상한(예: 1,000건)을 둘지는 동기화 구현(단계 3) 전에 정한다. 지금 브라우저 저장에는 상한이 없다.
- **egress(무료 월 5GB)가 더 빠듯하다**: 행 전체를 자주 내려받으면(10명 × 하루 30회 × 3채널 × 358KB ≈ 하루 320MB) 한도를 넘는다. 그래서 3.4 처럼 **`rev` 만 먼저 확인하고 바뀌었을 때만 행 전체를 받는다.** 올릴 때 응답도 `rev` 만 받는다. 이렇게 하면 실제로 바뀐 때만 받으므로 월 수백 MB 이하다.

### 3.3 형식(v2)과 병합 규칙

브라우저 저장 형식(`heukseok-v2:<채널>`, `docs/migration-localstorage.md` 1장)과 서버 행은 같은 모양이다 — `bookmarks`·`folders`·`tags`·`read_at`(브라우저 `readAt`)·`last_confirmed`·`companies`. 브라우저 키 이름은 5.2 표의 `heukseok-v1:` 을 `heukseok-v2:` 로 읽는다(v1 키는 읽기 전용 이전 원본).

| 항목 | 모양 |
|---|---|
| 북마크 | 기사 스냅샷(제목·링크·출처·분류·키워드·보험사·기관·발행 시각) + `savedAt`·`updatedAt`·`folderId?`·`tags`(내 태그 id)·`memo`(200자)·`missing?` |
| 삭제 표시 | `{ id, channel, savedAt, updatedAt, deletedAt }` — 북마크·폴더·태그를 지우면 바로 없애지 않고 남긴다. 30일 뒤 정리 |
| 폴더·태그 | `{ id, name, createdAt, updatedAt, deletedAt? }`, 폴더 20·태그 50(살아 있는 것) |

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
- 한도(폴더 20·태그 50)는 만들 때만 검사한다. 두 기기에서 따로 만들어 합친 결과가 한도를 넘어도 지우지 않고, 한도 아래로 줄 때까지 새로 만들기만 막는다.

### 3.4 서버와 주고받기(낙관적 동시성)

- **받기**: `select rev` → 기준본의 rev 와 같으면 끝. 다르면 `select *` 로 받아 `mergeStates3(base, local, server)` → 로컬 저장 → 결과가 서버와 다르면 올리기.
- **올리기**: `update … set (내용), rev = rev + 1 where user_id = 나 and channel = c and rev = <기준본 rev> returning rev`.
  - 1행이 바뀌면 성공 → 기준본 = 올린 내용, rev 갱신.
  - 0행이면 그 사이 다른 기기가 올린 것 → 받기부터 다시(최대 3회).
  - 행이 아예 없으면(첫 사용) `insert`. 동시에 두 기기가 insert 해서 기본 키 충돌이 나면 받기부터 다시.
- **언제**: 로그인 직후(비밀번호 변경 완료 뒤), 페이지를 열 때, 탭이 다시 보일 때(`visibilitychange`), 보이는 동안 5분마다 받기. 로컬 변경 뒤 2초 모아서(debounce) 올리기. 보내지 못한 변경은 '보낼 것 있음' 표시를 로컬에 남겨 다음 기회에 보낸다.
- 요청 수: 10명 기준 하루 수천 건 수준으로 무료 플랜 한도와 무관하다. 동기화 요청은 Auth 요청 제한(`/auth/v1/token`)에 들어가지 않는다(토큰 갱신만 들어감).

## 4. 접근 규칙(RLS)과 권한(GRANT)

### 4.1 SQL 초안

프로젝트 설정 전제(완료): Data API 의 **Automatically expose new tables 꺼짐**, **Enable automatic RLS 켜짐**. 따라서 새 표에는 역할별 권한이 자동으로 붙지 않는다고 보고, 표마다 필요한 GRANT 를 **모두 명시**한다. RLS 는 자동으로 켜지지만 SQL 에도 적어 둔다(다시 실행해도 같은 결과).

```sql
-- 002_access.sql (단계 1, 001 다음에 실행)

-- RLS (자동 RLS 가 켜져 있어도 명시)
alter table public.profiles         enable row level security;
alter table public.account_security enable row level security;
alter table public.user_state       enable row level security;

-- 스키마 사용 권한
grant usage on schema public to authenticated, service_role;

-- 기본: 아무 권한도 없는 상태에서 시작
revoke all on table public.profiles, public.account_security, public.user_state from public, anon, authenticated;

-- authenticated(로그인 사용자): 필요한 것만
grant select                         on table public.profiles         to authenticated;  -- 표시 이름 읽기만
grant select                         on table public.account_security to authenticated;  -- 변경 필요 여부 읽기만
grant select, insert, update, delete on table public.user_state       to authenticated;

-- service_role(관리 스크립트): RLS 는 우회하지만 표 권한은 별도로 필요
grant select, insert, update, delete on table public.profiles, public.account_security, public.user_state to service_role;

-- anon(로그인 안 함): 어떤 표에도 권한 없음 → 42501

-- profiles: 본인 행만 읽기. 쓰기 정책 없음(표시 이름은 관리자만 바꾼다)
create policy "profiles: 본인 행 읽기" on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

-- account_security: 본인 행만 읽기. 쓰기 정책 없음(트리거·관리자만 바꾼다)
create policy "account_security: 본인 행 읽기" on public.account_security for select to authenticated
  using ((select auth.uid()) = user_id);

-- user_state: 본인 행만, 그리고 비밀번호를 바꾼 계정만
create function private.password_ready() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select not s.must_change_password
                     from public.account_security s
                    where s.user_id = (select auth.uid())), false)
$$;
revoke execute on function private.password_ready() from public, anon;  -- 함수는 기본으로 PUBLIC 실행 권한이 붙으므로 회수
grant usage on schema private to authenticated;
grant execute on function private.password_ready() to authenticated;

create policy "user_state: 본인 행 읽기"   on public.user_state for select to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "user_state: 본인 행 만들기" on public.user_state for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "user_state: 본인 행 고치기" on public.user_state for update to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()))
  with check ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "user_state: 본인 행 지우기" on public.user_state for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()));
```

- `(select auth.uid())` 처럼 감싸면 문장당 한 번만 계산된다(공식 권장). `for all` 정책을 쓰지 않고 작업별로 나눈다(공식 권장).
- `profiles`·`account_security` 에는 authenticated 의 insert/update/delete 권한이 **GRANT 단계에서 없다**. 정책을 실수로 추가해도 권한 오류(42501)로 막힌다. 표시 이름을 사용자가 못 바꾸는 근거가 이것이다.
- `user_state` 의 `password_ready()` 조건: 비밀번호를 바꾸지 않은 계정은 동기화 자체가 거절된다(화면 게이트를 우회해도 서버 기록에 닿지 못함). 함수는 `private` 스키마에 있어 Data API 로 직접 부를 수 없다. `private` 스키마에 authenticated 의 usage 를 주는 것은 정책 안에서 이 함수를 부르기 위해서이고, 표는 두지 않는다.
- `update` 의 `with check` 가 `user_id` 를 남의 것으로 바꾸는 것을 막는다.
- SQL 은 저장소의 `supabase/sql/001_schema.sql`, `002_access.sql` 에 두고(단계 1), 관리자가 SQL Editor 에서 실행한다. CLI 마이그레이션은 쓰지 않는다(사람 10명 규모에 과함).

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

시험 계정 `test-a`, `test-b`, `test-c` 를 만든다(실사용 계정과 분리). `test-a`·`test-b` 는 비밀번호를 한 번 바꿔 둔 상태, `test-c` 는 바꾸지 않은 상태로 둔다. 스크립트 `scripts/audit/rls-check.mjs`(단계 1) — publishable 키와 시험 계정 아이디·비밀번호를 환경 변수로만 받는다. secret 키는 쓰지 않는다.

| # | 누구로 | 하는 일 | 기대 |
|---|---|---|---|
| 1 | A | 자기 `user_state` insert → select | 성공, 1행 |
| 2 | B | A 의 `user_state` select(`user_id = A`) | 0행 |
| 3 | B | A 의 `user_state` update | 0행 바뀜 |
| 4 | B | `user_id = A` 로 insert | RLS 위반 오류 |
| 5 | B | 자기 행의 `user_id` 를 A 로 update | RLS 위반 오류 |
| 6 | B | A 의 `user_state` delete | 0행 |
| 7 | 로그인 없음(publishable 키만) | 세 표 select·insert | 모두 `42501` |
| 8 | A | 2MB 넘는 `user_state` update | check 위반 |
| 9 | A | `profiles` 자기 행 select / B 의 행 select | 1행 / 0행 |
| 10 | A | `profiles.display_name` update, `profiles` insert·delete | 모두 `42501` |
| 11 | A | `account_security` 자기 행 select / `must_change_password` update | 1행(false) / `42501` |
| 12 | C(변경 전) | `user_state` insert·select | RLS 위반 / 0행 |
| 13 | C | `updateUser` 로 비밀번호 변경 → `account_security` select → `user_state` insert | true → false 로 바뀜 → 성공(트리거 확인) |
| 14 | C | 같은 비밀번호로 다시 변경 | `same_password` |
| 15 | A | `rpc('password_ready')` 등 private 함수 직접 호출 | 찾을 수 없음(노출 안 됨) |
| 16 | A·C | 끝나면 자기 `user_state` 행 delete | 성공 |

- 13 을 돌린 뒤 C 를 다시 '변경 전'으로 돌리는 것은 관리자가 한다(6.3 `reset-password test-c`).
- 관리자 쪽 확인(관리자가 직접, secret 키 사용): 6.3 스크립트로 계정 생성 → `profiles` 표시 이름·`account_security` true 확인, `reset-password` 후 true 로 돌아오는지 확인.
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
| 8 | **Require current password: 켬**, **Secure password change: 끔**(2.5) | ☐ 남음 |
| 9 | 비밀번호 필수 문자 규칙: **끔으로 둠**(학번 초기 비밀번호를 허용하려면, 2.5) | ☐ 확인 |
| 10 | Authentication → Rate Limits: 토큰 한도 5분 30회(7.2) | ☐ 남음 |
| 11 | Settings → API Keys: publishable 키 확인, secret 키 `admin-script` 따로 만들기, **구 anon·service_role 키 비활성화**(1.4) | ☐ 남음 |
| 12 | GitHub 저장소 Variables 에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 등록 | ☐ 남음 |
| 13 | SQL Editor 에서 `001_schema.sql`, `002_access.sql` 실행(단계 1 에서 Claude 가 작성) → 4.2 권한 조회 | ☐ 단계 1 |
| 14 | 시험 계정 `test-a`·`test-b`·`test-c`, 본인 계정 만들기(6.2) — **SQL 실행 뒤에** 만들어야 프로필이 자동으로 생긴다 | ☐ 단계 1 |

### 6.2 계정 만들기(사용자마다)

- 정보: 아이디(2.2 형식), 표시 이름(실명·별명 자유, 1~20자, 다른 사람과 겹치지 않게), 초기 비밀번호.
- **초기 비밀번호 — 둘 중 하나**
  - 무작위(기본안): 스크립트가 16자 무작위로 만들어 한 번만 화면에 보여 준다. 1:1 메시지·대면으로 전달.
  - 학번: 본인이 원하거나 전달이 번거로울 때. 8자 미만이면 쓸 수 없다(서버 최소 8자). 학번은 같은 반 사람이 알 수 있으므로 **계정을 건넬 때 바로 첫 로그인을 하도록** 하고, 관리자가 6.3 `pending` 으로 변경 여부를 확인한다. 3일 안에 바꾸지 않으면 무작위로 초기화한다. 학번 목록은 어디에도 적어 두지 않는다(스크립트 입력은 화면에 보이지 않게, 저장소·메모 금지).
  - 어느 쪽이든 첫 로그인 때 비밀번호 변경 화면으로 강제 이동한다(2.5). 서버에서도 바꾸기 전에는 동기화가 거절된다.
- **방법 A — 스크립트(권장)**: `create` 한 번으로 계정·표시 이름·'변경 필요'가 모두 정해진다(6.3).
- **방법 B — 대시보드**: Authentication → Users → Add user → Create new user: 이메일 `<아이디>@users.heukseok.invalid`, 비밀번호, **Auto Confirm User** 체크 **(이 화면은 공식 문서에 설명이 없다 — 첫 계정 때 확인)**. 트리거가 표시 이름을 아이디로 임시로 넣으므로, SQL Editor 에서 바꾼다:
  `update public.profiles set display_name = '<표시 이름>' where user_id = (select id from auth.users where email = '<아이디>@users.heukseok.invalid');`

### 6.3 관리 스크립트(관리자 PC 에서만)

`scripts/admin/users.mjs`(단계 4, 계정을 처음 만들기 전에 필요하면 단계 1 로 앞당김):

```
read -s SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY
export SUPABASE_URL=https://<프로젝트 ref>.supabase.co
node scripts/admin/users.mjs create <아이디> --name '<표시 이름>'          # 무작위 초기 비밀번호, 한 번만 출력
node scripts/admin/users.mjs create <아이디> --name '<표시 이름>' --prompt # 초기 비밀번호(학번 등)를 보이지 않게 입력
node scripts/admin/users.mjs set-name <아이디> '<표시 이름>'
node scripts/admin/users.mjs reset-password <아이디> [--prompt]            # 새 초기 비밀번호 + '변경 필요' 다시 켬
node scripts/admin/users.mjs pending                                      # 아직 비밀번호를 바꾸지 않은 계정과 만든 날
node scripts/admin/users.mjs list                                         # 아이디·표시 이름·마지막 로그인
node scripts/admin/users.mjs export <저장소 밖 경로>                        # 백업(7.3)
unset SUPABASE_SECRET_KEY
```

- `create`: `auth.admin.createUser({ email, password, email_confirm: true })` → 트리거가 프로필·'변경 필요'를 만듦 → `profiles.display_name` 갱신. 표시 이름이 겹치면 계정을 만들기 전에 거절한다.
- `reset-password`: `auth.admin.updateUserById(id, { password })` → (트리거가 '변경 필요'를 끔) → **그 다음에** `account_security.must_change_password = true`. 순서를 바꾸면 강제 변경이 풀린다. 끝나면 값이 true 인지 다시 읽어 확인하고 출력한다.
- 키 규칙은 1.4 를 따른다(환경 변수로만, `sb_secret_` 접두 확인, 키·입력 비밀번호 출력 금지, `--prompt` 는 터미널 에코를 끈 입력).

### 6.4 비밀번호 초기화·표시 이름 변경·계정 삭제

- 비밀번호를 잊으면: 관리자에게 말한다 → 관리자가 `reset-password`(무작위 권장) → 전달 → 사용자는 로그인하자마자 변경 화면으로. 메일 재설정은 쓰지 않는다.
- 표시 이름을 바꾸고 싶으면: 관리자에게 말한다 → `set-name`. 사용자 화면에는 바꾸는 기능이 없다.
- 삭제 요청: 대시보드 Users → 사용자 삭제. `on delete cascade` 로 세 표의 행이 함께 지워진다.

## 7. 보안·개인정보 점검 목록

### 7.1 비밀번호

- [x] 서버 최소 8자(설정 완료).
- [ ] **첫 로그인 강제 변경**(2.5) — 서버 최소 길이가 짧은 것을 보완하는 핵심 장치. 화면 게이트 + 서버 동기화 거절(4.1) 두 겹.
- [ ] 화면에서 새 비밀번호 규칙 검사: 8자 이상, 영문+숫자, 아이디 미포함.
- [ ] 초기 비밀번호는 무작위 16자가 기본. 학번을 쓰면 3일 안 변경 확인(6.2).
- [ ] 유출 비밀번호 차단(HaveIBeenPwned)은 Pro 전용이라 없음 → 변경 화면에 "다른 사이트에서 쓰는 비밀번호는 피해 주세요." 한 줄.

### 7.2 무차별 대입

- 기본 한도: `/auth/v1/token`(비밀번호 로그인 + 토큰 갱신) IP 당 5분 150회. 계정 단위 잠금은 공식 문서에서 찾지 못했다(없다고 보고 설계).
- [ ] Rate Limits 에서 토큰 한도를 **5분 30회**로 낮춘다(10명이 정상 사용으로 닿지 않는 값. 토큰 갱신도 여기에 들어가므로 너무 낮추지 않는다).
- [ ] CAPTCHA(Cloudflare Turnstile, hCaptcha)는 지원되지만 처음에는 켜지 않는다. 감사 로그(무료 1시간 보관)·사용량 그래프에서 이상 시도가 보이면 켠다(단계 5).
- [ ] 아이디는 짐작 가능하다고 본다. 그래서 초기 비밀번호가 살아 있는 기간(발급~첫 로그인)을 짧게 한다.

### 7.3 무료 플랜 일시 중지·백업 부재

- 7일 동안 활동(DB 요청·API 호출·대시보드 방문)이 적으면 프로젝트가 멈춘다. 멈추기 약 1주 전과 멈춘 뒤 소유자에게 메일이 온다. 대시보드 "Resume project" 로 데이터 그대로 복구(정지 후 1년까지).
- 멈춘 동안: 이미 로그인한 기기는 로컬 사본으로 계속 쓰고 동기화만 실패한다. **새 로그인은 불가** → 12장 결정 사항.
- [ ] 사용자 10명이 매일 쓰면 멈출 일은 거의 없다. 방학 등을 대비해 관리자가 정지 예고 메일을 받으면 대시보드를 한 번 연다. (자동 유지 요청을 Actions 로 보내는 방법은 '어떤 요청이 활동으로 잡히는지' 공식 기준이 모호해 기본안에서 뺀다.)
- [ ] 자동 백업 없음(무료) → 관리자가 월 1회 `supabase db dump --data-only -f <저장소 밖 경로>`(공식 CLI) 또는 6.3 `export`. 각 사용자도 내 데이터 → 파일로 내려받기(지금 기능 유지)로 스스로 백업할 수 있다.

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

- '읽음 기록'에 새 뉴스 확인 시각과 선택한 보험사(화면 설정)도 포함해 읽힌다고 본다. 더 정확히 쓰려면 "북마크·읽음 기록과 화면 설정"(12장 결정 7).
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

- RLS·GRANT: 4.2 권한 조회 + 4.3 절차(`scripts/audit/rls-check.mjs`, 시험 계정 3개). SQL 을 바꿀 때마다.
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
| **1. 표·권한·검사** (Claude 가 SQL·검사 스크립트 작성, 사용자가 SQL 실행·계정 생성) | `supabase/sql/001_schema.sql`·`002_access.sql`, `scripts/audit/rls-check.mjs`, (필요하면) `scripts/admin/users.mjs` 의 `create`·`reset-password`·`pending` | 4.2 권한표 일치, 4.3 의 로그인·비밀번호 변경이 필요 없는 항목(1~12, 15) 통과, 시험 계정 3개·본인 계정 생성 | `drop table` 세 개 + 트리거·함수 삭제 SQL(같이 작성) |
| **2. 로그인·강제 변경·세션** (Claude) | `@supabase/supabase-js` 추가, `lib/supabase.ts`·`lib/auth.ts`, 게이트 스크립트, `/login/`, `/account/password/`, `/account/`, 홈·헤더 계정 메뉴, 푸터 안내, 비밀값 검사 테스트, deploy.yml 변수 전달·`out/` 검사 | 9.1 게이트·폼·아이디 테스트, 4.3 의 13·14 통과(트리거 실측), `.invalid` 계정으로 실제 로그인·강제 변경 성공(호스팅 실측), Playwright 로그인 흐름, 기존 동등성 검사 통과 | Variables 삭제 후 배포(코드 그대로 꺼짐), 또는 커밋 revert |
| **3. 동기화** (Claude) | `mergeStates3`, `lib/sync.ts`, `accountStore`, `useSaved` 구독, 첫 로그인 합치기, 상태 표시, 로그아웃 시 정리 | 9.1 동기화 테스트, 4.3 의 16 까지 전체 통과, 두 브라우저·오프라인 시험, 1주 사용 중 데이터 유실 신고 없음 | `NEXT_PUBLIC_SYNC=off` |
| **4. 운영** (Claude, 일부 사용자) | 관리 스크립트 나머지(`set-name`·`list`·`export`), 내 데이터 문구, docs 갱신(architecture·ops-notes) | 관리자 백업 1회 실행, 1.4 수동 검증 1회 | 커밋 revert |
| **5. 다듬기** (선택) | Rate limit 조정 확인, CAPTCHA 검토, CSP meta 검토 | 7장 체크리스트 완료 | 설정 원복 |

**사용자(관리자)가 직접 하는 일**

- 완료: Supabase 프로젝트(서울 리전), 가입 허용 끔, 이메일 확인 끔, 비밀번호 최소 8자, Site URL, 새 표 자동 노출 끔·자동 RLS 켬.
- 남음:
  - 6.1 의 8~12: Require current password 켬·Secure password change 끔, 필수 문자 규칙 끔 확인, 토큰 요청 한도, secret 키 `admin-script` 생성과 구 키 비활성화, GitHub Variables 등록.
  - 단계 1 의 SQL 실행과 권한 조회 결과 확인, 시험 계정 3개·본인 계정 생성, 시험 계정 비밀번호를 로컬 환경 변수로 보관.
  - 운영: 계정 발급과 초기 비밀번호 전달, 학번을 쓴 계정의 3일 안 변경 확인(`pending`), 정지 예고 메일 확인, 월 1회 백업, 분기 1회 키 점검(1.4), 표시 이름 변경·삭제 요청 처리.

**Claude Code 가 하는 일**: 코드·테스트·문서, SQL·검사 스크립트·관리 스크립트 작성(실행은 관리자), Playwright 검증, 배포 확인. secret 키는 받지 않고 다루지 않는다(RLS 검사도 시험 계정 로그인으로만).

## 11. 확장 지점(다음 단계, 방향만)

- **외부 로그인(카카오 등)**: 지금은 쓰지 않는다. 붙일 때를 위해 지금 지키는 것 — 모든 사용자 데이터를 이메일이 아니라 Supabase 사용자 id(`auth.users.id`)에 묶는다, 로그인 방법은 `lib/auth.ts` 에만 둔다, 표시 이름은 `profiles` 에 따로 둔다. 붙이는 방법은 가입을 닫은 채로 **기존 아이디 계정에 외부 계정을 연결**(`linkIdentity`, 대시보드에서 manual linking 켜기)하는 방식으로 한다 — 같은 사용자 id 를 유지하므로 북마크·표시 이름이 그대로다. 이때 콜백 경로(`/auth/callback/`)에서만 `detectSessionInUrl` 을 켜고, Redirect URLs 에 그 주소를 등록한다.
- **표시 이름 공개**: 댓글·채팅을 열 때 `profiles` 의 select 정책을 "로그인 사용자 전체"로 넓힌다(`using (true)` to authenticated). `account_security` 는 계속 본인만. `auth.users` 는 노출하지 않는다.
- **댓글**: `comments(id bigint identity pk, channel text, article_id text /* 16자리 기사 id */, user_id uuid default auth.uid(), body text check (char_length(body) between 1 and 1000), created_at timestamptz default now(), deleted_at timestamptz)`, 인덱스 `(channel, article_id, created_at)`. 화면에는 `profiles.display_name` 을 붙여 보인다. RLS: select 는 authenticated 전체(`deleted_at is null`), insert 는 `user_id = auth.uid()` 이고 `password_ready()`, update(본문 수정·삭제 표시)는 본인만, 실제 delete 는 관리자만. 같은 기사가 다른 채널에도 있을 수 있어 키는 `(channel, article_id)`.
- **전체 채팅방**: `chat_messages(id bigint identity pk, user_id uuid default auth.uid(), body text check (char_length(body) between 1 and 500), created_at timestamptz default now())`. 최근 것만 보관 — 넣을 때 트리거로 최근 500건(또는 30일)만 남긴다. 실시간은 Supabase Realtime(Postgres Changes 또는 Broadcast). 무료 한도: 동시 연결 200, 월 메시지 200만, 초당 100 — 10명에게 충분. RLS: select·insert 는 authenticated(insert 는 `password_ready()`), update 없음, delete 는 본인·관리자.
- 공통: 모든 표는 `revoke all … from public, anon, authenticated` 후 필요한 권한만 `grant`(service_role 포함 명시), 작업별 정책, `(select auth.uid())`, 4.2 권한표와 4.3 검사 항목을 같이 늘린다. 글 내용은 React 텍스트로만 그린다(HTML 해석 금지). 신고·차단은 10명 규모라 관리자가 대시보드에서 처리.

## 12. 정해야 할 것(관리자 결정)

1. **로그인 서버가 멈췄을 때**(무료 플랜 정지·장애): 새 로그인 불가를 그대로 둘지(기본안), 연결 실패일 때만 로그인 없이 읽기 전용으로 열어 둘지.
2. **검색 노출**: 로그인 게이트가 생기면 자바스크립트를 실행하는 검색 로봇은 로그인 화면(noindex)만 보게 되어 사실상 검색에서 빠진다. 그대로 둘지(기본안), 채널 페이지를 명시적으로 noindex 할지.
3. **첫 로그인 합치기**를 묻고 합칠지(기본안), 묻지 않고 자동으로 합칠지.
4. **새 비밀번호 화면 규칙**: 8자 이상 + 영문·숫자 + 아이디 미포함(기본안) 또는 8자 이상만. 토큰 요청 한도 5분 30회(기본안).
5. **수집 상태 페이지**(`/<채널>/status/`)도 로그인 뒤에 둘지(기본안: 다른 페이지와 같이 로그인 필요).
6. **초기 비밀번호**: 무작위를 기본으로 하고 학번은 예외로 둘지(기본안), 학번을 기본으로 할지. 학번 계정의 변경 기한(기본안 3일).
7. **푸터 문구**: "아이디·표시 이름과 북마크·읽음 기록뿐"(기본안, 확인 시각·보험사 선택을 읽음 기록에 포함해 읽음) 또는 "…북마크·읽음 기록과 화면 설정".
8. **표시 이름**: 서로 겹치지 않게 할지(기본안: unique), 헤더 메뉴에 표시 이름을 보일지 아이디를 보일지(기본안: 표시 이름, 메뉴 첫 줄에 아이디).
