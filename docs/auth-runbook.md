# 로그인 서버 실행 절차서(관리자용)

맥에서 위에서부터 한 단계씩 따라 하는 문서다. 설계 배경은 [auth-plan.md](auth-plan.md), 이 문서가 쓰는 파일은 다음과 같다.

| 파일 | 하는 일 |
|---|---|
| `supabase/migrations/0001_init.sql` | 표 3개·권한·트리거(SQL Editor 에 붙여 넣어 실행) |
| `scripts/admin/users.mjs` | 계정 관리: `check`·`create`·`reset-password`·`list`·`disable`·`enable` |
| `scripts/admin/verify.mjs` | 보안 자동 검증(임시 시험 계정을 만들고 검사한 뒤 지움) |

## 0. 시작 전에 지킬 것

- **비밀 키·학번·비밀번호는 어디에도 붙여 넣지 않는다**: 저장소 파일, 커밋 메시지, 이슈, 대화창(Claude 포함), 스크린샷. 스크립트 출력에는 이 값들이 나오지 않게 만들어 두었다(출력을 그대로 공유해도 된다).
- 비밀 키와 계정 목록은 맥의 `~/.heukseok/` 폴더에만 둔다. 저장소 폴더 안에 두면 스크립트가 실행을 거절한다.
- 이 문서의 예시 값(`<프로젝트 ref>`, `kim`, `김가짜`, `00000000` 등)은 모두 가짜다.
- 모든 스크립트는 **기본이 모의 실행**이다. 화면에 '할 일'만 보여 주고 아무것도 바꾸지 않는다. 확인한 뒤 같은 명령에 `--apply` 를 붙여야 실제로 반영된다.

## 1. 맥 준비(처음 한 번)

### 1-1. 터미널을 열고 저장소로 이동

```sh
cd ~/dev/heukseoknews.github.io
git pull
node --version        # v20 이상이면 된다
```

### 1-2. 비밀 폴더 권한 확인

```sh
ls -la ~/.heukseok/
chmod 700 ~/.heukseok
chmod 600 ~/.heukseok/supabase.env ~/.heukseok/accounts.csv
```

`supabase.env` 는 한 줄이다(값은 대시보드 Settings → API Keys 의 secret 키 `admin_script`, `sb_secret_` 로 시작).

```
SUPABASE_SECRET_KEY=<비밀 키>
```

- 파일 위치를 바꾸고 싶으면 `export HEUKSEOK_SECRET_ENV=<다른 경로>`.
- 예전 JWT 방식 키(`eyJ…`)는 쓰지 않는다(스크립트가 거절). 대시보드 Settings → API Keys 에서 예전 키(anon·service_role)는 꺼 둔다.

### 1-3. 계정 목록 파일 `~/.heukseok/accounts.csv`

첫 줄은 열 이름, 그다음 한 사람이 한 줄이다(가짜 예시).

```
login_id,display_name,student_no
kim,김가짜,00000000
lee,이가짜,00000001
```

| 열 | 규칙 |
|---|---|
| `login_id` | 영문 소문자로 시작, 소문자·숫자·`_`·`-`·`.` 3~20자. 대문자로 적어도 소문자로 바뀐다 |
| `display_name` | 1~20자, 다른 사람과 겹치지 않게(댓글·채팅에 보일 이름) |
| `student_no` | 초기 비밀번호. 8자 이상(서버 최소 길이), 공백 없이, 아이디를 포함하지 않게 |

- 쉼표가 든 이름은 `"김, 가짜"` 처럼 큰따옴표로 감싼다. 엑셀에서 만들면 'CSV UTF-8' 로 저장한다.
- 다른 파일을 쓰려면 명령에 `--csv <경로>` 를 붙인다(파일 이름이 `accounts…csv` 이면 저장소 무시 목록에도 걸린다).

### 1-4. 터미널 변수(비밀 아님)

새 터미널 창을 열 때마다 한 번 입력한다.

```sh
export SUPABASE_URL=https://<프로젝트 ref>.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable 키>
```

- 둘 다 대시보드에서 찾는다: 프로젝트 URL 은 Settings → Data API(또는 프로젝트 홈의 'Project URL'), publishable 키(`sb_publishable_…`)는 Settings → API Keys.
- 이 두 값은 브라우저에 공개되는 값이라 비밀이 아니다. 그래도 저장소에는 쓰지 않는다(빌드 변수로 따로 넣는다, 12장).

## 2. SQL 적용

1. 대시보드 → 왼쪽 **SQL Editor** → **New query**.
2. 저장소의 `supabase/migrations/0001_init.sql` 을 텍스트 편집기로 열어 **전체를 복사**해 붙여 넣는다.
3. **Run**. 'Success. No rows returned' 가 나오면 된다. 경고 창('destructive operation')이 뜨면 내용(정책을 지웠다 다시 만드는 줄)을 확인하고 실행한다.
4. 여러 번 실행해도 결과가 같다. SQL 파일을 고친 뒤에도 같은 방법으로 다시 실행한다.

확인 쿼리(새 query 에 하나씩 붙여 Run):

```sql
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
 group by 1, 2 order by 1, 2;
```

| table_name | grantee | 기대 |
|---|---|---|
| account_security | authenticated | SELECT |
| account_security | service_role | DELETE,INSERT,SELECT,UPDATE |
| profiles | authenticated | SELECT |
| profiles | service_role | DELETE,INSERT,SELECT,UPDATE |
| user_state | authenticated | DELETE,INSERT,SELECT,UPDATE |
| user_state | service_role | DELETE,INSERT,SELECT,UPDATE |

**anon 줄이 하나도 없어야 한다.** (다른 표가 더 있으면 그 표 줄은 무시)

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';                    -- 세 표 모두 true
select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 3; -- profiles 1, account_security 1, user_state 4
select event_object_table, trigger_name from information_schema.triggers
 where trigger_name in ('on_auth_user_created','on_auth_password_changed','user_state_touch','user_state_limits') order by 1, 2;
-- users: on_auth_password_changed, on_auth_user_created / user_state: user_state_limits, user_state_touch
```

주의: SQL Editor 는 관리자(`postgres`) 권한으로 돌아 RLS 를 무시한다. 여기서 표가 보인다고 사용자에게도 보이는 것이 아니다. 실제 사용자 권한 확인은 4장 자동 검증으로 한다.

## 2-1. 표시 이름 변경 SQL 적용(0002)

사용자가 마이페이지 → 계정에서 자기 표시 이름을 바꾸게 하는 서버 함수(`public.set_display_name`)와 열(`profiles.display_name_changed_at`)을 만든다. 0001 을 적용한 뒤에 한다. 사이트 화면은 이 SQL 보다 먼저 배포돼도 깨지지 않는다(저장할 때 '아직 준비 중' 한 줄만 보임).

1. 대시보드 → **SQL Editor** → **New query**(새 쿼리 탭. 0001 을 붙였던 탭을 다시 쓰지 않는다).
2. `supabase/migrations/0002_display_name.sql` **전체를 복사**해 붙여 넣고 **Run**. 'Success. No rows returned' 면 된다. 여러 번 실행해도 결과가 같다.
   - `0001_init.sql 을 먼저 적용하세요` 로 멈추면 2장을 먼저 한다.
3. 확인 쿼리(새 query 에 붙여 Run):

```sql
select grantee, privilege_type from information_schema.routine_privileges
 where routine_schema = 'public' and routine_name = 'set_display_name' order by 1;
-- authenticated EXECUTE (+ postgres 등 관리 역할). anon·PUBLIC 줄이 없어야 한다
```

4. 이어서 4장 `verify --apply` 를 돌린다. 2-1·4-1·5-1 번(표시 이름) 항목이 모두 ✓ 여야 한다.

되돌리기: 0002 파일 끝의 주석 두 줄(`drop function …`, `alter table … drop column …`)을 새 query 에 붙여 실행한다. 이미 바꾼 표시 이름은 그대로 남는다.

## 3. 연결 확인(`check`, 읽기만)

```sh
node scripts/admin/users.mjs check
```

기대 출력(모두 ✓):

```
✓ Auth 관리 API(비밀 키, apikey 헤더) — 계정 조회 가능(첫 페이지 0건)
✓ 표 profiles 읽기(service_role) — SQL 적용됨
✓ 표 account_security 읽기(service_role)
✓ 표 user_state 읽기(service_role)
✓ 로그인 안 한 요청(publishable 키)으로 profiles 읽기 차단 — 막힘(HTTP 401)
✓ 로그인 안 한 요청(publishable 키)으로 account_security 읽기 차단 — 막힘(HTTP 401)
✓ 로그인 안 한 요청(publishable 키)으로 user_state 읽기 차단 — 막힘(HTTP 401)
모두 정상
```

- 첫 줄이 `needs_bearer … HEUKSEOK_ADMIN_BEARER=1` 로 실패하면: 공식 권장 방식(키를 `apikey` 헤더에만)으로는 Auth 관리 API 가 막히고, `Authorization: Bearer` 를 더하면 통과한다는 뜻이다(14장 근거). `export HEUKSEOK_ADMIN_BEARER=1` 을 입력하고 `check` 를 다시 실행한다. 이 설정은 Auth 관리 API 요청에만 적용된다.
- 다른 실패는 11장 표를 본다.

## 4. 보안 자동 검증(`verify`)

```sh
node scripts/admin/verify.mjs            # 할 일 목록만(모의 실행)
node scripts/admin/verify.mjs --apply    # 실제 검증
```

- 임시 시험 계정 `zz-verify-a`, `zz-verify-b` 를 무작위 비밀번호로 만들고(화면에 안 보임), 아래를 확인한 뒤 **지운다**(중간에 실패해도 지운다).
  1. 계정을 만들면 '변경 필요'가 켜지고 프로필이 생긴다
  2. 로그인 안 한 요청은 세 표 모두 읽기·쓰기가 막힌다(anon)
  3. 비밀번호를 바꾸기 전에는 자기 `user_state` 도 읽기 0행·쓰기 막힘
  4. 표시 이름·관리자 표시·'변경 필요'를 사용자가 고칠 수 없다
  5. 비밀번호를 바꾸면(현재 비밀번호 필요) '변경 필요'가 꺼지고 `user_state` 를 쓸 수 있다
  6. 다른 사용자의 행은 읽기·고치기·지우기·대신 만들기 모두 안 된다
  7. 서버 상한(채널당 북마크 3,000·폴더 100·태그 200·메모 1,000자·북마크당 태그 50·사용자당 채널 10)을 넘으면 거절, 화면 한도를 넘는 '합친 결과'(북마크 2,000·폴더 40·태그 100)는 저장된다
  8. 내부 함수는 밖에서 부를 수 없다
  9. 관리자 초기화 뒤 다시 막히고, 새 비밀번호로 로그인해도 '변경 필요'가 유지된다
  - 표시 이름(0002, 2-1장): 로그인 안 한 요청·비밀번호 변경 전 호출은 막힘(2-1·4-1), 변경 후에는 자기 이름을 바꿀 수 있고 profiles 에 반영, 21자·빈 값·공백만·줄바꿈 거절, 다른 사용자 이름(대소문자·공백만 다른 것 포함) 거절, 10분 안 재변경 거절, profiles 직접 고치기는 여전히 막힘(5-1)
- 마지막 줄이 `모두 통과(N건)` 이면 끝. 실패가 있으면 출력 전체를 그대로 공유한다(비밀이 들어 있지 않다).
- 로그인을 4번 정도 하므로 로그인 제한(5분 30회)에 걸리지 않는다. 연달아 여러 번 돌릴 때만 5분 쉰다.

## 5. 관리자(본인) 계정 만들기

1. `~/.heukseok/accounts.csv` 에 본인 줄이 있는지 확인한다.
2. 모의 실행 → 반영 → 확인:

```sh
node scripts/admin/users.mjs create            # '대상 N건' 과 각 줄을 확인
node scripts/admin/users.mjs create --apply
node scripts/admin/users.mjs list
```

3. 관리자 표시(지금은 화면·권한에 쓰지 않는 표시용, 나중에 댓글 관리 등에 씀): SQL Editor 에서

```sql
update public.profiles set is_admin = true where login_id = '<내 아이디>';
```

CSV 에 친구들 줄도 이미 있다면, 2번에서 함께 만들어진다. 본인만 먼저 만들고 싶으면 본인 줄만 든 파일을 따로 만들어 `--csv ~/.heukseok/accounts-me.csv` 로 실행한다.

## 6. 테스트 계정 1~2개(선택)

로그인 화면(세션 A 작업)이 나온 뒤 직접 로그인해 보고 싶을 때 만든다. 지금 서버 확인은 4장이 대신한다.

1. `~/.heukseok/accounts-test.csv` 를 만든다(가짜 예시, 초기 비밀번호는 8자 이상 아무 값).

```
login_id,display_name,student_no
test-a,시험 A,<8자 이상 임시 값>
test-b,시험 B,<8자 이상 임시 값>
```

2. `node scripts/admin/users.mjs create --csv ~/.heukseok/accounts-test.csv` → 확인 → `--apply`.
3. 로그인 화면에서: 초기 비밀번호로 로그인 → 비밀번호 변경 화면으로 강제 이동 → 바꾼 뒤 이용 가능한지 본다.

## 7. 테스트 계정 정리

- `verify` 의 `zz-verify-*` 는 자동으로 지워진다. `list` 에 남아 있으면 대시보드에서 지운다.
- 6장 계정: 대시보드 → Authentication → Users → 해당 사용자 `…` → **Delete user**. 세 표의 행도 함께 지워진다. 잠깐 쉬게만 하려면 `disable`(10장).

## 8. 실제 친구 계정 일괄 생성

1. `~/.heukseok/accounts.csv` 에 모두 적는다(1-3 규칙).
2. 모의 실행:

```sh
node scripts/admin/users.mjs create
```

   - `대상 N건`: 이번에 만들 계정
   - `건너뜀`: 이미 있는 아이디(다시 실행해도 안전)
   - `검증 실패`: 그 줄만 만들지 않는다(줄 번호와 이유가 나온다 — 아이디 형식, 표시 이름 중복·길이, 학번 8자 미만 등). 고친 뒤 다시 실행한다.
3. 반영: `node scripts/admin/users.mjs create --apply` → 마지막 줄 `끝: 만듦 N, 건너뜀 N, 검증 실패 N, 실패 N`.
4. 확인: `node scripts/admin/users.mjs list` — 모두 '변경 필요'·'사용 중'.
5. 전달: 각자에게 **아이디만** 알려 주고 "초기 비밀번호는 본인 학번, 처음 로그인하면 바로 새 비밀번호로 바꿔야 한다"고 안내한다.
6. 학번은 같은 반 사람이 알 수 있으므로 **로그인 화면이 배포된 뒤에 만들고 바로 첫 로그인을 하도록** 한다. 며칠 뒤 `list` 에서 '변경 필요'가 남은 계정은 재촉하거나 `disable` 한다.

## 9. 비밀번호 재초기화(잊어버렸을 때)

```sh
node scripts/admin/users.mjs reset-password <아이디>            # 모의 실행
node scripts/admin/users.mjs reset-password <아이디> --apply
```

- 초기 비밀번호는 CSV 의 그 사람 학번이다. 마지막 줄이 `완료: … 첫 로그인 변경 필요 = 켬(확인함)` 이면 끝.
- 순서가 중요해서 스크립트가 지킨다: ① 초기화 진행 표시 → ② 비밀번호 변경 → ③ '변경 필요' 켬 → ④ 다시 읽어 확인. 실패하면 같은 명령을 다시 실행한다.
- 이미 로그인해 있던 기기는 최대 1시간 동안 세션이 남지만, '변경 필요'가 켜져 있어 그동안 동기화는 막힌다.

## 10. 사용 중지·다시 사용·삭제

```sh
node scripts/admin/users.mjs disable <아이디> --apply   # 로그인·토큰 갱신 불가(기록은 남음)
node scripts/admin/users.mjs enable <아이디> --apply    # 다시 사용
```

삭제는 대시보드 → Authentication → Users → **Delete user**(기록도 함께 삭제, 되돌릴 수 없음).

## 11. 문제가 생겼을 때

| 증상 | 원인 | 대처 |
|---|---|---|
| `비밀 키 파일을 읽을 수 없습니다` | 경로·이름 오타 | `ls -la ~/.heukseok/` 로 `supabase.env` 확인 |
| `새 방식 비밀 키(sb_secret_ 로 시작)가 아닙니다` | 예전 JWT 키를 넣음 | API Keys 에서 secret 키(`sb_secret_…`)를 다시 복사 |
| `경고: … chmod 600` | 다른 사용자도 읽을 수 있는 권한 | `chmod 600 ~/.heukseok/supabase.env` |
| `저장소 폴더 안에 있습니다` | 키·CSV 를 저장소에 둠 | `~/.heukseok/` 로 옮기고 저장소에서 지운다(커밋했다면 12장 유출 절차) |
| `check` 첫 줄 HTTP 401/403 | 키가 틀림·꺼짐, 또는 헤더 방식 | 키를 다시 확인. `needs_bearer` 이면 3장 안내대로 |
| `check` 표 읽기 HTTP 404(`PGRST205`) | SQL 을 아직 실행하지 않음 | 2장 |
| `check` 표 읽기 HTTP 401/403(`42501`) | service_role GRANT 누락 | 2장 SQL 을 다시 실행, 확인 쿼리 |
| anon 차단 줄이 ✗ '읽혔습니다' | anon 에 권한이 생김 | 즉시 2장 SQL 재실행 후 확인 쿼리. 그래도 anon 줄이 있으면 `revoke all on table public.<표> from anon;` |
| `create` 실패 `HTTP 500 … Database error creating new user` | 트리거 오류(표 모양이 다름 등) | 2장 SQL 재실행. 대시보드 Logs → Postgres 에서 오류 원문 확인 |
| `create` 실패 `no_profile` | 이메일 형식이 아니거나 아이디·표시 이름이 다른 계정과 겹쳐 프로필이 안 생김 | `list` 로 확인 → 대시보드에서 그 사용자 삭제 → CSV 고친 뒤 다시 `create` |
| `주의: 프로필 없는 Auth 계정` | 대시보드에서 직접 만든 계정 등 | 아이디 계정이면 대시보드에서 지우고 스크립트로 다시 만든다 |
| `create` 실패 `HTTP 422 weak_password` | 초기 비밀번호가 서버 규칙에 걸림 | 대시보드 Authentication → 비밀번호 규칙(필수 문자 종류) 꺼짐 확인 |
| SQL 실행이 `필요한 열이 없습니다: …` 로 멈춤 | 예전에 다른 모양으로 만든 표가 있음 | 아직 실제 데이터가 없으면 확인 쿼리의 표를 지우고(`drop table public.user_state, public.account_security, public.profiles;`) 다시 실행 |
| `verify` 7번 '합친 결과 저장' ✗ 또는 '3,001건 거절' ✗ | 예전 상한(북마크 1,000 등)의 SQL 이 적용돼 있음 | 2장 SQL 을 다시 실행(여러 번 실행해도 안전, 상한 함수만 새것으로 바뀜) |
| `HTTP 429` | 로그인 제한(5분 30회) | 5분 기다린다 |
| 모든 요청 실패·대시보드에 'Paused' | 무료 플랜 일시 중지 | 대시보드 **Resume project**. 그동안 사이트 기사 읽기·기기 안 북마크는 그대로 된다 |

## 12. 키가 유출됐을 때(또는 의심될 때)

1. **바로** 대시보드 → Settings → API Keys → secret 키 `admin_script` 삭제(이 순간부터 그 키는 못 쓴다).
2. 같은 화면에서 새 secret 키를 만들고(이름 예: `admin_script_2`) `~/.heukseok/supabase.env` 의 값을 바꾼다.
3. `node scripts/admin/users.mjs check` 로 새 키 확인.
4. 원인 제거: 키가 들어간 파일·셸 기록(`history | grep sb_secret_`)·메모를 지운다. 공개 저장소에 커밋됐으면 키를 먼저 지운 뒤 이력 정리 여부를 따로 정한다.
5. 피해 확인: `list` 로 모르는 계정·상태 변화, 대시보드 Authentication → Users·Table Editor 에서 이상한 변경을 본다.

publishable 키는 공개용이라 유출 대상이 아니다. 바꾸고 싶으면 새로 만들고 빌드 변수(13장)를 바꾼 뒤 옛 키를 지운다.

## 13. 사이트 빌드에 쓸 변수 이름(GitHub Variables)

로그인 화면을 붙일 때(세션 A) 저장소 Settings → Secrets and variables → Actions → **Variables** 탭에 등록할 이름이다. 둘 다 공개 값이라 Secrets 가 아니라 Variables 에 둔다. 워크플로 연결은 화면 작업 때 한다.

| 이름 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<프로젝트 ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |

secret 키는 GitHub 어디에도(Secrets 포함) 넣지 않는다. 사이트는 secret 키가 필요 없다.

## 14. 설계 메모

### 누가 무엇을 할 수 있나

| 표 | 로그인 안 함(anon) | 로그인 사용자(authenticated) | 관리 스크립트(service_role) |
|---|---|---|---|
| `profiles`(아이디·표시 이름·관리자 표시) | 없음 | 본인 행 읽기 | 전체(RLS 우회) |
| `account_security`(변경 필요·바꾼 시각) | 없음 | 본인 행 읽기 | 전체 |
| `user_state`(채널별 북마크·폴더·태그·메모·읽음) | 없음 | 본인 행 읽기·쓰기 — **아이디 계정이고 비밀번호를 바꾼 뒤에만** | 전체 |

사용자에게 `profiles`·`account_security` 의 쓰기 권한(GRANT)이 아예 없어서, 정책을 실수로 더해도 사용자가 표시 이름·관리자 표시·'변경 필요'를 바꿀 수 없다.

### 첫 로그인 비밀번호 변경 강제

- 계정을 만들면 `must_change_password = true`. 사용자는 이 값을 고칠 권한이 없다.
- false 가 되는 길은 하나: Auth 서버에서 비밀번호 해시가 실제로 바뀔 때 DB 트리거가 바꾼다. 비밀번호를 바꾸려면 현재 비밀번호가 필요하다(대시보드 'Require current password').
- true 인 동안은 서버가 `user_state` 읽기·쓰기를 막는다(화면 게이트를 우회해도 기록에 닿지 못함).
- 관리자 초기화도 같은 트리거를 지나므로, 스크립트가 '초기화 진행' 표시를 먼저 켜 트리거가 '변경 필요'를 유지하게 하고, 끝에 한 번 더 켠 뒤 다시 읽어 확인한다.
- 한계
  - 비밀번호 강도 규칙(영문·숫자 섞기, 아이디 미포함)은 화면에서만 검사한다. 서버는 최소 8자와 '이전과 같은 비밀번호 거절'만 한다.
  - 화면 게이트(로그인 화면 먼저)는 브라우저 검사라 우회할 수 있다. 기사는 원래 공개 데이터라 받아들인다.
  - 관리자 초기화 뒤에도 이미 로그인한 기기의 세션은 최대 1시간 남는다(그동안 동기화만 막힘).
  - Auth 서버가 사용자 동작 없이 비밀번호 해시를 다시 쓰는 경우가 있으면 그때 '변경 필요'가 꺼질 수 있다. 기본 설정에서는 없다고 보며 `verify` 9번이 확인한다.

### 서버 상한과 한계

서버 상한은 악용 방지용으로 넉넉하게 두고, 실제 사용 한도는 화면에서만 검사한다(auth-plan.md 3.3). 두 기기 기록을 합친 결과가 화면 한도를 넘어도 동기화가 거절되지 않게 하기 위해서다.

| 항목 | 화면 한도(새로 만들 때만 막음) | 서버 상한(넘으면 저장 거절) |
|---|---|---|
| 채널당 북마크(지운 표시 제외) | 1,000 | 3,000 |
| 폴더 | 20 | 100 |
| 태그 | 50 | 200 |
| 메모 | 200자 | 1,000자 |
| 북마크당 태그 | 10 | 50 |
| 사용자당 채널 행 | — | 10 |
| 행 크기(압축 전) | — | 4MB |

- 이전 값보다 늘지 않는 변경은 상한을 넘어도 통과한다(상한 위의 행에서 줄이는 변경이 막히지 않게).
- 메모와 북마크당 태그는 합칠 때 이어 붙지 않고 북마크 단위로 한쪽을 고르므로 화면 한도를 넘지 않는다. 서버 값은 API 를 직접 불러 한 항목을 키우는 것만 막는다.
- 행 크기(실제 기사로 잰 압축 전 크기): 화면 한도까지 채운 1기기(북마크 1,000·메모 모두 200자·읽음 5,000) 약 1.7MB, 두 기기를 합친 결과(북마크 2,000) 약 3.1MB. 북마크 3,000 에 메모까지 모두 200자로 채우면 약 4.6MB 라 북마크 수보다 행 크기 상한이 먼저 걸린다(메모 평균 100자면 약 3.7MB 로 들어감).
- 상한에 걸리면 오류 코드 23514. 정상 사용으로는 닿지 않는 값이라 동기화 쪽은 '동기화 실패'로만 다루면 된다.

### 새 방식 비밀 키로 Auth 관리 API 를 부르는 방법(근거)

- 공식 문서 [API keys](https://supabase.com/docs/guides/api/api-keys) 'Known limitations': "Send publishable and secret keys on the `apikey` header, not on `Authorization: Bearer`." / "Because the keys aren't JWTs, anything that tries to verify one as a JWT fails."
- 같은 문서: "Secret keys authorize access to your project's data through the built-in `service_role` Postgres role." / "Policies never apply to a secret key, because `service_role` has the `BYPASSRLS` attribute." / 브라우저 차단: "A secret key doesn't work in a browser. Supabase matches on the `User-Agent` header and returns HTTP 401 Unauthorized."
- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api): "A missing grant returns a permission error, including for `service_role`." → SQL 에서 service_role 에도 GRANT 를 준다.
- 사용 중지: [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) 예시 `{ ban_duration: '876000h' }`. 해제 값 `'none'` 은 Auth 서버 저장소 설명 기준(공식 레퍼런스 본문에서는 확인하지 못함) — `enable` 뒤 스크립트가 상태를 다시 읽어 확인한다.
- **확인하지 못한 것**: Auth 관리 API(`/auth/v1/admin/users`)가 `apikey` 헤더만으로 동작한다는 명시 문장은 찾지 못했다. 그래서 스크립트는 문서 권장대로 `apikey` 헤더만 쓰고, `check` 가 읽기 전용 요청으로 먼저 시험한다. 막히면 같은 읽기 요청을 `Authorization: Bearer` 를 더해 한 번만 시험해 결과를 알려 준다(바꾸는 요청은 보내지 않음). 사용자 토큰을 쓰는 요청(로그인 뒤 동기화)은 `Authorization: Bearer <사용자 토큰>` + `apikey: <publishable 키>` 다.
- 사용자 비밀번호 변경 요청 본문의 현재 비밀번호 필드 이름(`current_password`)은 auth-plan.md 2.5(supabase-js 기준)를 따랐다 — `verify` 5번이 실제로 확인한다.

### 스크립트가 지키는 것

- 비밀 키는 `~/.heukseok/supabase.env`(또는 `HEUKSEOK_SECRET_ENV`)에서만 읽고, `sb_secret_` 로 시작하지 않으면 거절한다. 키 파일·CSV 가 저장소 안에 있으면 거절한다.
- 키·학번·비밀번호·사용자 토큰은 출력 전에 모두 [가림] 으로 바뀐다. 오류 메시지에도 넣지 않는다. 학번은 메모리에서만 쓰고 파일로 옮기지 않는다.
- 새 의존성 없이 Node 내장 `fetch` 만 쓴다. 사이트 코드(`app/`·`lib/`·`components/`)는 이 스크립트를 import 하지 않는다(`tests/test_no_secrets.py` 가 확인).
- 저장소 비밀 검사(`tests/test_no_secrets.py`, CI): `sb_secret_` 모양 키, service_role JWT, 값이 붙은 `SUPABASE_SECRET_KEY=`, `*.env`·`accounts*.csv`·학번 열 CSV 가 커밋되면 실패한다.
