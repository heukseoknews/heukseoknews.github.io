import type { Metadata } from 'next';
import Footer from '../components/Footer';
import SiteHeader from '../components/SiteHeader';
import StaleNotice from '../components/StaleNotice';
import './globals.css';
export const metadata: Metadata = { title: 'Actuary News Hub | 보험계리 뉴스', description: '보험계리 업무에 필요한 뉴스를 매일 아침 자동으로 모아 보여 주는 공개 뉴스 대시보드' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>
    <SiteHeader />
    <main className="shell"><StaleNotice />{children}</main>
    <Footer />
  </body></html>;
}
