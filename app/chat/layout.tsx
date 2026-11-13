import type { Metadata } from 'next';
import { SITE } from '../../lib/site';

// 개인 화면(로그인한 사용자만): 검색 색인에서 뺀다
export const metadata: Metadata = {
  title: { absolute: `채팅 | ${SITE.name}` },
  description: `${SITE.name} 채팅`,
  robots: { index: false, follow: false },
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
