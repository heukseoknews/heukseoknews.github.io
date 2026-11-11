'use client';
import { createContext, useContext } from 'react';
import { type Channel, CHANNELS, DEFAULT_CHANNEL, getChannel } from './channels';

const Ctx = createContext<Channel>(getChannel(DEFAULT_CHANNEL) ?? CHANNELS[0]);

/** 채널 레이아웃이 현재 채널을 내려준다(서버 → 클라이언트에는 slug 문자열만 넘김). */
export function ChannelProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  return <Ctx.Provider value={getChannel(slug) ?? CHANNELS[0]}>{children}</Ctx.Provider>;
}

export const useChannel = () => useContext(Ctx);
