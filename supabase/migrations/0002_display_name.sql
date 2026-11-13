-- 흑석일보 표시 이름 직접 변경 (0002)
-- 실행: Supabase 대시보드 → SQL Editor → 새 쿼리 탭에 이 파일 전체를 붙여 넣고 Run(0001 을 먼저 적용한 뒤). 여러 번 실행해도 결과가 같다(멱등).
-- 절차: docs/auth-runbook.md 2-1장, 설계: docs/auth-plan.md(표시 이름).
--
-- 무엇이 바뀌나
--   - profiles 에 display_name_changed_at(마지막으로 사용자가 표시 이름을 바꾼 시각) 열을 더한다. 사용자는 이 열을 고칠 수 없다
--     (0001 의 GRANT 그대로: 사용자는 profiles 를 읽기만 한다).
--   - public.set_display_name(new_name text) 함수 하나로만 사용자가 자기 표시 이름을 바꾼다. 함수가 아래를 모두 검사한다.
--       1) 로그인함(auth.uid()), 관리자가 만든 아이디 계정(profiles 행 있음), 비밀번호를 바꾼 계정(private.password_ready() 와 같은 조건)
--       2) 앞뒤 공백을 지운 뒤 1~20자, 줄바꿈·제어 문자 없음(0001 profiles 검사와 같은 길이 규칙)
--       3) 다른 사용자의 표시 이름과 겹치지 않음 — 공백을 모두 빼고 소문자로 맞춰 비교(대소문자·공백만 다른 이름도 겹침).
--          0001 의 unique 제약(완전히 같은 이름)은 그대로 두어 마지막 안전장치로 쓴다.
--       4) 마지막 변경 뒤 10분 안에는 거절(같은 이름으로 다시 저장하는 것은 아무것도 바꾸지 않고 통과)
--   - 오류는 PostgREST 규칙(SQLSTATE 'PTxxx' → HTTP xxx)으로 상태 코드를 정하고, message 에 화면이 구분할 키를 넣는다.
--       PT401 not_signed_in · PT403 no_profile · PT403 password_change_required · PT422 name_empty · PT422 name_too_long
--       PT422 name_invalid_char · PT409 name_taken · PT429 too_soon
--   - 실행 권한: authenticated 만(anon·public 회수). 함수는 호출한 사용자 자신의 행만 바꾼다(user_id = auth.uid()).
-- 바뀌지 않는 것: 0001 의 RLS·GRANT(사용자는 profiles 를 직접 update 할 수 없음), 관리 스크립트의 표시 이름 지정.

begin;

-- 0001 이 먼저 적용됐는지 확인(없으면 여기서 멈추고 전체 취소)
do $$
begin
  if to_regclass('public.profiles') is null or to_regprocedure('private.password_ready()') is null then
    raise exception '0001_init.sql 을 먼저 적용하세요(profiles 표·private.password_ready 함수가 없습니다)';
  end if;
end $$;

alter table public.profiles add column if not exists display_name_changed_at timestamptz;

create or replace function public.set_display_name(new_name text) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := (select auth.uid());
  nm   text := btrim(coalesce(new_name, ''));   -- 'name' 은 PostgreSQL 형 이름이라 피한다
  cur  public.profiles%rowtype;
begin
  if uid is null then
    raise sqlstate 'PT401' using message = 'not_signed_in';
  end if;
  select * into cur from public.profiles p where p.user_id = uid for update;   -- 같은 사용자의 동시 호출은 차례로
  if not found then
    raise sqlstate 'PT403' using message = 'no_profile';
  end if;
  if not private.password_ready() then
    raise sqlstate 'PT403' using message = 'password_change_required';
  end if;
  if char_length(nm) = 0 then
    raise sqlstate 'PT422' using message = 'name_empty';
  end if;
  if char_length(nm) > 20 then
    raise sqlstate 'PT422' using message = 'name_too_long';
  end if;
  if nm ~ '[[:cntrl:]]' then
    raise sqlstate 'PT422' using message = 'name_invalid_char';
  end if;
  if cur.display_name is not distinct from nm then
    return nm;                                   -- 바뀌는 것이 없으면 시각도 남기지 않는다
  end if;
  -- 겹침 검사는 모든 사용자 사이에서 차례로(두 사람이 동시에 비슷한 이름을 정해도 하나만 통과)
  perform pg_advisory_xact_lock(hashtext('heukseok.set_display_name'));
  if exists (select 1 from public.profiles p
              where p.user_id <> uid and p.display_name is not null
                and lower(regexp_replace(p.display_name, '[[:space:]]', '', 'g')) = lower(regexp_replace(nm, '[[:space:]]', '', 'g'))) then
    raise sqlstate 'PT409' using message = 'name_taken';
  end if;
  if cur.display_name_changed_at is not null and cur.display_name_changed_at > now() - interval '10 minutes' then
    raise sqlstate 'PT429' using message = 'too_soon';
  end if;
  update public.profiles set display_name = nm, display_name_changed_at = now() where user_id = uid;
  return nm;
exception
  when unique_violation then                       -- 0001 의 unique 제약(완전히 같은 이름)에 걸린 경우
    raise sqlstate 'PT409' using message = 'name_taken';
end $$;

-- 함수는 기본으로 PUBLIC 실행 권한이 붙고, Supabase 는 public 스키마 새 함수에 anon·authenticated 권한을 줄 수 있다 → 모두 회수 후 authenticated 만
revoke all on function public.set_display_name(text) from public, anon, authenticated;
grant execute on function public.set_display_name(text) to authenticated;

commit;

-- ───────────────────────── 확인 쿼리(따로 실행) ─────────────────────────
-- 1) 실행 권한: authenticated(와 소유자·service_role 등 관리 역할)만, anon·public 은 없어야 한다
-- select grantee, privilege_type from information_schema.routine_privileges
--  where routine_schema = 'public' and routine_name = 'set_display_name' order by 1;
-- 2) 열: profiles.display_name_changed_at 이 있어야 한다
-- select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by ordinal_position;
-- 3) 사용자가 profiles 를 직접 고칠 권한이 여전히 없음(authenticated 는 SELECT 만)
-- select grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon','authenticated') group by 1;

-- ───────────────────────── 되돌리기(필요할 때만, 따로 실행) ─────────────────────────
-- 표시 이름 직접 변경을 끈다. 이미 바꾼 표시 이름은 그대로 남는다(관리 스크립트로 다시 정할 수 있다).
-- drop function if exists public.set_display_name(text);
-- alter table public.profiles drop column if exists display_name_changed_at;
