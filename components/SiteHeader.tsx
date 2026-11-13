'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, UserRound, X } from 'lucide-react';
import { CHANNELS, CHANNEL_NAME_WIDTH, channelHref } from '../lib/channels';
import { ME_HOME, meChannels, meHref } from '../lib/me';
import { useChannel } from '../lib/channelContext';
import { SITE } from '../lib/site';
import { isStale } from '../lib/stale';
import { useLastCollected } from '../lib/useSiteInfo';
import Wordmark from './Wordmark';
import { AUTH_MODE } from '../lib/authConfig';

// 계정 메뉴는 로그인을 켠 빌드에서만 불러온다(꺼진 빌드의 번들에는 로그인 코드가 들어가지 않게)
const AccountMenu = dynamic(() => import('./AccountMenu'));

// 채널 안 경로(/<채널>/ 뒤). 주 메뉴는 기사 보기. 오른쪽 위는 마이페이지(내 북마크·내 데이터, 로그인 뒤 계정)
const MAIN = [['', '뉴스'], ['week/', '이번 주 핵심'], ['trends/', '키워드 추이']] as const;

/** 채널 페이지 공통 헤더(상단 고정): 워드마크(홈 /) · 채널명 · 주 메뉴 · 마이페이지. ≤640px 에서는 햄버거 메뉴로 접힌다.
 *  채널 이동 줄은 헤더 아래 ChannelSwitcher. 수집 지연일 때만 배지(링크 아님)를 보인다.
 *  me: 마이페이지(/me/) — 채널명 자리에 '마이페이지', 주 메뉴는 공개 채널의 뉴스로 가는 링크.
 *  label: 채널과 무관한 다른 화면(채팅 /chat/)이 me 틀을 쓰면서 채널명 자리 글자만 바꿀 때. */
export default function SiteHeader({ me = false, label }: { me?: boolean; label?: string }) {
  const pathname = usePathname();
  const ch = useChannel();
  const [open, setOpen] = useState(false);
  const finished = useLastCollected(ch.slug);
  const stale = !me && isStale(finished);
  const btn = useRef<HTMLButtonElement>(null);
  const norm = (p: string) => (p.endsWith('/') ? p : p + '/');
  const isCurrent = (href: string) => norm(pathname || '/') === href;
  const link = (href: string, label: string, current = isCurrent(href)) =>
    <li key={href}><Link href={href} aria-current={current ? 'page' : undefined} className={current ? 'active' : ''}>{label}</Link></li>;
  const item = ([sub, label]: readonly [string, string]) => link(channelHref(ch.slug, sub), label);
  const mainItems = me
    ? meChannels(CHANNELS.map(c => c.slug)).map(slug => link(channelHref(slug), `${CHANNELS.find(c => c.slug === slug)!.name} 뉴스`, false))
    : MAIN.map(item);

  // 오른쪽 위: 마이페이지 버튼. 로그인을 켠 빌드에서는 로그인하면 계정 메뉴(표시 이름)로 바뀐다(AccountMenu)
  const meLink = <Link href={meHref(ME_HOME, ch.slug)} className={'meBtn' + (me ? ' active' : '')} aria-current={me ? 'page' : undefined}><UserRound size={17} aria-hidden="true" />마이페이지</Link>;

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return <header className="siteHeader">
    <a href="#content" className="skipLink">본문 바로가기</a>
    <div className="siteHeaderInner">
      <div className="siteBrand">
        <Link href="/" className="brandHome" aria-label={`${SITE.name} 홈`}><Wordmark /></Link>
        <span className={'chName' + (me ? '' : ' fixed')} style={me ? undefined : { width: CHANNEL_NAME_WIDTH }}>{me ? (label ?? '마이페이지') : ch.name}</span>
      </div>
      <button ref={btn} type="button" className="menuBtn" aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(o => !o)}>
        {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
      </button>
      <div id="site-nav" className={'siteNav' + (open ? ' open' : '')}>
        <nav aria-label="사이트 메뉴"><ul>{mainItems}</ul></nav>
        <nav aria-label="보조 메뉴" className="utilNav"><ul>{AUTH_MODE === 'off' ? <li>{meLink}</li> : <AccountMenu meHref={meHref(ME_HOME, ch.slug)} />}</ul></nav>
        {stale && finished && <span className="collectBadge warn" role="status" title={`마지막 수집 ${ch.fmt(finished)}`}>수집 지연</span>}
      </div>
    </div>
  </header>;
}
