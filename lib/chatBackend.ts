/** 채팅 서버 연결(ChatBackend 의 Supabase 구현). /chat/ 화면에서만 불러온다(components/ChatRoom.tsx 가 동적 import).
 *  쓰기는 서버 함수(chat_send·chat_delete)로만, 읽기는 chat_list(RLS)·Realtime(postgres_changes, 구독자 토큰으로 RLS 적용).
 *  supabase-js(로그인과 같은 연결 — lib/authBackend.ts client())에 Realtime 이 이미 들어 있어 새 라이브러리는 없다.
 *  콘솔에는 상태·코드만 남긴다(본문·토큰은 넣지 않는다). 서버가 무응답이면 15초 뒤 'network' 로 실패시킨다. */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { client } from './authBackend';
import { type ChatBackend, ChatError, type ChatMessage, chatFailOf, isAdminValue, toMessage } from './chat';

const TIMEOUT_MS = 15_000;
type PgErr = { code?: string; message?: string } | null;

const fail = (where: string, status: number, e: PgErr): never => {
  const kind = chatFailOf({ status, code: e?.code, message: e?.message });
  console.error(`[chat] ${where}`, status, e?.code ?? '', kind);
  throw new ChatError(kind);
};
async function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try { return await run(ac.signal); }
  catch (e) { if (e instanceof ChatError) throw e; console.error('[chat] request', (e as Error)?.name ?? ''); throw new ChatError('network'); }
  finally { clearTimeout(t); }
}

export const supabaseChat: ChatBackend = {
  list(before, limit) {
    return withTimeout(async signal => {
      const { data, error, status } = await (await client()).rpc('chat_list', { p_before: before, p_limit: limit }).abortSignal(signal);
      if (error) fail('list', status, error);
      return ((data ?? []) as unknown[]).map(toMessage).filter((m): m is ChatMessage => !!m);
    });
  },
  send(body, article) {
    return withTimeout(async signal => {
      const { data, error, status } = await (await client()).rpc('chat_send', { p_body: body, p_article: article }).abortSignal(signal);
      if (error) fail('send', status, error);
      const d = (data ?? {}) as { id?: number | string; created_at?: string; author_name?: string };
      return { id: Number(d.id), created_at: String(d.created_at ?? new Date().toISOString()), author_name: String(d.author_name ?? '') };
    });
  },
  remove(id) {
    return withTimeout(async signal => {
      const { error, status } = await (await client()).rpc('chat_delete', { p_id: id }).abortSignal(signal);
      if (error) fail('delete', status, error);
    });
  },
  markRead(lastId) {
    return withTimeout(async signal => {
      const { data, error, status } = await (await client()).rpc('chat_mark_read', { p_last_id: lastId }).abortSignal(signal);
      if (error) fail('markRead', status, error);
      return Number(data) || 0;
    });
  },
  readCounts(ids) {
    return withTimeout(async signal => {
      const { data, error, status } = await (await client()).rpc('chat_read_counts', { p_ids: ids }).abortSignal(signal);
      if (error) fail('readCounts', status, error);
      return ((data ?? []) as { id: unknown; read_count: unknown }[]).map(r => ({ id: Number(r.id), read_count: Number(r.read_count) }));
    });
  },
  async isAdmin(userId) {
    try {
      const { data, error } = await (await client()).from('profiles').select('is_admin').eq('user_id', userId).maybeSingle();   // 본인 행만 읽힌다(RLS)
      if (error) return false;   // 못 읽으면 관리자 아님([삭제]를 숨기는 쪽)
      return isAdminValue((data as { is_admin?: unknown } | null)?.is_admin);
    } catch { return false; }
  },
  subscribe(onEvent, onState) {
    let ch: RealtimeChannel | null = null;
    let closed = false;
    onState('connecting');
    client().then(sb => {
      if (closed) return;
      ch = sb.channel('chat-room')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, p => {
          if (p.eventType === 'DELETE') { const id = Number((p.old as { id?: unknown })?.id); if (id > 0) onEvent({ type: 'drop', id }); return; }
          const row = toMessage(p.new);
          if (row) onEvent({ type: 'upsert', row });
        })
        .subscribe(status => {
          if (closed) return;
          // SUBSCRIBED: 처음·다시 연결됨 → 화면이 빠진 글을 보충. 그 밖(오류·시간 초과·닫힘)은 끊김 — realtime-js 가 스스로 다시 붙는다
          onState(status === 'SUBSCRIBED' ? 'live' : 'offline');
          if (status !== 'SUBSCRIBED') console.error('[chat] realtime', status);
        });
    }).catch(() => { if (!closed) onState('offline'); });
    return () => { closed = true; if (ch) client().then(sb => sb.removeChannel(ch!)).catch(() => {}); };
  },
};
