import type { Metadata, Viewport } from 'next';
import { shareMeta } from '../lib/meta';
import { SITE } from '../lib/site';
import './globals.css';

const title = `${SITE.name} | ${SITE.subtitle}`;
const description = '보험·AI·금융 뉴스를 매일 아침 모아 제목과 출처로 보여 줍니다.';
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: title, template: `%s | ${SITE.name}` },
  description,
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: '16x16 32x32 48x48' }], apple: '/apple-touch-icon.png' },
  ...shareMeta(title, description, '/'),
};
export const viewport: Viewport = { themeColor: '#173e74' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
