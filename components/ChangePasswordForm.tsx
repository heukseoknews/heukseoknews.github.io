'use client';
import { useEffect, useRef, useState } from 'react';
import { AUTH_MODE } from '../lib/authConfig';
import { browserKV, changePassword, enterChange, LOGIN_PATH, logout, type Account } from '../lib/auth';
import { supabaseBackend } from '../lib/authBackend';
import { notifyAuth } from '../lib/useAccount';
import Wordmark from './Wordmark';

const nextParam = () => new URLSearchParams(location.search).get('next');

/** 첫 로그인 비밀번호 변경(/login/change-password/). 바꾸기 전에는 장벽이 다른 모든 화면을 이리로 되돌리고, 여기서는 로그아웃만 할 수 있다.
 *  서버의 '변경 필요'가 꺼졌는지 다시 읽어 확인한 뒤 원래 가려던 곳으로 간다. 비밀번호는 주소·콘솔·화면 오류에 남기지 않는다. */
export default function ChangePasswordForm() {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (AUTH_MODE === 'off') { location.replace('/'); return; }
    let alive = true;
    enterChange(supabaseBackend, browserKV, { next: nextParam() }).then(r => {
      if (!alive) return;
      if ('go' in r) { location.replace(r.go); return; }
      setAccount(r.form); setReady(true);
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (ready) first.current?.focus(); }, [ready]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg('');
    const r = await changePassword(supabaseBackend, browserKV, { current: cur, next: pw, confirm: pw2, loginId: account?.loginId ?? '', nextPath: nextParam() });
    if ('go' in r) { notifyAuth(); location.replace(r.go); return; }
    setMsg(r.message); setBusy(false);
  };
  const signOut = async () => {
    setBusy(true);
    await logout(supabaseBackend, browserKV);
    location.replace(LOGIN_PATH);
  };

  if (!ready) return <div className="authCard" aria-busy="true"><div className="authLogo"><Wordmark /></div><p className="authWait">확인하는 중…</p></div>;
  return <form className="authCard" onSubmit={submit} noValidate>
    <div className="authLogo"><Wordmark /></div>
    <h1>비밀번호를 바꿔 주세요</h1>
    <p className="authLead">처음 받은 비밀번호는 바꾼 뒤에 이용할 수 있습니다.</p>
    {/* 브라우저 비밀번호 관리자가 어느 계정의 비밀번호인지 알 수 있게(보이지 않음) */}
    <input className="srOnly" name="username" autoComplete="username" value={account?.loginId ?? ''} readOnly tabIndex={-1} aria-hidden="true" />
    <label className="authField"><span>현재 비밀번호</span>
      <input ref={first} type="password" name="current-password" autoComplete="current-password" maxLength={200} value={cur} onChange={e => setCur(e.target.value)} />
    </label>
    <label className="authField"><span>새 비밀번호</span>
      <input type="password" name="new-password" autoComplete="new-password" maxLength={200} value={pw} onChange={e => setPw(e.target.value)} aria-describedby="pwRule" />
    </label>
    <label className="authField"><span>새 비밀번호 확인</span>
      <input type="password" name="new-password-confirm" autoComplete="new-password" maxLength={200} value={pw2} onChange={e => setPw2(e.target.value)} />
    </label>
    <p className="authHint" id="pwRule">8자 이상, 영문과 숫자를 섞고 아이디는 넣지 않습니다.</p>
    <p className="authMsg" role="alert">{msg}</p>
    <button type="submit" className="confirm authSubmit" disabled={busy}>{busy ? '바꾸는 중…' : '비밀번호 변경'}</button>
    <button type="button" className="authLink" onClick={signOut} disabled={busy}>로그아웃</button>
  </form>;
}
