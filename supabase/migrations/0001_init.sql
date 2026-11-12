-- 흑석일보 로그인·동기화 초기 스키마 (0001)
-- 실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run. 여러 번 실행해도 결과가 같다(멱등).
-- 설계: docs/auth-plan.md(3·4장), 실행 절차: docs/auth-runbook.md
-- 전제(대시보드 설정 완료): Data API 'Automatically expose new tables' 꺼짐 → 표 권한(GRANT)을 아래에 모두 명시한다.
--
-- 누가 무엇을 할 수 있나(이 파일 끝의 '확인 쿼리'로 실제와 맞춰 본다)
--   표                 anon   authenticated(로그인 사용자)                         service_role(관리 스크립트, RLS 우회)
--   profiles           없음   select: 본인 행만                                      select·insert·update·delete
--   account_security   없음   select: 본인 행만                                      select·insert·update·delete
--   user_state         없음   select·insert·update·delete: 본인 행만,               select·insert·update·delete
--                             비밀번호를 바꾼 계정만(must_change_password = false)
--
-- 첫 로그인 비밀번호 변경 강제(서버 쪽)
--   - account_security.must_change_password 는 계정을 만들 때 true. 사용자에게는 이 표의 쓰기 권한이 GRANT 단계에서 없다.
--   - false 로 바뀌는 길은 하나뿐: auth.users 의 비밀번호 해시가 실제로 바뀔 때 트리거(private.on_password_change)가 바꾼다.
--     사용자가 비밀번호를 바꾸려면 Auth 서버에 현재 비밀번호를 내야 한다(대시보드 'Require current password' 켬).
--   - 관리자가 비밀번호를 초기화할 때도 같은 트리거가 지나간다. 그래서 관리 스크립트는
--       ① reset_pending = true → ② 비밀번호 변경(트리거가 reset_pending 을 보고 must_change 를 true 로 유지) → ③ must_change = true 를 한 번 더 쓰고 다시 읽어 확인
--     순서로 한다. ②가 실패해 reset_pending 이 남아도 다음 비밀번호 변경이 '관리자 초기화'로 처리될 뿐이라(변경 필요 유지) 안전한 쪽으로 실패한다.
--   - 한계: (0) Auth 서버가 사용자 동작 없이 해시를 다시 쓰는 경우(해시 비용·암호화 키 변경 등)가 있으면 그때 '변경 필요'가 꺼질 수 있다.
--               기본 설정에서는 일어나지 않는 것으로 보며, scripts/admin/verify.mjs 가 '초기화 뒤 로그인해도 true 유지'를 확인한다.
--           (1) 비밀번호 규칙(영문·숫자 섞기, 아이디 미포함)은 화면에서만 검사한다. 서버는 최소 8자와 '이전과 같은 비밀번호 거절'만 한다.
--           (2) 관리자 초기화 직후 새 비밀번호를 알려 주기 전까지는 사용자가 기존 세션(access token, 최대 1시간)을 계속 쓸 수 있다.
--               단 must_change 가 true 이므로 그동안 user_state 접근은 막힌다.
--           (3) 화면 게이트(로그인 화면·변경 화면 강제)는 브라우저 검사라 우회할 수 있다. 기사 데이터는 원래 공개라 받아들이고,
--               사용자 기록(user_state)은 이 파일의 정책이 서버에서 막는다.
--
-- 확장(댓글·채팅, docs/auth-plan.md 11장): 새 표도 같은 방식(revoke all → 필요한 grant → 작업별 정책 → private.password_ready())으로 더한다.
-- profiles 를 다른 사용자에게 보이게 할 때는 profiles 의 select 정책만 넓히고 account_security 는 계속 본인만 둔다.
-- profiles.is_admin 은 지금 정책에 쓰지 않는다(관리는 service_role 스크립트). 댓글 관리 등에 쓸 자리다.

begin;

-- ───────────────────────── 스키마 ─────────────────────────
-- 트리거·정책용 함수는 Data API 에 노출되지 않는 private 스키마에 둔다
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;   -- 정책 안에서 private.password_ready() 를 부르기 위해서만(표는 두지 않음)
grant usage on schema private to supabase_auth_admin;  -- auth.users 트리거를 실행하는 Auth 서버 역할(함수는 security definer 라 표 권한은 필요 없음)

-- ───────────────────────── 표 ─────────────────────────
create table if not exists public.profiles (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  login_id     text        not null unique
               check (login_id ~ '^[a-z][a-z0-9_.-]{2,19}$'),
  display_name text        unique                                   -- null = 아직 정하지 않음(관리 스크립트가 만들 때 채운다)
               check (display_name is null or (char_length(display_name) between 1 and 20 and display_name = btrim(display_name))),
  is_admin     boolean     not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.account_security (
  user_id              uuid        primary key references auth.users(id) on delete cascade,
  must_change_password boolean     not null default true,
  password_changed_at  timestamptz,
  reset_pending        boolean     not null default false            -- 관리자 초기화 진행 중 표시(위 설명 ①~③)
);

create table if not exists public.user_state (
  user_id        uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  channel        text        not null check (channel ~ '^[a-z0-9-]{1,32}$'),
  schema_version int         not null default 2 check (schema_version between 1 and 100),  -- 브라우저 저장 형식 번호(docs/migration-localstorage.md)
  bookmarks      jsonb       not null default '{}'::jsonb check (jsonb_typeof(bookmarks) = 'object'),  -- { 기사 id: 북마크 | 삭제 표시 }
  folders        jsonb       not null default '{}'::jsonb check (jsonb_typeof(folders) = 'object'),    -- { 폴더 id: { id, name, createdAt, updatedAt, deletedAt? } }
  tags           jsonb       not null default '{}'::jsonb check (jsonb_typeof(tags) = 'object'),       -- { 태그 id: 같은 모양 }
  read_at        jsonb       not null default '{}'::jsonb check (jsonb_typeof(read_at) = 'object'),    -- { 기사 id: ISO 시각 }
  last_confirmed timestamptz,
  companies      jsonb       not null default '[]'::jsonb check (jsonb_typeof(companies) = 'array'),  -- [정식명]
  rev            bigint      not null default 1,                                                       -- 낙관적 동시성(docs/auth-plan.md 3.4)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, channel),
  -- 오류·악용으로 행이 커지는 것을 막는 안전장치. check 는 TOAST 압축 전 jsonb 크기로 평가된다(JSON 텍스트와 비슷하거나 조금 큼).
  -- docs/auth-plan.md 3.2 의 '많음'(JSON 약 1.6MB)이 여유 있게 들어가도록 4MB 로 둔다.
  constraint user_state_size check (pg_column_size(bookmarks) + pg_column_size(folders) + pg_column_size(tags)
                                    + pg_column_size(read_at) + pg_column_size(companies) < 4000000)
);

-- 이 파일보다 먼저 다른 모양으로 만든 표가 있어도 필요한 열을 채운다(create table if not exists 는 기존 표를 바꾸지 않으므로)
alter table public.profiles         add column if not exists login_id text;
alter table public.profiles         add column if not exists display_name text;
alter table public.profiles         add column if not exists is_admin boolean not null default false;
alter table public.profiles         add column if not exists created_at timestamptz not null default now();
alter table public.account_security add column if not exists must_change_password boolean not null default true;
alter table public.account_security add column if not exists password_changed_at timestamptz;
alter table public.account_security add column if not exists reset_pending boolean not null default false;
alter table public.user_state       add column if not exists created_at timestamptz not null default now();

-- 트리거가 쓰는 열이 모두 있는지 확인(없으면 여기서 멈추고 전체 취소 — 트리거가 실행 중에 실패해 계정 생성·비밀번호 변경이 막히는 것을 예방)
do $$
declare missing text;
begin
  select string_agg(t || '.' || c, ', ') into missing
    from (values ('profiles','user_id'), ('profiles','login_id'), ('profiles','display_name'), ('profiles','is_admin'),
                 ('account_security','user_id'), ('account_security','must_change_password'), ('account_security','password_changed_at'),
                 ('account_security','reset_pending'), ('user_state','user_id'), ('user_state','channel'), ('user_state','bookmarks'),
                 ('user_state','folders'), ('user_state','tags'), ('user_state','updated_at')) as need(t, c)
   where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public' and ic.table_name = need.t and ic.column_name = need.c);
  if missing is not null then
    raise exception '필요한 열이 없습니다: % — 표를 지우고 다시 실행하거나 열을 추가하세요(docs/auth-runbook.md 문제 해결)', missing;
  end if;
end $$;

-- ───────────────────────── 함수·트리거 ─────────────────────────
-- 수정 시각은 서버 시계로
create or replace function private.touch_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch before update on public.user_state
  for each row execute function private.touch_updated_at();

-- 사용자별 상한(docs/auth-plan.md 3.3·migration-localstorage.md 1장): 채널당 북마크 1,000, 폴더 20, 태그 50(살아 있는 것),
-- 메모 200자, 북마크당 태그 10, 사용자당 채널 행 10개. 삭제 표시는 deletedAt 이 문자열인 항목만 인정하고(클라이언트 cleanEntry 와 같은 기준),
-- 객체가 아닌 북마크 값도 살아 있는 것으로 센다(상한 우회 방지).
-- 예외: 이전 값보다 늘지 않는 변경은 한도를 넘어도 통과한다 — 관리자가 한도 위로 넣어 둔 행에서 줄이는 쪽 변경·다른 항목 변경이 막히지 않게.
-- 주의(한계): 두 기기에서 따로 만든 것을 합쳐 서버 행보다 늘면서 한도를 넘는 변경은 거절된다. 클라이언트는 이 오류(23514)를 받으면
-- 사용자에게 줄이라고 안내해야 한다(docs/auth-runbook.md '설계 메모').
create or replace function private.check_user_state_limits() returns trigger
  language plpgsql set search_path = '' as $$
declare
  n_book int; n_fold int; n_tag int; o_book int := 0; o_fold int := 0; o_tag int := 0; n_rows int;
  bad_memo text; bad_tags text;
begin
  select count(*) into n_book from jsonb_each(new.bookmarks) e where jsonb_typeof(e.value -> 'deletedAt') is distinct from 'string';
  select count(*) into n_fold from jsonb_each(new.folders)   e where jsonb_typeof(e.value -> 'deletedAt') is distinct from 'string';
  select count(*) into n_tag  from jsonb_each(new.tags)      e where jsonb_typeof(e.value -> 'deletedAt') is distinct from 'string';
  if tg_op = 'UPDATE' then
    select count(*) into o_book from jsonb_each(old.bookmarks) e where jsonb_typeof(e.value -> 'deletedAt') is distinct from 'string';
    select count(*) into o_fold from jsonb_each(old.folders)   e where jsonb_typeof(e.value -> 'deletedAt') is distinct from 'string';
    select count(*) into o_tag  from jsonb_each(old.tags)      e where jsonb_typeof(e.value -> 'deletedAt') is distinct from 'string';
  else
    select count(*) into n_rows from public.user_state u where u.user_id = new.user_id;
    if n_rows >= 10 then
      raise exception 'user_state limit: channels >10' using errcode = 'check_violation';
    end if;
  end if;
  if n_book > 1000 and n_book > o_book then
    raise exception 'user_state limit: bookmarks %>1000', n_book using errcode = 'check_violation';
  end if;
  if n_fold > 20 and n_fold > o_fold then
    raise exception 'user_state limit: folders %>20', n_fold using errcode = 'check_violation';
  end if;
  if n_tag > 50 and n_tag > o_tag then
    raise exception 'user_state limit: tags %>50', n_tag using errcode = 'check_violation';
  end if;
  select e.key into bad_memo from jsonb_each(new.bookmarks) e
   where jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value -> 'memo') = 'string'
     and char_length(e.value ->> 'memo') > 200
   limit 1;
  if bad_memo is not null then
    raise exception 'user_state limit: memo >200 chars' using errcode = 'check_violation';
  end if;
  select e.key into bad_tags from jsonb_each(new.bookmarks) e
   where jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value -> 'tags') = 'array'
     and jsonb_array_length(e.value -> 'tags') > 10
   limit 1;
  if bad_tags is not null then
    raise exception 'user_state limit: tags per bookmark >10' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists user_state_limits on public.user_state;
create trigger user_state_limits before insert or update on public.user_state
  for each row execute function private.check_user_state_limits();

-- 계정이 만들어지면 프로필·'변경 필요' 상태를 만든다.
-- login_id 는 내부 이메일 '<아이디>@users.heukseok.invalid' 에서, 표시 이름은 관리 스크립트가 app_metadata.display_name 으로 넘긴 값.
-- app_metadata 는 사용자가 고칠 수 없는 영역이다(user_metadata 는 쓰지 않는다).
-- 다른 형식의 이메일로 만든 계정(대시보드 실수 등)은 프로필을 만들지 않는다 — 여기서 실패하면 계정 생성 자체가 실패하므로 최소한으로 둔다.
create or replace function private.on_auth_user_created() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  lid text := lower(split_part(coalesce(new.email, ''), '@', 1));
  dn  text := nullif(btrim(coalesce(new.raw_app_meta_data ->> 'display_name', '')), '');
begin
  insert into public.account_security (user_id) values (new.id) on conflict (user_id) do nothing;
  if lower(coalesce(new.email, '')) like '%@users.heukseok.invalid' and lid ~ '^[a-z][a-z0-9_.-]{2,19}$' then
    insert into public.profiles (user_id, login_id, display_name)
    values (new.id, lid, case when char_length(dn) between 1 and 20 then dn end)
    on conflict do nothing;   -- 아이디·표시 이름 중복이어도 계정 생성은 막지 않는다(프로필 없음은 관리 스크립트가 알려 줌)
  end if;
  return new;
end $$;

-- auth.users 의 소유자는 Auth 서버 역할이라 drop trigger 가 권한 오류를 낼 수 있다 → 없을 때만 만든다.
-- 트리거는 함수를 OID 로 부르고 create or replace function 은 OID 를 유지하므로, 함수 본문을 고친 재실행도 그대로 반영된다.
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function private.on_auth_user_created();
  end if;
end $$;

-- 비밀번호 해시가 실제로 바뀌면: 관리자 초기화 중(reset_pending)이면 '변경 필요' 유지, 아니면(사용자 본인 변경) '변경 필요'를 끈다.
-- 열 이름 encrypted_password 는 Supabase Auth 서버 기준(실측은 docs/auth-runbook.md 검증 단계).
create or replace function private.on_password_change() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  update public.account_security
     set must_change_password = reset_pending,      -- 관리자 초기화면 true 유지, 본인 변경이면 false
         password_changed_at  = case when reset_pending then password_changed_at else now() end,
         reset_pending        = false
   where user_id = new.id;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_password_changed') then
    create trigger on_auth_password_changed after update of encrypted_password on auth.users
      for each row when (old.encrypted_password is distinct from new.encrypted_password)
      execute function private.on_password_change();
  end if;
end $$;

-- user_state 정책용: 지금 로그인한 사용자가 관리자가 만든 아이디 계정(프로필 있음)이고 비밀번호를 바꿨는가(행이 없으면 false = 막힘).
-- 프로필 조건은 익명 로그인 등 다른 경로로 생긴 authenticated 사용자를 막는 덧방어다(익명 로그인은 대시보드에서 꺼 둠).
create or replace function private.password_ready() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = (select auth.uid()))
     and coalesce((select not s.must_change_password
                     from public.account_security s
                    where s.user_id = (select auth.uid())), false)
$$;

-- 함수는 기본으로 PUBLIC 실행 권한이 붙으므로 모두 회수하고 필요한 것만 준다
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.password_ready() to authenticated;

-- ───────────────────────── RLS·권한 ─────────────────────────
alter table public.profiles         enable row level security;
alter table public.account_security enable row level security;
alter table public.user_state       enable row level security;

grant usage on schema public to authenticated, service_role;

-- 아무 권한도 없는 상태에서 시작해 필요한 것만 준다
revoke all on table public.profiles, public.account_security, public.user_state from public, anon, authenticated;
grant select                         on table public.profiles         to authenticated;
grant select                         on table public.account_security to authenticated;
grant select, insert, update, delete on table public.user_state       to authenticated;
-- service_role 은 RLS 를 우회하지만 표 권한은 따로 필요하다
grant select, insert, update, delete on table public.profiles, public.account_security, public.user_state to service_role;
-- anon: 어떤 표에도 권한 없음(요청하면 42501)

-- profiles: 본인 행 읽기만. 쓰기 정책 없음(+ GRANT 도 없음) → login_id·display_name·is_admin 은 관리 스크립트만 바꾼다
drop policy if exists "profiles: 본인 행 읽기" on public.profiles;
create policy "profiles: 본인 행 읽기" on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

-- account_security: 본인 행 읽기만. 쓰기는 트리거·관리 스크립트만
drop policy if exists "account_security: 본인 행 읽기" on public.account_security;
create policy "account_security: 본인 행 읽기" on public.account_security for select to authenticated
  using ((select auth.uid()) = user_id);

-- user_state: 본인 행만, 그리고 비밀번호를 바꾼 계정만. 작업별 정책(공식 권장), update 의 with check 로 user_id 바꿔치기 차단
drop policy if exists "user_state: 본인 행 읽기"   on public.user_state;
drop policy if exists "user_state: 본인 행 만들기" on public.user_state;
drop policy if exists "user_state: 본인 행 고치기" on public.user_state;
drop policy if exists "user_state: 본인 행 지우기" on public.user_state;
create policy "user_state: 본인 행 읽기"   on public.user_state for select to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "user_state: 본인 행 만들기" on public.user_state for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "user_state: 본인 행 고치기" on public.user_state for update to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()))
  with check ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "user_state: 본인 행 지우기" on public.user_state for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()));

-- 이 파일보다 먼저 만든 계정(트리거가 없던 때)에도 '변경 필요' 행을 만든다(프로필은 관리 스크립트 create 가 채운다)
insert into public.account_security (user_id)
select u.id from auth.users u
 where not exists (select 1 from public.account_security s where s.user_id = u.id);

commit;

-- ───────────────────────── 확인 쿼리(따로 실행) ─────────────────────────
-- 1) 표 권한: 위 머리말 표와 같아야 한다(anon 행이 없어야 함)
-- select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--  where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
--  group by 1, 2 order by 1, 2;
-- 2) RLS 켜짐: 세 표 모두 true
-- select tablename, rowsecurity from pg_tables where schemaname = 'public';
-- 3) 정책 목록: profiles 1, account_security 1, user_state 4
-- select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by 1, 3;
-- 4) 트리거: auth.users 에 on_auth_user_created·on_auth_password_changed, user_state 에 user_state_touch·user_state_limits
-- select event_object_schema, event_object_table, trigger_name from information_schema.triggers
--  where trigger_name in ('on_auth_user_created','on_auth_password_changed','user_state_touch','user_state_limits') order by 1, 2, 3;

-- ───────────────────────── 되돌리기(필요할 때만, 따로 실행) ─────────────────────────
-- 사용자 기록이 모두 지워진다. 계정(auth.users)은 남는다.
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop trigger if exists on_auth_password_changed on auth.users;
-- drop table if exists public.user_state, public.account_security, public.profiles;
-- drop schema if exists private cascade;
