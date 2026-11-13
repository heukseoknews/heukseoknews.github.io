'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { AUTH_MODE } from '../lib/authConfig';
import { browserKV, headerSlot, LOGIN_PATH, loginHref, logout } from '../lib/auth';
import { supabaseBackend } from '../lib/authBackend';
import { notifyAuth, useAccount } from '../lib/useAccount';
import { SyncDot } from './SyncNote';
import ChatLink from './ChatLink';

/** 헤더 오른쪽 계정 자리(로그인을 켠 빌드에서만 쓴다. 꺼진 빌드는 기존 마이페이지 버튼 그대로). 무엇을 보일지는 lib/auth.ts headerSlot.
 *  로그인 상태: [표시 이름] 버튼 → 표시 이름·아이디, 마이페이지, 로그아웃. ≤640px(햄버거 안)에서는 버튼 없이 목록으로 펼친다.
 *  로그아웃 상태: '로그인' 하나(마이페이지 버튼과 같은 모양·높이). 확인 전: 비움.
 *  표시 이름이 길어도 자리 폭이 넘치지 않게 말줄임(최대 폭 고정).
 *  로그인 상태의 헤더(li)에서는 왼쪽에 '채팅'(ChatLink)을 함께 둔다 — 같은 조건·같은 번들이라 따로 불러오지 않는다. */
export default function AccountMenu({ meHref, as: Tag = 'li' }: { meHref: string; as?: 'li' | 'div' }) {
  const acc = useAccount();
  const path = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const slot = headerSlot(AUTH_MODE, acc.state);
  if (slot === 'none') return null;
  if (slot === 'login' || acc.state !== 'in') return <Tag className="acctSlot"><Link href={loginHref(path)} className="meBtn loginLink"><LogIn size={17} aria-hidden="true" />로그인</Link></Tag>;

  const name = acc.name || acc.loginId || '내 계정';
  const signOut = async () => {
    setBusy(true);
    await logout(supabaseBackend, browserKV);   // 이 기기 세션만 지운다(북마크 등 기기 안 기록은 그대로)
    notifyAuth();
    // required: 장벽(AuthGate)이 로그아웃 알림을 받아 이미 로그인 화면으로 옮기는 중이면 한 번만 옮긴다
    if (AUTH_MODE === 'required') { if (document.documentElement.getAttribute('data-auth') !== 'leaving') location.replace(LOGIN_PATH); }
    else { setBusy(false); setOpen(false); }
  };
  return <>{Tag === 'li' && <ChatLink />}<Tag className="acct" ref={box as never}>
    <button ref={btn} type="button" className="acctBtn" aria-expanded={open} aria-controls="acctPanel" onClick={() => setOpen(o => !o)}>
      <UserRound size={17} aria-hidden="true" /><span className="acctName">{name}</span><SyncDot />
    </button>
    <div id="acctPanel" className={'acctPanel' + (open ? ' open' : '')}>
      <p className="acctWho"><b>{name}</b>{acc.loginId && <span>{acc.loginId}</span>}</p>
      <Link href={meHref} className="acctItem"><UserRound size={16} aria-hidden="true" />마이페이지</Link>
      <button type="button" className="acctItem" onClick={signOut} disabled={busy}><LogOut size={16} aria-hidden="true" />로그아웃</button>
    </div>
  </Tag></>;
}
