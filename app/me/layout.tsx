import type { Metadata } from 'next';
import MeShell from '../../components/MeShell';
import { SITE } from '../../lib/site';

// 개인 화면: 검색 색인에서 뺀다
export const metadata: Metadata = {
  title: { absolute: `마이페이지 | ${SITE.name}` },
  description: `${SITE.name} 마이페이지 — 내 북마크와 내 데이터`,
  robots: { index: false, follow: false },
};

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return <MeShell>{children}</MeShell>;
}
