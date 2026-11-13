'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle } from 'lucide-react';

export const CHAT_PATH = '/chat/';

/** 헤더 오른쪽 '채팅'(계정 메뉴 옆). AccountMenu 가 로그인 상태에서만 그린다(로그인을 켠 빌드에서만 불러오는 같은 번들). */
export default function ChatLink() {
  const path = usePathname() || '/';
  const on = path === '/chat' || path.startsWith(CHAT_PATH);
  return <li className="chatSlot"><Link href={CHAT_PATH} className={'meBtn chatLink' + (on ? ' active' : '')} aria-current={on ? 'page' : undefined}><MessageCircle size={17} aria-hidden="true" />채팅</Link></li>;
}
