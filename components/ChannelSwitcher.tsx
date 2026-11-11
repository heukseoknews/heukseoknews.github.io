'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Landmark, ShieldCheck, Sparkles } from 'lucide-react';
import { getChannel } from '../lib/channels';
import { useChannel } from '../lib/channelContext';
import { channelRow } from '../lib/directory';
import { PLANNED_THEMES } from '../lib/theme';

const ICONS: Record<string, typeof ShieldCheck> = { insurance: ShieldCheck, ai: Sparkles, finance: Landmark };
/** 채널 색(이동 줄 버튼 하나에만 적용) */
export const channelColors = (slug: string) => {
  const t = getChannel(slug)?.themeVars ?? PLANNED_THEMES[slug] ?? {};
  return { '--c-accent': t['--accent'], '--c-soft': t['--accent-soft'] } as React.CSSProperties;
};

/** 헤더 아래 채널 이동 줄. 공개(live) 채널은 링크, 준비 중(soon) 채널은 점선 테두리·비활성(링크 아님). */
export default function ChannelSwitcher() {
  const ch = useChannel();
  const box = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(false);  // 오른쪽으로 더 스크롤할 내용이 있으면 끝을 흐리게
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);
  return <nav className={'chRow' + (more ? ' more' : '')} aria-label="채널">
    <ul ref={box}>{channelRow(ch.slug).map(c => {
      const Icon = ICONS[c.slug] ?? ShieldCheck;
      const inner = <><span className="chDot" aria-hidden="true"><Icon size={14} /></span>{c.name}{!c.href && <span className="soonTag">준비 중</span>}</>;
      return <li key={c.slug} style={channelColors(c.slug)}>
        {c.href
          ? <Link href={c.href} className={'chBtn' + (c.current ? ' on' : '')} aria-current={c.current ? 'page' : undefined}>{inner}</Link>
          : <span className="chBtn soon" aria-disabled="true">{inner}</span>}
      </li>;
    })}</ul>
  </nav>;
}
