'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChannelProvider } from '../lib/channelContext';
import { CHANNELS, getChannel } from '../lib/channels';
import { ME_CHANNEL_KEY, meChannels, meHref, meMenu, pickChannel } from '../lib/me';
import { AUTH_MODE } from '../lib/authConfig';
import { activeUserId, storeFor } from '../lib/storage';
import { summarize } from '../lib/userState';
import { USER_STATE_EVENT } from '../lib/useSaved';
import { themeCss } from '../lib/theme';
import { ChannelIcon } from './channelLook';
import Footer from './Footer';
import SiteHeader from './SiteHeader';
import dynamic from 'next/dynamic';

// 동기화 상태 줄: 로그인을 켠 빌드에서만 불러온다(꺼진 빌드의 번들에는 없음)
const SyncNote = dynamic(() => import('./SyncNote'), { ssr: false });

const LIST = meChannels(CHANNELS.map(c => c.slug));
const MENU = meMenu(AUTH_MODE !== 'off');   // 로그인을 켠 빌드만 '계정'

/** 마이페이지 틀: 헤더 · 마이페이지 메뉴(내 북마크·내 데이터) · 채널 탭 · 본문 · 푸터.
 *  채널은 ?ch= → 마지막으로 본 채널 → 첫 공개 채널 순서로 정하고, 본문은 그 채널의 ChannelProvider 안에서 그린다(채널 색도 바뀜).
 *  채널이 정해지기 전에는 본문을 그리지 않는다(#import= 해시를 다른 채널로 읽지 않게). */
export default function MeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/me/';
  const [slug, setSlug] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let remembered: string | null = null;
    try { remembered = localStorage.getItem(ME_CHANNEL_KEY); } catch { /* 저장소 접근 불가 */ }
    setSlug(pickChannel(new URLSearchParams(location.search).get('ch'), remembered, LIST));
  }, []);
  const refreshCounts = useCallback(() => {
    const store = storeFor(activeUserId());   // 로그인 중이면 계정 사본의 건수
    setCounts(Object.fromEntries(LIST.map(s => [s, summarize(store.load(s, getChannel(s)?.storage?.legacy_keys)).bookmarks])));
  }, []);
  useEffect(() => {
    refreshCounts();
    window.addEventListener(USER_STATE_EVENT, refreshCounts);
    window.addEventListener('storage', refreshCounts);
    return () => { window.removeEventListener(USER_STATE_EVENT, refreshCounts); window.removeEventListener('storage', refreshCounts); };
  }, [refreshCounts]);

  const choose = (s: string) => {
    setSlug(s);
    try { localStorage.setItem(ME_CHANNEL_KEY, s); } catch { /* 저장 불가 */ }
    history.replaceState(null, '', meHref(pathname, s));
  };
  const cur = slug ?? LIST[0];
  const ch = getChannel(cur)!;
  const css = themeCss(ch.themeVars);
  const norm = (p: string) => (p.endsWith('/') ? p : p + '/');

  return <ChannelProvider slug={cur}>
    {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
    <SiteHeader me />
    <main className="shell meShell" id="content">
      <h1 className="meTitle">마이페이지</h1>
      {AUTH_MODE !== 'off' && <SyncNote channel={cur} />}
      <nav className="meMenu" aria-label="마이페이지 메뉴"><ul>{MENU.map(m => {
        const on = norm(pathname) === m.href;
        return <li key={m.href}><Link href={meHref(m.href, cur)} aria-current={on ? 'page' : undefined} className={on ? 'on' : ''}>{m.label}</Link></li>;
      })}</ul></nav>
      {LIST.length > 1 && <div className="meChannels" role="group" aria-label="채널">{LIST.map(s => {
        const c = getChannel(s)!;
        return <button key={s} type="button" className={'meCh' + (s === cur ? ' on' : '')} aria-pressed={s === cur} onClick={() => choose(s)}>
          <ChannelIcon slug={s} size={16} />{c.name}{counts[s] !== undefined && <span className="count">{counts[s].toLocaleString()}</span>}
        </button>;
      })}</div>}
      {slug ? <Fragment key={slug}>{children}</Fragment> : <div className="empty">불러오는 중입니다…</div>}
    </main>
    <Footer />
  </ChannelProvider>;
}
