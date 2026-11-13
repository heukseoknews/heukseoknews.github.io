'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle } from 'lucide-react';

export const CHAT_PATH = '/chat/';

/** 헤더 오른쪽 '채팅'(계정 메뉴 옆). AccountMenu 가 로그인 상태에서만 그린다(로그인을 켠 빌드에서만 불러오는 같은 번들).
 *  as: 채널·마이페이지 헤더는 li(목록 안), 홈 상단 줄은 div. */
export default function ChatLink({ as: Tag = 'li' }: { as?: 'li' | 'div' }) {
  const path = usePathname() || '/';
  const on = path === '/chat' || path.startsWith(CHAT_PATH);
  return <Tag className="chatSlot"><Link href={CHAT_PATH} className={'meBtn chatLink' + (on ? ' active' : '')} aria-current={on ? 'page' : undefined}><MessageCircle size={17} aria-hidden="true" />채팅</Link></Tag>;
}
