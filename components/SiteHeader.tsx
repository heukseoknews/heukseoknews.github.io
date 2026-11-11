'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { channelHref } from '../lib/channels';
import { useChannel } from '../lib/channelContext';
import { SITE } from '../lib/site';
import { isStale } from '../lib/stale';
import { useLastCollected } from '../lib/useSiteInfo';
import Wordmark from './Wordmark';

// 채널 안 경로(/<채널>/ 뒤). 주 메뉴는 기사 보기, 보조 메뉴는 설정·운영 성격
const MAIN = [['', '뉴스'], ['week/', '이번 주 핵심'], ['trends/', '키워드 추이']] as const;
const UTIL = [['settings/', '내 데이터']] as const;

/** 채널 페이지 공통 헤더(상단 고정): 워드마크(홈 /) · 채널명 · 주 메뉴 · 내 데이터. ≤640px 에서는 햄버거 메뉴로 접힌다.
 *  채널 이동 줄은 헤더 아래 ChannelSwitcher. 수집 상태는 지연일 때만 배지로 보인다. */
export default function SiteHeader() {
  const pathname = usePathname();
  const ch = useChannel();
  const [open, setOpen] = useState(false);
  const finished = useLastCollected(ch.slug);
  const stale = isStale(finished);
  const btn = useRef<HTMLButtonElement>(null);
  const norm = (p: string) => (p.endsWith('/') ? p : p + '/');
  const isCurrent = (href: string) => norm(pathname || '/') === href;
  const item = ([sub, label]: readonly [string, string]) => {
    const href = channelHref(ch.slug, sub);
    return <li key={href}><Link href={href} aria-current={isCurrent(href) ? 'page' : undefined} className={isCurrent(href) ? 'active' : ''}>{label}</Link></li>;
  };

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
        <span className="chName">{ch.name}</span>
      </div>
      <button ref={btn} type="button" className="menuBtn" aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(o => !o)}>
        {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
      </button>
      <div id="site-nav" className={'siteNav' + (open ? ' open' : '')}>
        <nav aria-label="사이트 메뉴"><ul>{MAIN.map(item)}</ul></nav>
        <nav aria-label="보조 메뉴" className="utilNav"><ul>{UTIL.map(item)}</ul></nav>
        {stale && finished && <Link href={channelHref(ch.slug, 'status/')} className="collectBadge warn" title={`마지막 수집 ${ch.fmt(finished)}`}>수집 지연</Link>}
      </div>
    </div>
  </header>;
}
