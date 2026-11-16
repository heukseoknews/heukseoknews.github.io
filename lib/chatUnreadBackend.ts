/** 안 읽은 채팅 수 조회(Supabase). 헤더 ChatLink 가 로그인했을 때만 동적 import 한다. 새 표·열·RLS 없이 기존 구조만 쓴다.
 *  1) 내 마지막 읽은 위치: chat_reads 는 직접 읽을 수 없어(0004, 권한 없음) 기존 함수 chat_mark_read(0) 의 반환값을 쓴다.
 *     이 함수는 위치를 줄이지 않으므로(greatest) 0 을 보내면 위치는 그대로이고 저장된 값만 돌려준다(행이 없던 사용자는 0 으로 한 줄 생김, updated_at 갱신).
 *  2) 개수: chat_messages 를 내용 없이 개수만(head + count) — id > 위치, 내 글 제외, 지운 글 제외. 기본키(id) 범위로 읽는다.
 *  콘솔에는 상태·코드만. 15초 안에 응답이 없으면 실패(배지 숨김). */
import { client } from './authBackend';

const TIMEOUT_MS = 15_000;

export async function fetchUnread(uid: string): Promise<number> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const sb = await client();
    const pos = await sb.rpc('chat_mark_read', { p_last_id: 0 }).abortSignal(ac.signal);
    if (pos.error) { console.error('[chat-unread] position', pos.status, pos.error.code ?? ''); throw new Error('position'); }
    const last = Number(pos.data) || 0;
    const { count, error, status } = await sb.from('chat_messages').select('id', { count: 'exact', head: true })
      .gt('id', last).neq('user_id', uid).is('deleted_at', null).abortSignal(ac.signal);
    if (error) { console.error('[chat-unread] count', status, error.code ?? ''); throw new Error('count'); }
    return count ?? 0;
  } finally {
    clearTimeout(t);
  }
}
