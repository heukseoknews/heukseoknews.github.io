import type { Metadata } from 'next';
import { SITE } from '../lib/site';
import './globals.css';
export const metadata: Metadata = { title: `${SITE.name} | ${SITE.subtitle}`, description: `${SITE.name}(${SITE.nameEn}) — ${SITE.subtitle}. 매일 아침 자동으로 모은 뉴스의 제목·링크·출처만 보여 줍니다.` };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
