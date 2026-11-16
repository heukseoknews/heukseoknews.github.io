-- 흑석일보 기사 피드백: '관련 없음' / '도움 됨' (0006)
-- 실행: Supabase 대시보드 → SQL Editor → 새 쿼리 탭에 이 파일 전체를 붙여 넣고 Run(0001 을 먼저 적용한 뒤). 여러 번 실행해도 결과가 같다(멱등).
-- 절차: docs/auth-runbook.md 2-5장. 설계·분석 주의: docs/feedback.md. 화면: lib/feedback.ts, components/ArticleCard.tsx(로그인했을 때만 버튼).
--
-- 무엇이 바뀌나
--   표 public.article_feedback — 사용자가 기사 카드에서 누른 신호 한 줄(사용자·채널·기사마다 하나).
--     user_id     계정(auth.users). 계정을 지우면 함께 지워진다
--     channel     채널 슬러그(insurance·ai·finance …, user_state 와 같은 검사)
--     article_id  기사 id(데이터의 id, 묶음이면 화면에 보이는 대표 기사 id)
--     signal      'irrelevant'(관련 없음) | 'useful'(도움 됨)
--     created_at  처음 누른 시각(서버 시계, 바꿀 수 없음) / updated_at 마지막으로 바꾼 시각(서버 시계)
--     기본키 (user_id, channel, article_id): 한 기사에 한 사람의 신호는 하나. 같은 버튼을 다시 누르면 행을 지운다(화면).
--   권한(RLS): 본인 행만 읽기·만들기·고치기·지우기. user_state 와 같이 비밀번호를 바꾼 아이디 계정만(private.password_ready()).
--     anon(로그인 안 한 요청)은 표 권한 자체가 없다. 다른 사용자의 행은 어떤 작업으로도 보이거나 바뀌지 않는다.
--     관리자 통계·내보내기(scripts/admin/feedback.mjs)는 service_role 로 읽는다.
--   악용 방지: 사용자당 행 20,000개 상한(서버 트리거). 화면은 한 번에 한 행만 쓴다.
--   Realtime 발행에는 넣지 않는다.
-- 바뀌지 않는 것: profiles·account_security·user_state·채팅 표와 함수.

begin;

-- 0001 이 먼저 적용됐는지 확인(없으면 여기서 멈추고 전체 취소)
do $$
begin
  if to_regprocedure('private.password_ready()') is null or to_regprocedure('private.touch_updated_at()') is null then
    raise exception '0001_init.sql 을 먼저 적용하세요(private.password_ready·private.touch_updated_at 함수가 없습니다)';
  end if;
end $$;

create table if not exists public.article_feedback (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,   -- 계정을 지우면 함께 지워진다
  channel    text        not null check (channel ~ '^[a-z0-9-]{1,32}$'),
  article_id text        not null check (article_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  signal     text        not null check (signal in ('irrelevant', 'useful')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, channel, article_id)
);

-- 시각은 서버 시계로: 만들 때 둘 다 지금, 고칠 때 created_at 은 그대로·updated_at 은 지금(사용자가 보낸 값은 무시)
create or replace function private.article_feedback_stamp() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists article_feedback_stamp on public.article_feedback;
create trigger article_feedback_stamp before insert or update on public.article_feedback
  for each row execute function private.article_feedback_stamp();

-- 사용자당 행 상한(악용 방지). 같은 사용자의 동시 삽입이 상한을 함께 넘지 않게 사용자별 잠금
create or replace function private.article_feedback_limit() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('heukseok.article_feedback:' || new.user_id::text));
  select count(*) into n from public.article_feedback f where f.user_id = new.user_id;
  if n >= 20000 then
    raise exception 'article_feedback limit: rows >20000' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists article_feedback_limit on public.article_feedback;
create trigger article_feedback_limit before insert on public.article_feedback
  for each row execute function private.article_feedback_limit();
revoke execute on function private.article_feedback_stamp(), private.article_feedback_limit() from public, anon, authenticated;

-- 권한: anon 없음, authenticated 는 네 작업(행은 아래 정책이 본인 것만), service_role 은 관리 스크립트용
alter table public.article_feedback enable row level security;
revoke all on table public.article_feedback from public, anon, authenticated;
grant select, insert, update, delete on table public.article_feedback to authenticated;
grant select, insert, update, delete on table public.article_feedback to service_role;

-- 정책: 본인 행만, 그리고 비밀번호를 바꾼 계정만(user_state 와 같음). update 의 with check 로 user_id 바꿔치기 차단
drop policy if exists "article_feedback: 본인 행 읽기"   on public.article_feedback;
drop policy if exists "article_feedback: 본인 행 만들기" on public.article_feedback;
drop policy if exists "article_feedback: 본인 행 고치기" on public.article_feedback;
drop policy if exists "article_feedback: 본인 행 지우기" on public.article_feedback;
create policy "article_feedback: 본인 행 읽기"   on public.article_feedback for select to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "article_feedback: 본인 행 만들기" on public.article_feedback for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "article_feedback: 본인 행 고치기" on public.article_feedback for update to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()))
  with check ((select auth.uid()) = user_id and (select private.password_ready()));
create policy "article_feedback: 본인 행 지우기" on public.article_feedback for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.password_ready()));

-- Realtime 발행에 넣지 않는다. 혹시 들어 있으면 뺀다
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'article_feedback') then
    alter publication supabase_realtime drop table public.article_feedback;
  end if;
end $$;

commit;

-- ───────────────────────── 확인 쿼리(따로 실행) ─────────────────────────
-- 1) 표 권한: authenticated·service_role 에 DELETE,INSERT,SELECT,UPDATE, anon 줄은 없어야 한다
-- select grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'article_feedback' group by 1 order by 1;
-- 2) RLS 켜짐(true)과 정책 4개(SELECT·INSERT·UPDATE·DELETE)
-- select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'article_feedback';
-- select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'article_feedback' order by cmd;
-- 3) 트리거 2개: article_feedback_limit, article_feedback_stamp
-- select trigger_name from information_schema.triggers where event_object_table = 'article_feedback' group by 1 order by 1;
-- 4) Realtime 발행에 없음(0행)
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'article_feedback';

-- ───────────────────────── 되돌리기(필요할 때만, 따로 실행) ─────────────────────────
-- 모든 피드백 기록이 지워진다. 화면은 표가 없어도 버튼 상태만 비운 채 동작한다(실패 허용).
-- drop table if exists public.article_feedback;
-- drop function if exists private.article_feedback_stamp(), private.article_feedback_limit();
