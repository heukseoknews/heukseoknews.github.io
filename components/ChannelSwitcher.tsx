'use client';
import Link from 'next/link';
import { VISIBLE_CHANNELS, channelHref } from '../lib/channels';
import { useChannel } from '../lib/channelContext';

/** 채널 전환(현재 채널 강조). 보이는 채널(hidden 제외)이 하나뿐이면 나타나지 않는다. */
export default function ChannelSwitcher() {
  const ch = useChannel();
  if (VISIBLE_CHANNELS.length <= 1) return null;
  return <nav className="channelSwitch" aria-label="채널">
    <ul>{VISIBLE_CHANNELS.map(c => <li key={c.slug}>
      <Link href={channelHref(c.slug)} aria-current={c.slug === ch.slug ? 'true' : undefined} className={c.slug === ch.slug ? 'active' : ''}>{c.name}</Link>
    </li>)}</ul>
  </nav>;
}
