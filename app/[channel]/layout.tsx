import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Footer from '../../components/Footer';
import SiteHeader from '../../components/SiteHeader';
import StaleNotice from '../../components/StaleNotice';
import { ChannelProvider } from '../../lib/channelContext';
import { CHANNELS, getChannel } from '../../lib/channels';
import { SITE } from '../../lib/site';
import { themeCss } from '../../lib/theme';

type Params = { params: Promise<{ channel: string }> };

// 정적 빌드: channels 레지스트리의 채널마다 /<채널>/ 페이지를 만든다.
export const dynamicParams = false;
export function generateStaticParams() { return CHANNELS.map(c => ({ channel: c.slug })); }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const c = getChannel((await params).channel);
  return c ? { title: `${SITE.name} | ${c.subtitle}`, description: `${SITE.name} ${c.name} 채널 — ${c.description}` } : {};
}

export default async function ChannelLayout({ children, params }: Params & { children: React.ReactNode }) {
  const c = getChannel((await params).channel);
  if (!c) notFound();
  const css = themeCss(c.themeVars);  // 채널 theme.json 의 CSS 변수(값은 lib/theme.ts 에서 검사)
  return <ChannelProvider slug={c.slug}>
    {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
    <SiteHeader />
    <main className="shell"><StaleNotice />{children}</main>
    <Footer />
  </ChannelProvider>;
}
