import { Landmark, ShieldCheck, Sparkles } from 'lucide-react';
import { getChannel } from '../lib/channels';
import { PLANNED_THEMES } from '../lib/theme';

const ICONS: Record<string, typeof ShieldCheck> = { insurance: ShieldCheck, ai: Sparkles, finance: Landmark };

/** 채널 아이콘(장식) */
export function ChannelIcon({ slug, size }: { slug: string; size: number }) {
  const Icon = ICONS[slug] ?? ShieldCheck;
  return <Icon size={size} aria-hidden="true" />;
}

/** 요소 하나에만 그 채널 색을 준다(--c-accent·--c-soft). 홈 카드·채널 이동 줄 버튼. */
export function channelColors(slug: string): React.CSSProperties {
  const t = getChannel(slug)?.themeVars ?? PLANNED_THEMES[slug] ?? {};
  return { '--c-accent': t['--accent'], '--c-soft': t['--accent-soft'] } as React.CSSProperties;
}
