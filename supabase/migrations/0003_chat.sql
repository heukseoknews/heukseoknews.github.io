-- 흑석일보 전체 채팅방 (0003)
-- 실행: Supabase 대시보드 → SQL Editor → 새 쿼리 탭에 이 파일 전체를 붙여 넣고 Run(0001·0002 를 먼저 적용한 뒤). 여러 번 실행해도 결과가 같다(멱등).
-- 절차: docs/auth-runbook.md 2-2장. 화면: app/chat/, components/ChatRoom.tsx, lib/chat.ts(검사 규칙 사본), lib/chatBackend.ts.
--
-- 정정(0001 주석): 0001 의 on_auth_user_created 주석 중 '표시 이름은 관리 스크립트가 app_metadata.display_name 으로 넘긴 값'은 실제와 다르다.
--   Auth 서버가 app_metadata 를 사용자 생성 뒤에 따로 기록해서 트리거 시점에는 비어 있고, 관리 스크립트 create/verify 가 표시 이름을 보정한다
--   (scripts/admin/lib.mjs fixNewProfile).
--
-- 무엇이 생기나
--   - 표 public.chat_messages: 방은 하나(전체). 글쓴이 표시 이름(author_name)은 보낼 때 profiles.display_name 을 복사해 둔다
--     → 다른 사람의 profiles 를 읽을 필요가 없다(profiles 는 계속 본인 행만). login_id 는 이 표에 없다(로그인 정보의 절반이라 채팅에 내놓지 않는다).
--     이름을 나중에 바꿔도 옛 글의 이름은 그대로다.
--   - 읽기: 관리자가 만든 아이디 계정(profiles 행 있음) + 비밀번호를 바꾼 사용자(private.password_ready())만. anon·로그아웃은 아무것도 못 본다.
--     Realtime(postgres_changes)도 구독자 토큰으로 이 select 정책을 적용해 보낸다 → 읽을 수 없는 사용자에게는 새 글 이벤트도 가지 않는다.
--   - 쓰기: 표에 대한 직접 insert·update·delete 는 authenticated 에도 GRANT·정책 모두 없다. 아래 함수로만 쓴다.
--       chat_send(p_body, p_article)   글 보내기(검사·분당 상한·이름 복사는 함수 안에서)
--       chat_delete(p_id)              삭제(본인 글, 관리자 profiles.is_admin 은 모든 글). 행은 남기고 body·article 을 비운다(내용은 DB 에서 사라짐)
--       chat_list(p_before, p_limit)   최근 글부터 id 기준 페이지(security invoker — 위 select 정책으로 읽는다). p_limit 은 1~200 으로 자른다
--   - 오류는 0002 와 같은 방식(SQLSTATE 'PTxxx' → HTTP xxx, message 에 화면이 구분할 키):
--       PT401 not_signed_in · PT403 not_allowed(아이디 계정 아님·비밀번호 변경 전·남의 글 삭제) · PT404 not_found
--       PT422 body_length(앞뒤 공백을 지운 뒤 1~500자 아님) · PT422 body_format(제어 문자) · PT422 article_format(기사 첨부 모양)
--       PT429 rate_limited(사용자당 1분에 60건 — 프로그램 오류로 글이 쏟아질 때 대비. 친구끼리라 평소에는 닿지 않는 값)
--   - 기사 첨부(article): 북마크 스냅샷과 같은 키만 — id, cluster_id, channel(insurance|ai|finance), title(1~200자), source(1~60자),
--     url(http/https, 2048자 이하), published_at. 값은 모두 문자열, 그 밖의 키·4KB 넘는 크기는 거절. 필수: id, channel, title, url.
--   - 보관 기간: 이번에는 자동 삭제하지 않는다. 나중에 pg_cron 으로 N일 지난 글 삭제(delete … where created_at < now() - interval 'N days', created_at 인덱스 사용).
-- 바뀌지 않는 것: 0001·0002 의 표·정책·함수(profiles 는 여전히 본인 행만 읽기).

begin;

-- 0001 이 먼저 적용됐는지 확인(없으면 여기서 멈추고 전체 취소)
do $$
begin
  if to_regclass('public.profiles') is null or to_regprocedure('private.password_ready()') is null then
    raise exception '0001_init.sql 을 먼저 적용하세요(profiles 표·private.password_ready 함수가 없습니다)';
  end if;
end $$;

-- ───────────────────────── 표 ─────────────────────────
create table if not exists public.chat_messages (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,     -- 계정을 지우면 글도 함께 지워진다
  author_name text        not null check (char_length(author_name) between 1 and 40),
  body        text,                                                                -- 삭제되면 null
  article     jsonb,                                                               -- 기사 첨부(없을 수 있음), 삭제되면 null
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid        references auth.users(id) on delete set null,
  -- 살아 있는 글은 본문 1~500자, 지운 글은 본문·첨부 없음(함수 검사의 마지막 안전장치)
  constraint chat_messages_state check (
    (deleted_at is null and body is not null and char_length(body) between 1 and 500)
    or (deleted_at is not null and body is null and article is null)),
  constraint chat_messages_article check (article is null or (jsonb_typeof(article) = 'object' and octet_length(article::text) <= 4096))
);

-- 보관 기간 정리(나중에)용·분당 상한 계산용. 페이지는 기본 키(id)로 넘긴다
create index if not exists chat_messages_created_at_idx   on public.chat_messages (created_at);
create index if not exists chat_messages_user_created_idx on public.chat_messages (user_id, created_at);

-- ───────────────────────── 함수 ─────────────────────────
-- 기사 첨부 모양 검사(lib/chat.ts checkArticle 와 같은 규칙). private 스키마라 Data API 에 노출되지 않는다
create or replace function private.chat_article_ok(a jsonb) returns boolean
  language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
begin
  if a is null or jsonb_typeof(a) <> 'object' or octet_length(a::text) > 4096 then
    return false;
  end if;
  for k, v in select e.key, e.value from jsonb_each(a) e loop
    if k not in ('id', 'cluster_id', 'channel', 'title', 'source', 'url', 'published_at') or jsonb_typeof(v) <> 'string' then
      return false;
    end if;
  end loop;
  if not (a ? 'id' and a ? 'channel' and a ? 'title' and a ? 'url') then
    return false;
  end if;
  if (a ->> 'id') !~ '^[A-Za-z0-9_.:-]{1,64}$'
     or (a ? 'cluster_id' and (a ->> 'cluster_id') !~ '^[A-Za-z0-9_.:-]{1,64}$')
     or (a ->> 'channel') not in ('insurance', 'ai', 'finance')
     or char_length(a ->> 'title') > 200 or btrim(a ->> 'title') = '' or (a ->> 'title') ~ '[[:cntrl:]]'
     or (a ? 'source' and (char_length(a ->> 'source') > 60 or btrim(a ->> 'source') = '' or (a ->> 'source') ~ '[[:cntrl:]]'))
     or char_length(a ->> 'url') > 2048 or (a ->> 'url') !~* '^https?://[^[:space:][:cntrl:]]+$'
     or (a ? 'published_at' and (a ->> 'published_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:?[0-9]{2})$') then
    return false;
  end if;
  return true;
end $$;

-- 글 보내기. author_name 은 클라이언트가 보내지 않고 여기서 profiles 에서 읽는다
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
  if char_length(b) < 1 or char_length(b) > 500 then
    raise sqlstate 'PT422' using message = 'body_length';
  end if;
  -- 줄바꿈(\n)만 허용. 그 밖의 C0·DEL·C1 제어 문자와 글자 방향을 바꾸는 문자(U+202A–202E, U+2066–2069)는 거절
  if b ~ '[\x01-\x09\x0b-\x1f\x7f\u0080-\u009f‪-‮⁦-⁩]' then
    raise sqlstate 'PT422' using message = 'body_format';
  end if;
  if a is not null and not private.chat_article_ok(a) then
    raise sqlstate 'PT422' using message = 'article_format';
  end if;
  -- 분당 상한: 같은 사용자의 동시 호출은 차례로 센다(지운 글도 센다 — 행은 남는다)
  perform pg_advisory_xact_lock(hashtext('heukseok.chat_send:' || uid::text));
  select count(*) into n from public.chat_messages m where m.user_id = uid and m.created_at > now() - interval '1 minute';
  if n >= 60 then
    raise sqlstate 'PT429' using message = 'rate_limited';
  end if;
  insert into public.chat_messages (user_id, author_name, body, article)
  values (uid, coalesce(nullif(btrim(nm), ''), '이름 없음'), b, a)
  returning * into r;
  return jsonb_build_object('id', r.id, 'created_at', r.created_at, 'author_name', r.author_name);
end $$;

-- 삭제: 글쓴이 본인 또는 관리자(profiles.is_admin). 행은 남기고 내용을 비운다(이미 지운 글은 그대로 성공)
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
  select * into m from public.chat_messages c where c.id = p_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;
  if m.user_id <> uid and not coalesce(adm, false) then
    raise sqlstate 'PT403' using message = 'not_allowed';
  end if;
  if m.deleted_at is null then
    update public.chat_messages c
       set body = null, article = null, deleted_at = now(), deleted_by = uid
     where c.id = p_id
    returning * into m;
  end if;
  return jsonb_build_object('id', m.id, 'deleted_at', m.deleted_at);
end $$;

-- 목록: 최근 글부터(id 내림차순), p_before 보다 작은 id 만(keyset). security invoker → 표의 select 정책(RLS)으로 읽는다.
-- 읽을 수 없는 사용자는 0행 대신 오류(PT403)로 알려 화면이 '준비 중'과 '빈 방'을 구분하게 한다
create or replace function public.chat_list(p_before bigint default null, p_limit int default 100)
  returns table (id bigint, user_id uuid, author_name text, body text, article jsonb, created_at timestamptz, deleted_at timestamptz)
  language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then
    raise sqlstate 'PT401' using message = 'not_signed_in';
  end if;
  if not private.password_ready() then
    raise sqlstate 'PT403' using message = 'not_allowed';
  end if;
  return query
    select m.id, m.user_id, m.author_name, m.body, m.article, m.created_at, m.deleted_at
      from public.chat_messages m
     where p_before is null or m.id < p_before
     order by m.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ───────────────────────── RLS·권한 ─────────────────────────
alter table public.chat_messages enable row level security;

-- 아무 권한도 없는 상태에서 시작: 사용자는 읽기(select)만. 쓰기 GRANT 는 authenticated 에도 주지 않는다(함수는 소유자 권한으로 쓴다)
revoke all on table public.chat_messages from public, anon, authenticated;
grant select on table public.chat_messages to authenticated;
grant select, insert, update, delete on table public.chat_messages to service_role;
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated', pg_get_serial_sequence('public.chat_messages', 'id'));
end $$;

drop policy if exists "chat_messages: 읽기" on public.chat_messages;
create policy "chat_messages: 읽기" on public.chat_messages for select to authenticated
  using ((select private.password_ready()));
-- insert·update·delete 정책은 만들지 않는다(GRANT 도 없음 → 직접 쓰기는 42501)

-- 함수 실행 권한: public·anon 회수, authenticated 만. private 검사 함수는 아무에게도 주지 않는다(chat_send 가 소유자 권한으로 부른다)
revoke all on function public.chat_send(text, jsonb)        from public, anon, authenticated;
revoke all on function public.chat_delete(bigint)           from public, anon, authenticated;
revoke all on function public.chat_list(bigint, int)        from public, anon, authenticated;
revoke all on function private.chat_article_ok(jsonb)       from public, anon, authenticated;
grant execute on function public.chat_send(text, jsonb)     to authenticated;
grant execute on function public.chat_delete(bigint)        to authenticated;
grant execute on function public.chat_list(bigint, int)     to authenticated;

-- ───────────────────────── Realtime ─────────────────────────
-- supabase_realtime 발행에 넣는다(이미 있으면 건너뜀). 이벤트는 구독자의 토큰으로 위 select 정책을 거친 뒤에만 간다.
-- 글 삭제는 행 UPDATE(body = null)라 UPDATE 이벤트로 전해진다(정책을 거친다).
-- 행 자체가 지워지는 경우(계정 삭제 cascade, 나중의 보관 기간 정리)는 DELETE 이벤트인데, DELETE 이벤트는 RLS 를 거치지 않고 기본 키(id)만 담긴다
-- → 내용은 새지 않고, 화면은 그 id 를 목록에서 뺀다.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime 발행이 없습니다 — docs/auth-runbook.md 2-2장 Realtime 확인';
  elsif not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

commit;

-- ───────────────────────── 확인 쿼리(따로 실행) ─────────────────────────
-- 1) 표 권한: authenticated 는 SELECT 만, anon 행 없음
-- select grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'chat_messages' and grantee in ('anon','authenticated','service_role') group by 1;
-- 2) 정책: chat_messages 에 select 하나
-- select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'chat_messages';
-- 3) 함수 실행 권한: authenticated(와 소유자·service_role 등)만, anon·public 없음
-- select routine_name, grantee from information_schema.routine_privileges
--  where routine_schema = 'public' and routine_name in ('chat_send','chat_delete','chat_list') order by 1, 2;
-- 4) Realtime 발행: 한 행(public, chat_messages)
-- select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages';

-- ───────────────────────── 되돌리기(필요할 때만, 따로 실행) ─────────────────────────
-- 채팅 글이 모두 지워진다. 사이트는 '채팅 준비 중입니다'로 보인다(다른 기능은 그대로).
-- alter publication supabase_realtime drop table public.chat_messages;
-- drop function if exists public.chat_send(text, jsonb), public.chat_delete(bigint), public.chat_list(bigint, int);
-- drop function if exists private.chat_article_ok(jsonb);
-- drop table if exists public.chat_messages;
