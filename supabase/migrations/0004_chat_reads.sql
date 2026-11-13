-- 흑석일보 채팅: 기사만 있는 글 + 읽음 수 (0004)
-- 실행: Supabase 대시보드 → SQL Editor → 새 쿼리 탭에 이 파일 전체를 붙여 넣고 Run(0003 을 먼저 적용한 뒤). 여러 번 실행해도 결과가 같다(멱등).
-- 절차: docs/auth-runbook.md 2-3장. 화면: components/ChatRoom.tsx, lib/chat.ts, lib/chatBackend.ts.
--
-- 무엇이 바뀌나
--   1) 기사만 있는 글: chat_send 를 바꿔 첨부 기사가 있으면 본문이 비어 있어도 받는다(본문 0~500자). 기사가 없으면 지금처럼 1~500자.
--      저장 구분(화면 lib/chat.ts toMessage·isDeleted 와 같은 규칙):
--        보통 글        body = 본문(1~500자),  article = null 또는 기사, deleted_at = null
--        기사만 있는 글 body = ''(빈 문자열),  article = 기사,          deleted_at = null
--        삭제된 글      body = null,           article = null,          deleted_at = 지운 시각   (chat_delete 그대로)
--      → '삭제'는 언제나 body is null(그리고 deleted_at 있음), '기사만'은 body = '' 이라 둘이 섞이지 않는다.
--      표의 검사(chat_messages_state)도 같은 규칙으로 바꾼다(기존 행은 모두 이 규칙에 맞는다).
--      기사 검사(허용 키·길이·http/https 주소, private.chat_article_ok)와 분당 상한·제어 문자 검사는 그대로다.
--      chat_send 는 보낸 사람의 읽은 위치도 그 글까지 올린다(아래 2).
--   2) 읽음 수: 표 public.chat_reads — 사용자마다 '어디까지 읽었는지(last_read_id)' 한 줄.
--      글의 읽음 수 = 글쓴이를 뺀 사용자 중 last_read_id 가 그 글 id 이상인 사람 수. 누가 읽었는지는 어떤 응답에도 나오지 않는다(숫자만).
--        chat_mark_read(p_last_id)  본인 행만 upsert. 줄어들지 않고(greatest), 방의 최대 id 를 넘으면 최대 id 로 맞춘다. 돌려주는 값 = 저장된 last_read_id
--        chat_read_counts(p_ids)    앞의 200개 id 에 대해 (id, read_count). 삭제된 글은 빠진다
--      chat_reads 는 직접 읽기·쓰기가 모두 막혀 있다(authenticated 에 GRANT·정책 없음). 함수로만 접근한다.
--      Realtime 발행에는 넣지 않는다(누가 언제 읽었는지 이벤트로 새지 않게).
--   - 권한 조건은 다른 채팅 함수와 같다: 로그인(PT401 not_signed_in), 아이디 계정 + 비밀번호 변경 완료(PT403 not_allowed).
-- 바뀌지 않는 것: chat_messages 의 읽기 정책·권한, chat_delete·chat_list, Realtime 발행(chat_messages 만).

begin;

-- 0003 이 먼저 적용됐는지 확인(없으면 여기서 멈추고 전체 취소)
do $$
begin
  if to_regclass('public.chat_messages') is null or to_regprocedure('private.chat_article_ok(jsonb)') is null then
    raise exception '0003_chat.sql 을 먼저 적용하세요(chat_messages 표·private.chat_article_ok 함수가 없습니다)';
  end if;
end $$;

-- ───────────────────────── 1) 기사만 있는 글 ─────────────────────────
alter table public.chat_messages drop constraint if exists chat_messages_state;
alter table public.chat_messages add constraint chat_messages_state check (
  (deleted_at is null and body is not null and char_length(body) <= 500 and (char_length(body) >= 1 or article is not null))
  or (deleted_at is not null and body is null and article is null));

-- ───────────────────────── 2) 읽은 위치 ─────────────────────────
create table if not exists public.chat_reads (
  user_id      uuid        primary key references auth.users(id) on delete cascade,   -- 계정을 지우면 함께 지워진다
  last_read_id bigint      not null default 0 check (last_read_id >= 0),
  updated_at   timestamptz not null default now()
);
alter table public.chat_reads enable row level security;
revoke all on table public.chat_reads from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_reads to service_role;   -- 관리 스크립트(verify)용. 정책은 만들지 않는다

-- 글 보내기(0003 의 chat_send 를 바꿈): 기사가 있으면 본문 0~500자, 없으면 1~500자. 보낸 사람의 읽은 위치를 그 글까지 올린다
create or replace function public.chat_send(p_body text, p_article jsonb default null) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid  := (select auth.uid());
  b   text  := regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');   -- 앞뒤 공백·줄바꿈 제거
  a   jsonb := case when p_article is null or jsonb_typeof(p_article) = 'null' then null else p_article end;
  nm  text;
  n   int;
  r   public.chat_messages%rowtype;
begin
  if uid is null then
    raise sqlstate 'PT401' using message = 'not_signed_in';
  end if;
  select p.display_name into nm from public.profiles p where p.user_id = uid;
  if not found or not private.password_ready() then
    raise sqlstate 'PT403' using message = 'not_allowed';
  end if;
  if char_length(b) > 500 or (a is null and char_length(b) < 1) then
    raise sqlstate 'PT422' using message = 'body_length';
  end if;
  -- 줄바꿈(\n)만 허용. 그 밖의 C0·DEL·C1 제어 문자와 글자 방향을 바꾸는 문자(U+202A–202E, U+2066–2069)는 거절
  if b ~ '[\x01-\x09\x0b-\x1f\x7f\u0080-\u009f‪-‮⁦-⁩]' then
    raise sqlstate 'PT422' using message = 'body_format';
  end if;
  if a is not null and not private.chat_article_ok(a) then
    raise sqlstate 'PT422' using message = 'article_format';
  end if;
  perform pg_advisory_xact_lock(hashtext('heukseok.chat_send:' || uid::text));
  select count(*) into n from public.chat_messages m where m.user_id = uid and m.created_at > now() - interval '1 minute';
  if n >= 60 then
    raise sqlstate 'PT429' using message = 'rate_limited';
  end if;
  insert into public.chat_messages (user_id, author_name, body, article)
  values (uid, coalesce(nullif(btrim(nm), ''), '이름 없음'), b, a)
  returning * into r;
  insert into public.chat_reads as cr (user_id, last_read_id, updated_at) values (uid, r.id, now())
  on conflict (user_id) do update set last_read_id = greatest(cr.last_read_id, excluded.last_read_id), updated_at = now();
  return jsonb_build_object('id', r.id, 'created_at', r.created_at, 'author_name', r.author_name);
end $$;

-- 읽은 위치 올리기(본인 행만). 돌려주는 값 = 저장된 last_read_id
create or replace function public.chat_mark_read(p_last_id bigint) returns bigint
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  mx  bigint;
  v   bigint;
  res bigint;
begin
  if uid is null then
    raise sqlstate 'PT401' using message = 'not_signed_in';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = uid) or not private.password_ready() then
    raise sqlstate 'PT403' using message = 'not_allowed';
  end if;
  select coalesce(max(m.id), 0) into mx from public.chat_messages m;
  v := least(greatest(coalesce(p_last_id, 0), 0), mx);   -- 방의 최대 id 를 넘으면 최대 id 로
  insert into public.chat_reads as cr (user_id, last_read_id, updated_at) values (uid, v, now())
  on conflict (user_id) do update set last_read_id = greatest(cr.last_read_id, excluded.last_read_id), updated_at = now()   -- 줄어들지 않는다
  returning cr.last_read_id into res;
  return res;
end $$;

-- 읽음 수: 앞의 200개 id 만, 삭제된 글은 빠진다. 글쓴이 본인은 세지 않는다. 숫자만 돌려준다
create or replace function public.chat_read_counts(p_ids bigint[])
  returns table (id bigint, read_count int)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise sqlstate 'PT401' using message = 'not_signed_in';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = uid) or not private.password_ready() then
    raise sqlstate 'PT403' using message = 'not_allowed';
  end if;
  return query
    select m.id,
           (select count(*) from public.chat_reads r where r.user_id <> m.user_id and r.last_read_id >= m.id)::int
      from public.chat_messages m
     where m.id = any (coalesce(p_ids[1:200], '{}'::bigint[]))
       and m.deleted_at is null
     order by m.id;
end $$;

-- 실행 권한: public·anon 회수, authenticated 만(chat_send 는 create or replace 로 권한이 유지되지만 같은 줄을 다시 둔다)
revoke all on function public.chat_send(text, jsonb)          from public, anon, authenticated;
revoke all on function public.chat_mark_read(bigint)          from public, anon, authenticated;
revoke all on function public.chat_read_counts(bigint[])      from public, anon, authenticated;
grant execute on function public.chat_send(text, jsonb)       to authenticated;
grant execute on function public.chat_mark_read(bigint)       to authenticated;
grant execute on function public.chat_read_counts(bigint[])   to authenticated;

-- chat_reads 는 Realtime 발행에 넣지 않는다. 혹시 들어 있으면 뺀다
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reads') then
    alter publication supabase_realtime drop table public.chat_reads;
  end if;
end $$;

commit;

-- ───────────────────────── 확인 쿼리(따로 실행) ─────────────────────────
-- 1) chat_reads 표 권한: anon·authenticated 줄이 없어야 한다(service_role 만)
-- select grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'chat_reads' group by 1;
-- 2) 정책: chat_reads 에 하나도 없어야 한다
-- select policyname from pg_policies where schemaname = 'public' and tablename = 'chat_reads';
-- 3) 함수 실행 권한: authenticated(와 소유자 등)만
-- select routine_name, grantee from information_schema.routine_privileges
--  where routine_schema = 'public' and routine_name in ('chat_send','chat_mark_read','chat_read_counts') order by 1, 2;
-- 4) Realtime 발행: chat_messages 한 줄만(chat_reads 없음)
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'chat_%';

-- ───────────────────────── 되돌리기(필요할 때만, 따로 실행) ─────────────────────────
-- 읽음 기록이 지워지고 화면의 '읽음 N'이 사라진다(채팅은 그대로). 기사만 있는 글이 이미 있으면 먼저 지워야 0003 의 검사로 돌아갈 수 있다.
-- drop function if exists public.chat_mark_read(bigint), public.chat_read_counts(bigint[]);
-- drop table if exists public.chat_reads;
-- delete from public.chat_messages where body = '';
-- alter table public.chat_messages drop constraint if exists chat_messages_state;
-- alter table public.chat_messages add constraint chat_messages_state check (
--   (deleted_at is null and body is not null and char_length(body) between 1 and 500)
--   or (deleted_at is not null and body is null and article is null));
-- 그다음 0003_chat.sql 을 다시 실행하면 chat_send 가 0003 의 내용으로 돌아간다.
