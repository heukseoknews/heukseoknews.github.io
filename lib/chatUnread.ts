/** 헤더 '채팅' 버튼의 안 읽은 채팅 수 배지: 순수 로직(표시 문구·세는 규칙·갱신 주기). 서버 연결은 lib/chatUnreadBackend.ts, 화면은 components/ChatLink.tsx.
 *  안 읽음 = 내 마지막 읽은 위치(chat_reads.last_read_id) 이후의 글 중 내가 쓰지 않았고 지워지지 않은 글(chat_messages). 새 표·열·RLS 없이 기존 구조만 쓴다.
 *  갱신: 처음 한 번, 이후 약 60초마다. 탭이 가려지면 멈추고 다시 보이면 즉시 한 번. 채팅 화면에서 읽음 처리되면 0(CHAT_READ_EVENT).
 *  조회가 실패하면(표·함수가 없거나 네트워크) 배지를 숨긴다(null) — 페이지는 그대로. */

export const POLL_MS = 60_000;
/** 채팅 화면(components/ChatRoom.tsx)이 읽음 처리에 성공하면 보내는 같은 탭 이벤트 */
export const CHAT_READ_EVENT = 'heukseok-chat-read';
export const notifyChatRead = () => { try { window.dispatchEvent(new Event(CHAT_READ_EVENT)); } catch { /* 서버 렌더 */ } };

/** 배지 글자: 0 은 '0'(흐리게), 99 를 넘으면 '99+' */
export const badgeText = (n: number) => (n > 99 ? '99+' : String(Math.max(0, Math.floor(n))));
/** 화면 읽기 프로그램용 이름 */
export const badgeLabel = (n: number) => `채팅, 안 읽은 채팅 ${Math.max(0, Math.floor(n))}개`;

/** 세는 규칙(서버 조회 lib/chatUnreadBackend.ts 와 같은 조건): 마지막 읽은 위치 이후, 내가 쓴 글 제외, 지운 글 제외 */
export type UnreadMsg = { id: number; user_id: string; deleted_at?: string | null };
export const countUnread = (msgs: UnreadMsg[], lastReadId: number, me: string) =>
  msgs.filter(m => m.id > lastReadId && m.user_id !== me && !m.deleted_at).length;

/** 배지를 보일지: 로그인을 켠 빌드 + 로그인 + 비밀번호 변경 끝남(uid). 로그아웃이면 지금처럼 배지 없음 */
export const unreadEnabled = (authMode: 'off' | 'optional' | 'required', uid: string | null) => authMode !== 'off' && !!uid;

/** 갱신 제어(타이머·보이기 상태를 주입받아 테스트 가능). value: 안 읽은 수, null 이면 숨김 */
export type UnreadDeps = {
  fetch: () => Promise<number>;
  onChange: (value: number | null) => void;
  visible: () => boolean;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (h: unknown) => void;
  intervalMs?: number;
};
export function createUnreadPoller(d: UnreadDeps) {
  let timer: unknown = null, seq = 0, stopped = false;
  const run = async () => {
    const n = ++seq;
    try { const v = await d.fetch(); if (n === seq && !stopped) d.onChange(Math.max(0, v)); }
    catch { if (n === seq && !stopped) d.onChange(null); }   // 실패하면 숨김
  };
  const startTimer = () => { if (timer === null) timer = d.setInterval(() => { void run(); }, d.intervalMs ?? POLL_MS); };
  const stopTimer = () => { if (timer !== null) { d.clearInterval(timer); timer = null; } };
  return {
    /** 처음 한 번 + 주기 시작(가려진 탭이면 보일 때까지 기다림) */
    start() { stopped = false; if (d.visible()) { void run(); startTimer(); } },
    stop() { stopped = true; seq++; stopTimer(); },
    /** visibilitychange: 가려지면 멈춤, 보이면 즉시 한 번 + 주기 다시 */
    onVisibility() { if (stopped) return; if (d.visible()) { void run(); startTimer(); } else stopTimer(); },
    /** 채팅 화면에서 읽음 처리됨: 바로 0(진행 중인 조회 결과는 버림) */
    markedRead() { if (stopped) return; seq++; d.onChange(0); },
  };
}
