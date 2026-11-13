'use client';
import { useEffect, useRef, useState } from 'react';
import { AUTH_MODE } from '../lib/authConfig';
import { browserKV, changeHref, login, LOGIN_ID_KEY, readAccount, safeNext, sessionUser } from '../lib/auth';
import { supabaseBackend } from '../lib/authBackend';
import Wordmark from './Wordmark';

const nextParam = () => new URLSearchParams(location.search).get('next');

/** 로그인 화면(/login/). 아이디·비밀번호·아이디 저장. 가입 화면은 없다(계정은 관리자가 만든다).
 *  비밀번호는 저장하지 않고(브라우저 비밀번호 관리자는 막지 않음), 주소·콘솔에도 남기지 않는다. */
export default function LoginForm() {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (AUTH_MODE === 'off') { location.replace('/'); return; }
    // 이미 로그인한 상태로 오면: 변경 필요면 변경 화면, 아니면 next
    const userId = sessionUser(browserKV);
    if (userId) {
      const a = readAccount(browserKV, userId);
      location.replace(a && !a.mustChange ? safeNext(nextParam()) : changeHref(safeNext(nextParam())));
      return;
    }
    const saved = browserKV.get(LOGIN_ID_KEY);
    if (saved) { setId(saved); setRemember(true); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) (id ? pwRef : idRef).current?.focus(); }, [ready]);  // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg('');
    const r = await login(supabaseBackend, browserKV, { id, password: pw, next: nextParam(), remember });
    if ('go' in r) { location.replace(r.go); return; }
    setMsg(r.message); setPw(''); setBusy(false);
    pwRef.current?.focus();
  };

  return <form className="authCard" method="post" onSubmit={submit} noValidate aria-busy={!ready}>
    <div className="authLogo"><Wordmark /></div>
    <h1>로그인</h1>
    <label className="authField"><span>아이디</span>
      <input ref={idRef} name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={40} value={id} onChange={e => setId(e.target.value)} disabled={!ready} />
    </label>
    <label className="authField"><span>비밀번호</span>
      <input ref={pwRef} type="password" name="password" autoComplete="current-password" maxLength={200} value={pw} onChange={e => setPw(e.target.value)} disabled={!ready} />
    </label>
    <label className="authCheck"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} disabled={!ready} /> 아이디 저장</label>
    <p className="authMsg" role="alert">{msg}</p>
    <button type="submit" className="confirm authSubmit" disabled={!ready || busy}>{busy ? '로그인 중…' : '로그인'}</button>
  </form>;
}
