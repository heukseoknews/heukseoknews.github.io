'use client';
import { useState } from 'react';
import { browserKV, loginHref, MSG, updateOwnPassword } from '../lib/auth';
import { supabaseBackend } from '../lib/authBackend';
import { ME_ACCOUNT } from '../lib/me';
import { notifyAuth } from '../lib/useAccount';
import PasswordFields from './PasswordFields';

/** 마이페이지 → 계정: 본인 비밀번호 변경. 첫 로그인 변경 화면과 같은 검사·문구·입력칸(lib/auth.ts updateOwnPassword, PasswordFields).
 *  성공하면 '바꿨습니다' 한 줄, 로그인 상태는 그대로. 비밀번호는 화면 상태에만 두고 성공·실패 뒤 지운다. */
export default function PasswordPanel({ loginId }: { loginId: string }) {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const typed = (f: (v: string) => void) => (v: string) => { f(v); if (done) { setDone(false); setMsg(''); } };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(''); setDone(false);
    const r = await updateOwnPassword(supabaseBackend, browserKV, { current: cur, next: pw, confirm: pw2, loginId });
    if ('signIn' in r) { location.replace(loginHref(ME_ACCOUNT.href)); return; }
    if ('ok' in r) { setCur(''); setPw(''); setPw2(''); setMsg(MSG.changed); setDone(true); notifyAuth(); }
    else { if (r.message === MSG.current) setCur(''); setMsg(r.message); }
    setBusy(false);
  };

  return <section className="articles dataPanel" aria-labelledby="pw-title">
    <h2 id="pw-title">비밀번호 변경</h2>
    <form className="pwForm" method="post" onSubmit={submit} noValidate>
      <PasswordFields loginId={loginId} cur={cur} pw={pw} pw2={pw2} onCur={typed(setCur)} onPw={typed(setPw)} onPw2={typed(setPw2)} disabled={busy} />
      <p className={'nameMsg' + (done ? ' ok' : '')} role="status">{msg}</p>
      <div className="dataActions"><button type="submit" className="confirm" disabled={busy}>{busy ? '바꾸는 중…' : '비밀번호 변경'}</button></div>
    </form>
    <p className="dataNote">{MSG.forgot}</p>
  </section>;
}
