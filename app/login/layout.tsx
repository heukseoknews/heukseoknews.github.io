import type { Metadata } from 'next';
import { SITE } from '../../lib/site';

// 로그인·비밀번호 변경: 채널 설정과 무관하게 언제나 검색 색인에서 뺀다
export const metadata: Metadata = {
  title: { absolute: `로그인 | ${SITE.name}` },
  description: `${SITE.name} 로그인`,
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <main className="authPage" id="content">{children}</main>;
}
