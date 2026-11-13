'use client';
import { useEffect, useState } from 'react';
import { ChannelProvider } from '../../lib/channelContext';
import { CHANNELS, getChannel } from '../../lib/channels';
import { ME_CHANNEL_KEY, meChannels, pickChannel } from '../../lib/me';
import { themeCss } from '../../lib/theme';
import SiteHeader from '../../components/SiteHeader';
import ChatRoom from '../../components/ChatRoom';

const LIST = meChannels(CHANNELS.map(c => c.slug));

/** 전체 채팅방(/chat/): 채널과 무관한 방 하나. 틀은 마이페이지와 같은 헤더(채널명 자리에 '채팅'), 색은 마지막으로 본 마이페이지 채널.
 *  로그인 게이트 안(AuthGate)이고, 방 안의 상태 분기(로그인 꺼진 빌드·로그아웃·서버 준비 전)는 ChatRoom 이 한다. 푸터는 두지 않는다(입력창이 화면 맨 아래). */
export default function ChatPage() {
  const [slug, setSlug] = useState(LIST[0]);
  useEffect(() => {
    let r: string | null = null;
    try { r = localStorage.getItem(ME_CHANNEL_KEY); } catch { /* 저장소 접근 불가 */ }
    setSlug(pickChannel(null, r, LIST));
  }, []);
  const css = themeCss(getChannel(slug)!.themeVars);
  return <ChannelProvider slug={slug}>
    {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
    <SiteHeader me label="채팅" />
    <main className="chatMain" id="content"><h1 className="srOnly">채팅</h1><ChatRoom /></main>
  </ChannelProvider>;
}
