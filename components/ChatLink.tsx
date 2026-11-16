'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { AUTH_MODE } from '../lib/authConfig';
import { CHAT_READ_EVENT, badgeLabel, badgeText, createUnreadPoller, unreadEnabled } from '../lib/chatUnread';
import { useSyncUser } from '../lib/useAccount';

export const CHAT_PATH = '/chat/';

/** 안 읽은 채팅 수(null = 숨김: 아직 모름·실패·로그아웃). 로그인했을 때만 조회 코드(lib/chatUnreadBackend.ts)를 불러온다 */
function useUnread(): number | null {
  const { uid } = useSyncUser(AUTH_MODE);
  const on = unreadEnabled(AUTH_MODE, uid);
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    setN(null);
    if (!on || !uid) return;
    let poller: ReturnType<typeof createUnreadPoller> | null = null, alive = true;
    const onVis = () => poller?.onVisibility();
    const onRead = () => poller?.markedRead();
    import('../lib/chatUnreadBackend').then(({ fetchUnread }) => {
      if (!alive) return;
      poller = createUnreadPoller({
        fetch: () => fetchUnread(uid), onChange: setN, visible: () => document.visibilityState !== 'hidden',
        setInterval: (fn, ms) => window.setInterval(fn, ms), clearInterval: h => window.clearInterval(h as number),
      });
      poller.start();
    }).catch(() => setN(null));
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(CHAT_READ_EVENT, onRead);
    return () => { alive = false; poller?.stop(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener(CHAT_READ_EVENT, onRead); };
  }, [on, uid]);
  return n;
}

/** 헤더 오른쪽 '채팅'(계정 메뉴 옆). AccountMenu 가 로그인 상태에서만 그린다(로그인을 켠 빌드에서만 불러오는 같은 번들).
 *  안 읽은 채팅 수 배지: 0 은 흐리게, 있으면 강조색 숫자(99 초과 '99+'). 숫자가 바뀌어도 버튼 폭이 변하지 않게 배지 자리(.chatBadge)는 늘 같은 폭으로 둔다.
 *  as: 채널·마이페이지 헤더는 li(목록 안), 홈 상단 줄은 div. */
export default function ChatLink({ as: Tag = 'li' }: { as?: 'li' | 'div' }) {
  const path = usePathname() || '/';
  const on = path === '/chat' || path.startsWith(CHAT_PATH);
  const n = useUnread();
  return <Tag className="chatSlot"><Link href={CHAT_PATH} className={'meBtn chatLink' + (on ? ' active' : '')} aria-current={on ? 'page' : undefined}
    aria-label={n === null ? undefined : badgeLabel(n)}>
    <MessageCircle size={17} aria-hidden="true" />채팅
    <span className={'chatBadge' + (n === null ? ' hidden' : n > 0 ? ' on' : '')} aria-hidden="true">{n === null ? '' : badgeText(n)}</span>
  </Link></Tag>;
}
