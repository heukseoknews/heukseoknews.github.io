# 로그인·동기화 설계 (Supabase)

> 상태: 설계안(2026-11-12). 코드는 아직 없다. 구현은 10장의 단계 순서로 한다.
> 근거: Supabase 공식 문서·가격표, 공식 저장소(supabase/auth, supabase-js) 소스. 공식 문서에서 확인하지 못한 것은 **(미확인)** 으로 적었고, 구현 단계에서 실측해 확정한다.
> 문서 안의 키·비밀번호·주소는 모두 자리표시자다(`<프로젝트 ref>`, `<publishable 키>` 등). 실제 값은 저장소에 쓰지 않는다.

## 0. 요약

- **구성**: 사이트는 지금처럼 정적 export(GitHub Pages)다. 브라우저가 `@supabase/supabase-js` 로 Supabase Auth(로그인)와 Postgres(사용자 상태 1행/채널)에 직접 붙는다. 서버 코드는 없다.
- **계정**: 관리자가 대시보드에서 만든다. 가입은 닫는다. 아이디 `kim` → 내부 이메일 `kim@users.heukseok.invalid`(메일을 보내지 않는 경로만 쓴다).
- **화면**: 처음 접속하면 `/login/`(noindex) → 로그인 후 홈. 로그인 여부는 브라우저에서 검사한다. 기사 데이터는 공개 정적 파일이므로 이 로그인은 **이용 구분**이지 열람 차단이 아니다.
- **동기화**: 지금 구조(localStorage 가 즉시 반응하는 저장소)를 그대로 두고, 그 뒤에서 서버와 맞추는 **로컬 우선 동기화**를 붙인다. 충돌은 기존 `mergeStates`(첫 연결)와 새 3-방향 병합(이후)으로 푼다.
- **권한**: 표 1개(`user_state`)에 RLS — 본인 행만 select/insert/update/delete, anon 은 권한 자체를 회수.
- **되돌리기**: 빌드 환경 변수(Supabase 주소·키)가 없으면 로그인 기능이 꺼지고 지금과 같은 로컬 전용 사이트로 빌드된다. GitHub 변수만 지우고 다시 배포하면 원상복구된다.

## 1. 구조

### 1.1 정적 export 에서 supabase-js 쓰기

- 패키지: `@supabase/supabase-js`(v2, 2.102.0 이상 — 5.4 의 '현재 비밀번호 확인' 때문). `@supabase/ssr` 은 쿠키 기반 서버 렌더링용(베타)이라 서버가 없는 이 사이트에는 맞지 않는다.
- 클라이언트는 `lib/supabase.ts` 한 곳에서 한 번만 만든다(`createClient(url, publishableKey)`). 기본값이 이 사이트에 맞다: `persistSession: true`(localStorage), `autoRefreshToken: true`. 세션은 `sb-<프로젝트 ref>-auth-token` 키로 localStorage 에 저장된다(supabase-js 소스 기준, 공식 문서에는 기본값 명시 없음).
- `detectSessionInUrl` 은 끈다(메일 링크·OAuth 를 쓰지 않으므로 주소창 해시를 세션으로 해석할 이유가 없고, `#import=` 해시와 섞이지 않게).
- 화면 코드는 supabase-js 를 직접 부르지 않고 `lib/auth.ts`(로그인·로그아웃·비밀번호 변경·현재 사용자)와 `lib/sync.ts`(동기화)만 쓴다. 테스트에서 가짜 클라이언트로 바꾸기 쉽게 하기 위해서다.

### 1.2 환경 변수

| 이름 | 값 | 공개 여부 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<프로젝트 ref>.supabase.co` | 공개(번들에 들어감) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_<…>` | 공개(번들에 들어감) |

- `NEXT_PUBLIC_*` 는 `next build` 때 번들에 문자열로 박힌다. 그래서 값은 **빌드하는 곳**에 있어야 한다.
  - GitHub Actions: 저장소 Settings → Secrets and variables → Actions → **Variables** 에 두 값을 넣고, `deploy.yml` 의 build 잡 `npm run build` 단계에 `env: NEXT_PUBLIC_SUPABASE_URL: ${{ vars.NEXT_PUBLIC_SUPABASE_URL }}` 식으로 넘긴다. 공개 값이라 Secrets 가 아니라 Variables 로 충분하다(로그에 가려지지 않아도 문제없음).
  - 로컬: `.env.local`(이미 `.gitignore` 의 `.env*` 로 제외됨).
- 두 값이 없으면 로그인·동기화 기능을 끈 채 빌드한다(지금 사이트와 같음). 동등성 검사·테스트는 이 모드로도 돌 수 있다. 단, **배포 빌드에서는** 값이 없으면 실패하게 한다(`deploy.yml` 에서 검사) — 실수로 로그인 없는 판이 나가지 않게. 의도적으로 끌 때는 9.3 의 끄기 스위치를 쓴다.

### 1.3 공개해도 되는 키와 절대 두면 안 되는 키

| 키 | 역할 | 어디에 |
|---|---|---|
| publishable `sb_publishable_…` (구 `anon`) | 요청을 `anon`/`authenticated` 역할로 실행. 권한은 RLS·GRANT 가 정한다 | 브라우저 번들 OK |
| secret `sb_secret_…` (구 `service_role`) | `service_role` 역할 — **모든 RLS 를 우회** | 관리자 PC 의 환경 변수에서만. 저장소·화면·로그·URL·GitHub Variables 금지 |
| DB 비밀번호, JWT secret | DB 직접 접속·토큰 서명 | 관리자만. 저장소 금지 |

- publishable 키가 공개돼도 안전한 이유: 이 키로 할 수 있는 일은 "로그인 시도"와 "RLS 가 허락한 행 접근"뿐이다. 이 설계에서 anon 은 표 권한이 없고(4장), 로그인한 사용자는 자기 행만 본다.
- 구 키(`anon`·`service_role`)는 2026년 말 폐기 예정이다. 처음부터 새 키(publishable/secret)를 쓰고, 프로젝트를 만든 뒤 Settings → API Keys 에서 구 키를 **비활성화**한다.
- secret 키가 공개 GitHub 에 올라가면 Supabase 가 자동 폐기한다고 알려져 있으나(블로그) 이것에 기대지 않는다. 유출 시 순서: 원인 제거 → 새 secret 키 생성 → 사용처 교체 → 옛 키 삭제.
- **저장소 규칙(테스트로 강제)**: `npm test` 에 비밀값 검사를 넣는다 — 저장소 추적 파일과 `out/` 에 `sb_secret_`, `service_role`, `"role":"service_role"` 이 든 JWT 모양 문자열이 있으면 실패. 관리자 스크립트(6.3)는 키를 `process.env` 로만 읽고, 키를 출력하지 않는다.

## 2. 로그인 흐름

### 2.1 경로

| 경로 | 로그인 필요 | 비고 |
|---|---|---|
| `/login/` | 아니요 | noindex. 로그인 상태로 오면 `next` 또는 홈으로 |
| `/` (홈), `/<채널>/…` 전부(내 데이터·수집 상태 포함) | 예 | |
| `/account/` | 예 | 비밀번호 변경·로그아웃(noindex) |
| 404, `/data/…`, `/version.json`, 아이콘·OG 이미지 | 아니요 | 공개 정적 파일(의도된 공개) |

### 2.2 처음 접속 → 로그인 → 홈

1. 보호 경로의 HTML `<head>` 첫 부분에 작은 인라인 스크립트(빌드 때 프로젝트 ref 를 넣어 생성)를 둔다. localStorage 에 `sb-<ref>-auth-token` 이 **없으면** 화면을 그리기 전에 `location.replace('/login/?next=' + encodeURIComponent(pathname + search + hash))`. 정적 HTML 이 잠깐 보이는 깜빡임이 없다.
   - 이 검사는 "세션이 있어 보이는가"만 본다(서버 확인 아님). 클라이언트 검사이므로 우회는 쉽다 — 이 로그인은 이용 구분용이므로 받아들인다. 실제 사용자 데이터 접근은 RLS 가 막는다.
   - 홈의 `#import=` 이동 스크립트보다 먼저 실행된다. 로그인 안 한 사람이 `/#import=…` 로 오면 `next=/#import=…` 로 로그인 후 홈 → 내 데이터로 이어진다.
2. `/login/`: 아이디·비밀번호 → `signInWithPassword({ email: toEmail(id), password })`.
   - 아이디 형식: 영문 소문자로 시작, 소문자·숫자·`_`·`-`·`.` 3~20자. 입력은 소문자로 바꾸고 앞뒤 공백 제거. `toEmail(id) = id + '@users.heukseok.invalid'`.
   - `.invalid` 는 예약된 최상위 도메인이라 실제 메일이 갈 수 없다. Supabase 서버 소스상 계정 생성·비밀번호 로그인은 형식 검사만 하므로 통과한다. 메일을 보내는 기능(비밀번호 찾기 메일, 이메일 확인, 초대)은 쓰지 않는다 **(호스팅 환경 실측 필요 — 단계 1 완료 기준에 포함)**.
3. 성공하면 `next` 로 이동한다. `next` 는 `/` 로 시작하고 `//`·`/\`·`/login` 으로 시작하지 않는 같은 사이트 경로만 받고(열린 리디렉트 방지), 아니면 `/`.

### 2.3 세션 유지·만료·로그아웃

- access token 은 기본 1시간, supabase-js 가 자동 갱신한다. refresh token 은 만료되지 않지만 한 번만 쓸 수 있다(재사용이 감지되면 세션 전체 폐기).
- 앱 시작 시 `onAuthStateChange` 를 구독한다.
  - `SIGNED_OUT`(토큰 폐기·관리자 삭제·다른 탭 로그아웃): 동기화를 멈추고 `/login/?next=…` 로.
  - 네트워크 오류로 갱신에 실패하면 로그아웃시키지 않는다. 화면은 계속 쓰고 동기화 상태만 '이 기기에만 저장됨'으로 둔다.
- 로그아웃(`/account/` 와 헤더 메뉴): ① 보내지 못한 변경을 한 번 보내 보고 ② 실패하면 "보내지 못한 변경이 있습니다. 그래도 로그아웃할까요?" ③ `signOut({ scope: 'local' })`(이 기기만. 기본값 `global` 은 모든 기기를 로그아웃시킴) ④ 이 계정의 로컬 사본(5.2 표의 사용자 키)을 지운다 — 같은 브라우저를 다른 사람이 쓸 때 기록이 남지 않게.
- 세션 타임아웃·사용자당 단일 세션은 Pro 플랜 기능이라 쓰지 않는다.

### 2.4 아이디 저장

- 로그인 화면의 '아이디 저장' 체크 → `localStorage['heukseok-login-id'] = 아이디`. 체크를 끄고 로그인하면 지운다. 비밀번호는 어디에도 저장하지 않는다(브라우저 비밀번호 관리자는 막지 않는다: `autocomplete="username"`/`"current-password"`).

### 2.5 비밀번호 변경(본인)

- `/account/`: 현재 비밀번호, 새 비밀번호 2번 → `updateUser({ password, current_password })`.
- Supabase 설정: **Require current password** 켬, **Secure password change(재인증 메일)** 끔 — 재인증 nonce 가 메일로 오므로 가짜 이메일 구조에서는 켜면 안 된다.
- 성공하면 "비밀번호를 바꿨습니다." 다른 기기 세션은 그대로 둔다(원하면 `signOut({ scope: 'others' })` 버튼 '다른 기기에서 로그아웃'을 같이 둔다).

### 2.6 화면 문구(오류)

| 상황 | 판정 | 문구 |
|---|---|---|
| 아이디 형식 아님 | 클라이언트 | 아이디를 확인해 주세요. |
| 아이디·비밀번호 틀림 | 400 `invalid_credentials` | 아이디 또는 비밀번호가 맞지 않습니다. |
| 요청 제한 | 429 | 시도가 많습니다. 잠시 후 다시 시도해 주세요. |
| 네트워크·서버 정지 | fetch 실패·5xx | 로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| 비밀번호 규칙 위반(변경 시) | `weak_password` | 비밀번호는 10자 이상, 영문과 숫자를 섞어 주세요. |
| 현재 비밀번호 틀림(변경 시) | 400 | 현재 비밀번호가 맞지 않습니다. |

계정 유무를 구분하는 문구는 쓰지 않는다. 오류 원문은 `console.error` 로만(토큰·비밀번호는 로그에 넣지 않는다).

## 3. 데이터 설계

### 3.1 표

사용자 × 채널 1행. 지금의 `UserState`(북마크·읽음·확인 시각·보험사)를 그대로 담는다.

```sql
create table public.user_state (
  user_id        uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  channel        text        not null check (channel ~ '^[a-z0-9-]{1,32}$'),
  schema_version int         not null default 1,
  bookmarks      jsonb       not null default '{}'::jsonb,   -- { 기사 id: Article }
  read_at        jsonb       not null default '{}'::jsonb,   -- { 기사 id: ISO 시각 }
  last_confirmed timestamptz,
  companies      jsonb       not null default '[]'::jsonb,   -- [정식명]
  rev            bigint      not null default 1,             -- 낙관적 동시성(3.4)
  updated_at     timestamptz not null default now(),
  primary key (user_id, channel),
  constraint user_state_size check (pg_column_size(bookmarks) + pg_column_size(read_at) + pg_column_size(companies) < 2000000)
);

-- 수정 시각은 서버 시계로
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger user_state_touch before update on public.user_state
  for each row execute function public.touch_updated_at();
```

- 기본 키가 `(user_id, …)` 로 시작하므로 RLS 조건(`user_id = auth.uid()`)에 인덱스가 따로 필요 없다.
- 채널 목록은 DB 가 모른다(새 채널을 열 때 DB 변경 불필요).
- 2MB 상한은 오류·악용으로 행이 커지는 것을 막는 안전장치다(정상 최대치의 약 5배).

### 3.2 크기 추정(실측 데이터 기준)

기사 1건 JSON 평균 649바이트(최대 1,334), 읽음 1건 약 46바이트.

| 사용 정도(채널 1개) | 북마크 | 읽음 | 크기 |
|---|---:|---:|---:|
| 가벼움 | 20 | 300 | 약 27KB |
| 보통(읽음 한도 SOFT) | 100 | 1,500 | 약 134KB |
| 최대(읽음 한도 HARD) | 300 | 5,000 | 약 425KB |

- 10명 × 채널 3개 × 보통 ≈ **4MB**, 전원 최대치여도 ≈ 13MB. 무료 플랜 DB 500MB 의 1~3%. jsonb 는 큰 값을 압축(TOAST)하므로 실제로는 더 작다. 수정 때마다 생기는 옛 행 버전은 autovacuum 이 정리한다.
- **egress(무료 월 5GB)가 더 빠듯하다**: 행 전체를 자주 내려받으면(10명 × 하루 30회 × 3채널 × 134KB ≈ 하루 120MB, 월 3.6GB) 한도에 가깝다. 그래서 3.4 처럼 **`rev` 만 먼저 확인하고 바뀌었을 때만 행 전체를 받는다.** 올릴 때 응답도 `rev` 만 받는다. 이렇게 하면 월 수십 MB 수준이다.

### 3.3 병합 규칙

| 상황 | 함수 | 규칙 |
|---|---|---|
| 이 기기가 이 계정과 **처음** 맞출 때(기준본 없음) | 기존 `mergeStates(local, server)` | 합집합. 같은 북마크는 이 기기 것, 읽음은 이른 시각, 확인 시각은 늦은 쪽, 보험사는 순서 유지 뒤 추가, 그 뒤 `pruneReads` |
| 이후 동기화(기준본 있음) | 새 `mergeStates3(base, local, server)` | 아래 표 |

합집합만으로는 **삭제가 전달되지 않는다**(한 기기에서 북마크를 지워도 다른 기기 사본과 합치면 되살아남). 그래서 마지막으로 서버와 맞춘 내용(기준본, `base`)을 기기에 보관하고 3-방향으로 합친다.

| 항목 | 이 기기(local) | 서버(server) | 결과 |
|---|---|---|---|
| 북마크·읽음·보험사의 각 항목 | 있음 | 있음 | 유지(북마크는 이 기기 객체, 읽음은 이른 시각) |
| | 있음 | 없음 | 기준본에 있었으면 **다른 기기에서 지운 것 → 삭제**, 없었으면 이 기기에서 추가한 것 → 유지 |
| | 없음 | 있음 | 기준본에 있었으면 **이 기기에서 지운 것 → 삭제**, 없었으면 다른 기기에서 추가 → 유지 |
| 확인 시각 | | | 더 늦은 쪽 |
| 그 뒤 | | | `pruneReads`(읽음 한도) |

성질(테스트로 확인): `mergeStates3(b, x, b) = x`, `mergeStates3(b, b, y) = y`, 같은 입력을 두 번 합쳐도 같다, 기준본이 없으면 `mergeStates` 와 같다. 첫 연결 때 다른 기기에서 지운 항목이 한 번 되살아날 수 있는 것은 받아들인다(기준본이 없어 구분 불가).

### 3.4 서버와 주고받기(낙관적 동시성)

- **받기**: `select rev` → 기준본의 rev 와 같으면 끝. 다르면 `select *` 로 받아 `mergeStates3(base, local, server)` → 로컬 저장 → 결과가 서버와 다르면 올리기.
- **올리기**: `update … set (내용), rev = rev + 1 where user_id = 나 and channel = c and rev = <기준본 rev> returning rev`.
  - 1행이 바뀌면 성공 → 기준본 = 올린 내용, rev 갱신.
  - 0행이면 그 사이 다른 기기가 올린 것 → 받기부터 다시(최대 3회).
  - 행이 아예 없으면(첫 사용) `insert`. 동시에 두 기기가 insert 해서 기본 키 충돌이 나면 받기부터 다시.
- **언제**: 로그인 직후, 페이지를 열 때, 탭이 다시 보일 때(`visibilitychange`), 보이는 동안 5분마다 받기. 로컬 변경 뒤 2초 모아서(debounce) 올리기. 보내지 못한 변경은 '보낼 것 있음' 표시를 로컬에 남겨 다음 기회에 보낸다.
- 요청 수: 10명 기준 하루 수천 건 수준으로 무료 플랜 한도와 무관하다. 동기화 요청은 Auth 요청 제한(`/auth/v1/token`)에 들어가지 않는다(토큰 갱신만 들어감).

## 4. 접근 규칙(RLS)

### 4.1 정책 SQL 초안

```sql
alter table public.user_state enable row level security;

-- 2026-10-30 이후 새 표는 Data API 에 자동 노출되지 않는다. 필요한 권한만 명시적으로 준다.
revoke all on table public.user_state from anon, authenticated;
grant select, insert, update, delete on table public.user_state to authenticated;

create policy "user_state: 본인 행 읽기"   on public.user_state for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "user_state: 본인 행 만들기" on public.user_state for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "user_state: 본인 행 고치기" on public.user_state for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_state: 본인 행 지우기" on public.user_state for delete to authenticated
  using ((select auth.uid()) = user_id);
```

- `(select auth.uid())` 로 감싸면 문장당 한 번만 계산된다(공식 권장).
- `for all` 정책을 쓰지 않고 작업별로 나눈다(공식 권장).
- anon 은 GRANT 자체가 없으므로 정책과 무관하게 `42501 permission denied`. 대시보드 Data API 설정의 "Automatically expose new tables" 는 꺼진 상태로 둔다.
- `update` 의 `with check` 가 `user_id` 를 남의 것으로 바꾸는 것을 막는다.
- SQL 은 저장소의 `supabase/sql/001_user_state.sql` 에 두고(단계 2), 관리자가 SQL Editor 에서 실행한다. CLI 마이그레이션은 쓰지 않는다(사람 10명 규모에 과함).

### 4.2 검증 절차(정책을 바꿀 때마다)

시험 계정 `test-a`, `test-b` 를 만든다(실사용 계정과 분리). 스크립트 `scripts/audit/rls-check.mjs`(단계 2) — 시험 계정의 아이디·비밀번호는 환경 변수로만 받는다.

| # | 누구로 | 하는 일 | 기대 |
|---|---|---|---|
| 1 | A | 자기 행 insert → select | 성공, 1행 |
| 2 | B | A 의 행 select(`user_id = A`) | 0행 |
| 3 | B | A 의 행 update | 0행 바뀜 |
| 4 | B | `user_id = A` 로 insert | RLS 위반 오류 |
| 5 | B | 자기 행의 `user_id` 를 A 로 update | RLS 위반 오류 |
| 6 | B | A 의 행 delete | 0행 |
| 7 | 로그인 없음(publishable 키만) | select·insert | `42501` 권한 오류 |
| 8 | A | 2MB 넘는 행 update | check 위반 |
| 9 | A | 끝나면 자기 행 delete | 성공 |

보조 수단: 대시보드 SQL Editor 의 역할 전환(impersonation)으로 같은 조회를 해 본다. SQL Editor 기본 연결은 `postgres` 역할이라 RLS 를 우회하므로, 기본 상태의 결과를 검증으로 삼지 않는다.

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
| `heukseok-claimed-v1:<채널>` | 로그인 전 기록을 어느 계정에 합쳤는지(`{ userId, at }`) | 합친 뒤 |
| `heukseok-login-id` | 저장한 아이디 | '아이디 저장' 체크 시 |
| `sb-<ref>-auth-token` | supabase 세션 | supabase-js 가 관리 |

### 5.3 기존 기록 올리기(첫 로그인)

1. 로그인 직후, 이 브라우저의 로그인 전 기록(`heukseok-v1:<채널>`, 없으면 옛 키)이 비어 있지 않고 `claimed` 표시가 없으면 한 번 묻는다:
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
| 실패·오프라인 | 내 데이터 + 헤더 아이디 옆 작은 점 | 이 기기에만 저장됨 · 연결되면 자동으로 보냅니다 |
| 세션 만료 | 로그인 화면으로 이동 | — |

실패해도 화면 사용은 막지 않는다. 같은 오류가 반복되면 `console.error` 에만 남긴다.

## 6. 계정 발급

### 6.1 처음 한 번(관리자, 대시보드)

1. 프로젝트 만들기: 이름 `heukseok`, 리전 **Seoul(ap-northeast-2)**, DB 비밀번호는 비밀번호 관리자에만 보관.
2. Authentication → Sign In / Providers
   - Email provider: **켜 둠**(끄면 비밀번호 로그인 자체가 막힌다).
   - **Allow new users to sign up: 끔** — 기존 계정만 로그인. 관리자 생성은 영향받지 않는다(서버 소스 확인).
   - **Confirm email: 끔**(메일을 보낼 수 없는 주소이므로).
   - Secure password change: 끔, Require current password: 켬(2.5).
   - 비밀번호 최소 길이 10, 필수 문자: 영문 소문자 + 숫자(7.1).
3. Authentication → Rate Limits: 7.2 값.
4. Settings → API Keys: publishable·secret 키 확인, **구 anon·service_role 키 비활성화**.
5. Data API 설정: "Automatically expose new tables" 꺼짐 확인.
6. GitHub 저장소 Variables 에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 등록.

### 6.2 계정 만들기(사용자마다)

- 대시보드 Authentication → Users → Add user → Create new user: 이메일 `<아이디>@users.heukseok.invalid`, 비밀번호, **Auto Confirm User** 체크 **(이 화면은 공식 문서에 설명이 없다 — 첫 계정 때 확인)**.
- 첫 비밀번호는 무작위 14자 이상으로 만들어 직접(대면·1:1 메시지) 전달하고, 첫 로그인 후 `/account/` 에서 바꾸도록 안내한다.
- 대시보드로 안 되면 6.3 스크립트.

### 6.3 스크립트(필요할 때만, 관리자 PC 에서)

`scripts/admin/users.mjs`(단계 4, 선택):

```
SUPABASE_URL=https://<프로젝트 ref>.supabase.co SUPABASE_SECRET_KEY=<secret 키> \
  node scripts/admin/users.mjs create <아이디>        # 무작위 비밀번호를 만들어 화면에 한 번만 출력
  node scripts/admin/users.mjs reset-password <아이디>
  node scripts/admin/users.mjs list
```

- 내부적으로 `auth.admin.createUser({ email, password, email_confirm: true })`, `auth.admin.updateUserById(id, { password })`, `auth.admin.listUsers()`.
- secret 키는 **명령을 칠 때 환경 변수로만** 준다. 파일(`.env`)에 저장하지 않는 것을 권장, 저장한다면 저장소 밖 경로. 스크립트는 키를 출력·로그하지 않고, 키가 `sb_secret_` 로 시작하지 않으면 거절, 브라우저 번들에 들어가지 않는 위치(`scripts/`)에 둔다.
- 셸 기록에 키가 남지 않게 하려면 명령 앞에 공백을 두거나(zsh `HIST_IGNORE_SPACE`) `read -s SUPABASE_SECRET_KEY` 로 입력받는다.

### 6.4 비밀번호 초기화·계정 삭제

- 사용자가 비밀번호를 잊으면: 관리자에게 말한다 → 관리자가 6.3 `reset-password`(또는 대시보드에 비밀번호 설정 화면이 있으면 그것) → 새 임시 비밀번호 전달 → 사용자가 바꿈. 메일 재설정은 쓰지 않는다.
- 삭제 요청: 대시보드 Users → 사용자 삭제. `on delete cascade` 로 `user_state` 행도 함께 지워진다.

## 7. 보안·개인정보 점검 목록

### 7.1 비밀번호

- [ ] 최소 10자, 영문 소문자 + 숫자 필수(서버 설정). 첫 비밀번호는 관리자가 무작위 14자 이상.
- [ ] 유출 비밀번호 차단(HaveIBeenPwned)은 Pro 전용이라 없음 → 첫 비밀번호를 무작위로 주고, 다른 사이트 비밀번호를 쓰지 말라고 안내문에 적는다.

### 7.2 무차별 대입

- 기본 한도: `/auth/v1/token`(비밀번호 로그인 + 토큰 갱신) IP 당 5분 150회. 계정 단위 잠금은 공식 문서에서 찾지 못했다(없다고 보고 설계).
- [ ] Rate Limits 에서 토큰 한도를 **5분 30회**로 낮춘다(10명이 정상 사용으로 닿지 않는 값. 토큰 갱신도 여기에 들어가므로 너무 낮추지 않는다).
- [ ] CAPTCHA(Cloudflare Turnstile, hCaptcha)는 지원되지만 처음에는 켜지 않는다. 감사 로그(무료 1시간 보관)·사용량 그래프에서 이상 시도가 보이면 켠다(단계 5).
- [ ] 아이디가 짐작 가능하므로(이름 기반 등) 비밀번호 강도에 기댄다.

### 7.3 무료 플랜 일시 중지·백업 부재

- 7일 동안 활동(DB 요청·API 호출·대시보드 방문)이 적으면 프로젝트가 멈춘다. 멈추기 약 1주 전과 멈춘 뒤 소유자에게 메일이 온다. 대시보드 "Resume project" 로 데이터 그대로 복구(정지 후 1년까지).
- 멈춘 동안: 이미 로그인한 기기는 로컬 사본으로 계속 쓰고 동기화만 실패한다. **새 로그인은 불가** → 9장 결정 사항(로그인 서버 장애 때 화면을 열어 둘지).
- [ ] 사용자 10명이 매일 쓰면 멈출 일은 거의 없다. 방학 등으로 쓰는 사람이 없을 때를 대비해: 관리자가 정지 예고 메일을 받으면 대시보드를 한 번 연다. (자동 유지 요청을 Actions 로 보내는 방법은 '어떤 요청이 활동으로 잡히는지' 공식 기준이 모호해 기본안에서 뺀다.)
- [ ] 자동 백업 없음(무료) → 관리자가 월 1회 `supabase db dump --data-only -f <저장소 밖 경로>`(공식 CLI) 또는 6.3 스크립트에 `export` 명령(모든 사용자 상태를 JSON 1개로)을 둔다. 각 사용자도 내 데이터 → 파일로 내려받기(지금 기능 유지)로 스스로 백업할 수 있다.

### 7.4 저장하는 개인정보(최소화)

| 항목 | 어디 | 비고 |
|---|---|---|
| 아이디(가짜 이메일 형태) | Supabase Auth | 실명·실제 이메일 받지 않음 |
| 비밀번호 해시 | Supabase Auth | 운영자도 원문을 볼 수 없음 |
| 마지막 로그인 시각, 세션의 IP·브라우저 정보 | Supabase Auth | Supabase 가 보안 목적으로 남김(감사 로그 무료 1시간) |
| 채널별 북마크·읽은 기사와 시각·새 뉴스 확인 시각·선택한 보험사 | `user_state` | 사이트 기능에 필요한 것만 |

- 분석·광고 스크립트 없음(지금과 같음). 사용자 메타데이터(`user_metadata`)에 아무것도 넣지 않는다.
- 공개 저장소 규칙: 실제 아이디 목록·사용자 수 이외의 정보를 문서·코드·커밋 메시지에 쓰지 않는다.

### 7.5 화면·코드

- [ ] `next` 파라미터 검증(열린 리디렉트 방지, 2.2).
- [ ] 동기화로 받은 북마크도 지금 가져오기와 같은 정리(`cleanState`)를 거친 뒤 화면에 쓴다(링크는 기존 `isSafeUrl` 검사 유지).
- [ ] 비밀값 검사 테스트(1.3), 빌드 결과물 검사.
- [ ] GitHub Pages 는 응답 헤더를 못 바꾸므로 CSP 는 `<meta http-equiv="Content-Security-Policy">` 로만 가능 — `connect-src 'self' https://<프로젝트 ref>.supabase.co` 를 단계 5 에서 검토(인라인 스크립트가 있어 hash 기반이어야 함).

### 7.6 이용 안내(한 장) 초안

푸터 둘째 줄의 '문의·제안' 앞에 **'이용 안내'** 링크(`/about/`, noindex). 로그인 화면 아래에도 같은 링크.

> **흑석일보 이용 안내**
>
> **저장하는 것** — 아이디와 비밀번호(암호화되어 저장되며 운영자도 볼 수 없습니다), 채널별 북마크, 읽은 기사와 읽은 시각, 새 뉴스 확인 시각, 선택한 보험사. 로그인 시각과 접속 정보는 보안을 위해 짧게 기록됩니다.
>
> **저장하지 않는 것** — 이메일, 실명, 연락처. 광고·방문 분석 도구를 쓰지 않습니다.
>
> **저장 위치** — 로그인과 기록은 Supabase(서울 리전) 서버에, 같은 기록의 사본은 이 브라우저에 저장됩니다.
>
> **기록 내려받기·삭제** — 내 데이터 화면에서 기록을 파일로 내려받을 수 있습니다. 계정과 기록 삭제를 원하면 운영자에게 말씀해 주세요. 삭제하면 되돌릴 수 없습니다.
>
> **비밀번호** — 다른 사이트에서 쓰는 비밀번호를 쓰지 마세요. 잊어버리면 운영자에게 말씀해 주세요.
>
> 기사는 각 언론사·기관의 공개 자료로, 제목과 링크만 보여 줍니다. 저작권은 각 언론사에 있습니다.

## 8. 화면 영향

- **로그인 화면 `/login/`**: 가운데 카드 1개(폭 360px) — 워드마크(높이 44px) → 아이디 → 비밀번호 → '아이디 저장' 체크 → [로그인] 버튼 → 오류 줄(`role="alert"`) → 아래 '이용 안내' 링크. 채널 색을 쓰지 않는 중립 색: 버튼 바탕 `--text`(#16202B, 흰 글자 16.5:1), 포커스 2px `--text`. 바탕 `--bg`, 카드 `--surface`, 테두리 `--line`, 입력 테두리 `--line-strong`(3.6:1). 홈과 같은 위 테두리 3px `--text`. 키보드: 아이디 칸 자동 포커스(저장된 아이디가 있으면 비밀번호 칸), Enter 로 제출, 제출 중 버튼 비활성.
- **홈 상단 줄**: 지금 오른쪽 '내 데이터' 자리에 **아이디 메뉴**(사람 아이콘 + 아이디 ▾) → 내 데이터 · 비밀번호 변경 · 로그아웃.
- **채널 헤더**: 보조 메뉴의 '내 데이터' 뒤에 같은 아이디 메뉴. 모바일(≤640px)은 햄버거 메뉴 안 맨 아래에 '아이디 · 로그아웃' 줄. 동기화 실패면 아이디 옆 작은 점(5.4).
- **내 데이터**: 안내 문구를 "북마크·읽음 기록·새 뉴스 확인 시각·선택한 보험사는 계정에 저장되어 로그인한 모든 기기에서 같습니다." 로 바꾸고 동기화 상태 한 줄을 더한다. 파일 백업·복원은 그대로 둔다(가져오기는 계정 사본과 합친 뒤 올림). '이 브라우저의 이전 기록 합치기' 버튼(5.3).
- **`/account/`**: 비밀번호 변경 폼, '이 기기에서 로그아웃', '다른 기기에서 모두 로그아웃'.
- 토큰은 지금 `globals.css` 의 `:root` 토큰만 쓴다. 새 색 없음.

## 9. 테스트 계획

### 9.1 자동(npm test, 로그인 없이 돌아감)

| 대상 | 내용 |
|---|---|
| `mergeStates3` | 3.3 표의 모든 칸, 성질 4개(기준본=서버면 로컬 그대로 등), 읽음 한도 적용, 보험사 순서 |
| `lib/sync.ts`(가짜 Supabase 클라이언트) | rev 같음 → 받지 않음 / 다름 → 병합·올림 / 올리기 0행 → 다시 받기(최대 3회) / insert 충돌 / 네트워크 오류 → 보낼 것 표시 유지 / 로그아웃 시 사용자 키 삭제 / 다른 사용자 키와 섞이지 않음 |
| 첫 로그인 합치기 | 로그인 전 기록 있음·없음·이미 claimed, 옛 키만 있음 |
| 로그인 게이트 스크립트 | 토큰 없음 → `/login/?next=` 로(해시 보존), 있음 → 그대로, `next` 검증(외부 주소·`//`·`/login` 거절) |
| 아이디 → 이메일 | 형식 검사, 소문자화, 공백 제거 |
| 비밀값 검사 | 저장소·`out/` 에 secret 키 패턴 없음 |
| 로그인 기능 꺼진 빌드 | 환경 변수 없으면 게이트·메뉴 없음, 지금과 같은 화면(기존 동등성 검사 통과) |

### 9.2 수동·반자동

- RLS: 4.2 절차(`scripts/audit/rls-check.mjs`, 시험 계정 2개). 정책을 바꿀 때마다.
- Playwright(결과는 /tmp): 로그인 안 한 상태로 `/`·`/insurance/`·`/ai/` → `/login/`(noindex) / 로그인 → 홈 / 아이디 저장 / 틀린 비밀번호 문구 / 로그아웃 후 사용자 키 삭제 / 두 브라우저(같은 계정)에서 북마크 추가·삭제가 서로 전달 / 오프라인(네트워크 차단) 중 변경 → 복구 후 전달 / 1440·390px 캡처.
- 보안 점검: 7장 체크리스트, 번들 검색(`out/` 에서 `sb_secret_`·`service_role` 0건), 로그인 연속 실패로 429 문구 확인.

### 9.3 끄기 스위치

- 로그인 전체를 끄기: GitHub Variables 에서 두 값을 지우고(또는 `NEXT_PUBLIC_AUTH=off`) 배포 → 지금 사이트로 돌아감. 사용자 기기의 `heukseok-v1:<채널>@<id>` 사본은 남아 있으므로, 끈 동안에는 로그인 전 키(`heukseok-v1:<채널>`)를 쓴다(그동안 변경은 다시 켤 때 5.3 으로 합칠 수 있음).
- 동기화만 끄기: `NEXT_PUBLIC_SYNC=off` → 로그인은 유지, 계정 사본으로 로컬만 동작.

## 10. 단계별 구현안

각 단계는 별도 커밋. 앞 단계가 끝나야 다음 단계로 간다.

| 단계 | 내용 | 완료 기준 | 되돌리기 |
|---|---|---|---|
| **0. 준비** (사용자) | Supabase 프로젝트 생성·설정(6.1), 시험 계정 2개 + 본인 계정, GitHub Variables 등록 | 대시보드에서 계정 3개 확인, Variables 2개 | 프로젝트 삭제 |
| **1. 로그인 화면 + 세션** (Claude) | `@supabase/supabase-js` 추가, `lib/supabase.ts`·`lib/auth.ts`, 게이트 스크립트, `/login/`, `/account/`(비밀번호 변경·로그아웃), 홈·헤더 아이디 메뉴, 비밀값 검사 테스트, deploy.yml 에 변수 전달 | 9.1 게이트·아이디 테스트, Playwright 로그인 흐름, `.invalid` 계정으로 실제 로그인·비밀번호 변경 성공(호스팅 실측), 기존 동등성 검사 통과 | Variables 삭제 후 배포(코드 그대로 꺼짐), 또는 커밋 revert |
| **2. 표 + RLS** (사용자 SQL 실행, Claude 가 SQL·검사 스크립트 작성) | `supabase/sql/001_user_state.sql`, `scripts/audit/rls-check.mjs` | 4.2 9개 항목 통과 | `drop table public.user_state` |
| **3. 동기화** (Claude) | `mergeStates3`, `lib/sync.ts`, `accountStore`, `useSaved` 구독, 첫 로그인 합치기, 상태 표시, 로그아웃 시 정리 | 9.1 동기화 테스트, 두 브라우저·오프라인 시험, 1주 사용 중 데이터 유실 신고 없음 | `NEXT_PUBLIC_SYNC=off` |
| **4. 문구·안내·운영** (Claude, 일부 사용자) | `/about/` 이용 안내·푸터 링크, 내 데이터 문구, `scripts/admin/users.mjs`(선택)·백업 내보내기, docs 갱신(architecture·ops-notes) | 안내 페이지 noindex, 관리자 백업 1회 실행 | 커밋 revert |
| **5. 다듬기** (선택) | Rate limit 조정 확인, CAPTCHA 검토, CSP meta 검토 | 7장 체크리스트 완료 | 설정 원복 |

**사용자(관리자)가 직접 하는 일**: Supabase 가입·프로젝트 생성(서울 리전), 6.1 설정 전부, 계정 발급과 비밀번호 전달, GitHub Variables 등록, 단계 2 SQL 실행, 시험 계정 비밀번호를 로컬 환경 변수로 보관, 정지 예고 메일 확인, 월 1회 백업, 삭제 요청 처리.

**Claude Code 가 하는 일**: 코드·테스트·문서, SQL·검사 스크립트 작성(실행은 관리자), Playwright 검증, 배포 확인. secret 키는 받지 않고 다루지 않는다(RLS 검사도 시험 계정 로그인으로만).

## 11. 확장 지점(다음 단계, 방향만)

- **공개 프로필**: 다른 사용자에게 아이디를 보여 줘야 하므로 `profiles(user_id pk → auth.users, display_id text unique)` 를 둔다. `auth.users` 는 노출하지 않는다. select 는 authenticated 전체, insert/update 는 본인(또는 관리자만).
- **댓글**: `comments(id bigint identity pk, channel text, article_id text /* 16자리 기사 id */, user_id uuid default auth.uid(), body text check (char_length(body) between 1 and 1000), created_at timestamptz default now(), deleted_at timestamptz)`, 인덱스 `(channel, article_id, created_at)`. RLS: select 는 authenticated 전체(`deleted_at is null`), insert 는 `user_id = auth.uid()`, update(본문 수정·삭제 표시)는 본인만, 실제 delete 는 관리자만. 화면은 기사 카드에서 건수 → 펼침. 같은 기사가 다른 채널에도 있을 수 있어 키는 `(channel, article_id)`.
- **전체 채팅방**: `chat_messages(id bigint identity pk, user_id uuid default auth.uid(), body text check (char_length(body) between 1 and 500), created_at timestamptz default now())`. 최근 것만 보관 — 넣을 때 트리거로 최근 500건(또는 30일)만 남기고 지운다. 실시간은 Supabase Realtime(Postgres Changes 또는 Broadcast). 무료 한도: 동시 연결 200, 월 메시지 200만, 초당 100 — 10명에게 충분. RLS: select·insert 는 authenticated, update 없음, delete 는 본인·관리자.
- 공통: 모든 표는 `revoke all … from anon` + 필요한 권한만 `grant … to authenticated`, 작업별 정책, `(select auth.uid())`. 글 내용은 React 텍스트로만 그린다(HTML 해석 금지). 신고·차단은 10명 규모라 관리자가 대시보드에서 처리.

## 12. 정해야 할 것(관리자 결정)

1. **로그인 서버가 멈췄을 때**(무료 플랜 정지·장애): 새 로그인 불가를 그대로 둘지(기본안), 연결 실패일 때만 로그인 없이 읽기 전용으로 열어 둘지.
2. **검색 노출**: 로그인 게이트가 생기면 자바스크립트를 실행하는 검색 로봇은 로그인 화면(noindex)만 보게 되어 사실상 검색에서 빠진다. 그대로 둘지(기본안), 채널 페이지를 명시적으로 noindex 할지.
3. **첫 로그인 합치기**를 묻고 합칠지(기본안), 묻지 않고 자동으로 합칠지.
4. **비밀번호 규칙**: 10자 + 영문·숫자(기본안) 또는 다른 값. 토큰 요청 한도 5분 30회(기본안).
5. **수집 상태 페이지**(`/<채널>/status/`)도 로그인 뒤에 둘지(기본안: 다른 페이지와 같이 로그인 필요).
