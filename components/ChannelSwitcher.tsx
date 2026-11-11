'use client';
import Link from 'next/link';
import { CHANNELS, channelHref } from '../lib/channels';
import { useChannel } from '../lib/channelContext';

/** 채널 전환(현재 채널 강조). 채널이 하나뿐이면 보이지 않는다. */
export default function ChannelSwitcher() {
  const ch = useChannel();
  if (CHANNELS.length <= 1) return null;
  return <nav className="channelSwitch" aria-label="채널">
    <ul>{CHANNELS.map(c => <li key={c.slug}>
      <Link href={channelHref(c.slug)} aria-current={c.slug === ch.slug ? 'true' : undefined} className={c.slug === ch.slug ? 'active' : ''}>{c.name}</Link>
    </li>)}</ul>
  </nav>;
}
