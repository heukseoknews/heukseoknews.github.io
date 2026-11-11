'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Newspaper, X } from 'lucide-react';
import { fmtShort } from '../lib/format';
import { isStale } from '../lib/stale';
import { useLastCollected } from '../lib/useSiteInfo';

const LINKS = [['/', '뉴스'], ['/week/', '이번 주 핵심'], ['/trends/', '키워드 추이'], ['/status/', '수집 상태']] as const;

/** 모든 페이지 공통 헤더(상단 고정). ≤640px 에서는 햄버거 메뉴로 접힌다. */
export default function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const finished = useLastCollected();
  const stale = isStale(finished);
  const btn = useRef<HTMLButtonElement>(null);
  const norm = (p: string) => (p.endsWith('/') ? p : p + '/');
  const isCurrent = (href: string) => norm(pathname || '/') === href;

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return <header className="siteHeader">
    <div className="siteHeaderInner">
      <Link href="/" className="siteBrand" aria-label="Actuary News Hub 홈">
        <span className="logo"><Newspaper size={21} aria-hidden="true" /></span>
        <span className="brandText"><strong>Actuary News Hub</strong><small>보험산업 · 보험계리 · 금융시장</small></span>
      </Link>
      <button ref={btn} type="button" className="menuBtn" aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(o => !o)}>
        {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
      </button>
      <nav id="site-nav" className={'siteNav' + (open ? ' open' : '')} aria-label="주 메뉴">
        <ul>{LINKS.map(([href, label]) => <li key={href}>
          <Link href={href} aria-current={isCurrent(href) ? 'page' : undefined} className={isCurrent(href) ? 'active' : ''}>{label}</Link>
        </li>)}</ul>
        {finished && <Link href="/status/" className={'collectBadge' + (stale ? ' warn' : '')} title={stale ? '수집이 지연되고 있습니다. 수집 상태 보기' : '수집 상태 보기'}>
          {stale ? '수집 지연 · ' : '마지막 수집 '}{fmtShort(finished)}
        </Link>}
      </nav>
    </div>
  </header>;
}
