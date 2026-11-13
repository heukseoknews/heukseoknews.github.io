-- 흑석일보 채팅: 글 삭제는 관리자만 (0005)
-- 실행: Supabase 대시보드 → SQL Editor → 새 쿼리 탭에 이 파일 전체를 붙여 넣고 Run(0003·0004 를 먼저 적용한 뒤). 여러 번 실행해도 결과가 같다(멱등).
-- 절차: docs/auth-runbook.md 2-4장. 화면: components/ChatRoom.tsx(관리자에게만 [삭제]), lib/chat.ts canDelete.
--
-- 무엇이 바뀌나
--   - public.chat_delete(p_id) 를 바꿔 profiles.is_admin = true 인 사용자만 지울 수 있게 한다. 글쓴이 본인이라도 관리자가 아니면 PT403 not_allowed.
--     (0003·0004 까지는 '글쓴이 본인 또는 관리자')
--   - 관리자 판정을 글을 찾기 전에 한다 → 관리자가 아니면 없는 id 에도 PT403(글이 있는지 알려 주지 않는다). 관리자에게 없는 id 는 PT404 not_found.
-- 그대로인 것: 지우는 방식(행은 남기고 body·article 을 null 로 비우고 deleted_at·deleted_by 를 채움), 이미 지운 글은 오류 없이 그대로 돌려줌,
--   오류 코드(PT401 not_signed_in · PT403 not_allowed · PT404 not_found), security definer, search_path = '', 실행 권한(authenticated 만),
--   로그인·아이디 계정·비밀번호 변경 완료 조건, 다른 채팅 함수·표·Realtime(삭제는 UPDATE 이벤트로 다른 화면에 전해진다).

begin;

-- 0003 이 먼저 적용됐는지 확인(없으면 여기서 멈추고 전체 취소)
do $$
begin
  if to_regclass('public.chat_messages') is null or to_regprocedure('public.chat_delete(bigint)') is null then
    raise exception '0003_chat.sql 을 먼저 적용하세요(chat_messages 표·chat_delete 함수가 없습니다)';
  end if;
end $$;

create or replace function public.chat_delete(p_id bigint) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  adm boolean;
  m   public.chat_messages%rowtype;
begin
  if uid is null then
    raise sqlstate 'PT401' using message = 'not_signed_in';
  end if;
  select p.is_admin into adm from public.profiles p where p.user_id = uid;
  if not found or not private.password_ready() then
    raise sqlstate 'PT403' using message = 'not_allowed';
  end if;
  if not coalesce(adm, false) then
    raise sqlstate 'PT403' using message = 'not_allowed';   -- 글 삭제는 관리자만(본인 글도 안 된다)
  end if;
  select * into m from public.chat_messages c where c.id = p_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;
  if m.deleted_at is null then
    update public.chat_messages c
       set body = null, article = null, deleted_at = now(), deleted_by = uid
     where c.id = p_id
    returning * into m;
  end if;
  return jsonb_build_object('id', m.id, 'deleted_at', m.deleted_at);
end $$;

-- 실행 권한: public·anon 회수, authenticated 만(create or replace 는 권한을 유지하지만 같은 줄을 다시 둔다)
revoke all on function public.chat_delete(bigint) from public, anon, authenticated;
grant execute on function public.chat_delete(bigint) to authenticated;

commit;

-- ───────────────────────── 확인 쿼리(따로 실행) ─────────────────────────
-- 1) 실행 권한: authenticated(와 postgres 등)만, anon·PUBLIC 없음
-- select grantee from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'chat_delete' order by 1;
-- 2) 관리자 계정 확인(관리자만 지울 수 있다): is_admin 이 true 인 행
-- select display_name from public.profiles where is_admin;

-- ───────────────────────── 되돌리기(필요할 때만, 따로 실행) ─────────────────────────
-- 0004 시점(글쓴이 본인 또는 관리자)으로 돌린다. 아래를 새 query 에 붙여 실행한다(0003_chat.sql 의 chat_delete 와 같은 본문).
-- create or replace function public.chat_delete(p_id bigint) returns jsonb
--   language plpgsql security definer set search_path = '' as $$
-- declare
--   uid uuid := (select auth.uid());
--   adm boolean;
--   m   public.chat_messages%rowtype;
-- begin
--   if uid is null then
--     raise sqlstate 'PT401' using message = 'not_signed_in';
--   end if;
--   select p.is_admin into adm from public.profiles p where p.user_id = uid;
--   if not found or not private.password_ready() then
--     raise sqlstate 'PT403' using message = 'not_allowed';
--   end if;
--   select * into m from public.chat_messages c where c.id = p_id for update;
--   if not found then
--     raise sqlstate 'PT404' using message = 'not_found';
--   end if;
--   if m.user_id <> uid and not coalesce(adm, false) then
--     raise sqlstate 'PT403' using message = 'not_allowed';
--   end if;
--   if m.deleted_at is null then
--     update public.chat_messages c
--        set body = null, article = null, deleted_at = now(), deleted_by = uid
--      where c.id = p_id
--     returning * into m;
--   end if;
--   return jsonb_build_object('id', m.id, 'deleted_at', m.deleted_at);
-- end $$;
-- revoke all on function public.chat_delete(bigint) from public, anon, authenticated;
-- grant execute on function public.chat_delete(bigint) to authenticated;
-- 그 뒤 화면도 예전처럼 본인 글에 [삭제]가 보이게 하려면 lib/chat.ts canDelete 를 되돌린다(이 파일만 되돌리면 화면은 관리자에게만 [삭제]를 보인다).
