'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useChannel } from '../../../lib/channelContext';
import { dataHref, settingsRedirectJs } from '../../../lib/me';

/** 옛 '내 데이터' 주소: 마이페이지 내 데이터(/me/data/?ch=<채널>)로 보낸다. 옛 사이트 이전 링크(#import=…)의 해시도 그대로 넘긴다.
 *  처음 열 때는 인라인 스크립트가 화면을 그리기 전에, 사이트 안에서 이동해 온 경우에는 effect 가 보낸다. */
export default function SettingsPage() {
  const ch = useChannel();
  useEffect(() => { location.replace(dataHref(ch.slug) + location.hash); }, [ch.slug]);
  return <>
    <script dangerouslySetInnerHTML={{ __html: settingsRedirectJs(ch.slug) }} />
    <h1 className="srOnly">내 데이터</h1>
    <div className="empty"><b>내 데이터는 마이페이지로 옮겼습니다.</b><Link className="confirm" href={dataHref(ch.slug)}>마이페이지로 이동</Link></div>
  </>;
}
