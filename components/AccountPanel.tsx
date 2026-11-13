'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AUTH_MODE } from '../lib/authConfig';
import { browserKV, loginHref } from '../lib/auth';
import { supabaseBackend } from '../lib/authBackend';
import { NAME_MSG, saveDisplayName } from '../lib/displayName';
import { ME_ACCOUNT, ME_HOME } from '../lib/me';
import { notifyAuth, useAccount } from '../lib/useAccount';
import PasswordPanel from './PasswordPanel';

/** 마이페이지 → 계정: 표시 이름 바꾸기와 비밀번호 변경(PasswordPanel). 로그인을 켠 빌드에서만 메뉴가 보인다.
 *  저장은 서버 함수 하나로만(lib/displayName.ts → set_display_name). 성공하면 계정 사본을 고쳐 헤더 이름이 새로고침 없이 바뀐다.
 *  서버 함수가 아직 없으면(SQL 적용 전) 저장 때 '준비 중' 한 줄만 보이고 화면은 그대로다. */
export default function AccountPanel() {
  const acc = useAccount();
  const [val, setVal] = useState('');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = useRef(false);

  useEffect(() => { if (AUTH_MODE === 'off') location.replace(ME_HOME); }, []);
  useEffect(() => { if (acc.state === 'in' && !filled.current) { filled.current = true; setVal(acc.name); } }, [acc]);

  if (AUTH_MODE === 'off' || acc.state === 'unknown') return <div className="empty">불러오는 중입니다…</div>;
  if (acc.state === 'out') return <section className="articles dataPanel" aria-labelledby="name-title">
    <h2 id="name-title">표시 이름</h2>
    <p className="nameNow">로그인이 필요합니다.</p>
    <div className="dataActions"><Link href={loginHref(ME_ACCOUNT.href)} className="confirm">로그인</Link></div>
  </section>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(''); setDone(false);
    const r = await saveDisplayName(supabaseBackend, browserKV, val);
    if ('error' in r) setMsg(NAME_MSG[r.error]);
    else { setVal(r.name); setMsg('저장했습니다.'); setDone(true); notifyAuth(); }
    setBusy(false);
  };
  return <><section className="articles dataPanel" aria-labelledby="name-title">
    <h2 id="name-title">표시 이름</h2>
    <p className="nameNow">지금 이름 <b>{acc.name || '없음'}</b>{acc.loginId && <span>아이디 {acc.loginId}</span>}</p>
    <form className="nameForm" onSubmit={save}>
      <label className="srOnly" htmlFor="displayName">새 표시 이름</label>
      <input id="displayName" value={val} onChange={e => { setVal(e.target.value); setMsg(''); setDone(false); }} maxLength={60} autoComplete="nickname" spellCheck={false} aria-describedby="nameHint nameMsg" />
      <button type="submit" className="confirm" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
    </form>
    <p className="dataNote" id="nameHint">1~20자, 다른 사람과 겹치지 않게. 바꾼 뒤 10분 동안은 다시 바꾸지 못합니다.</p>
    <p id="nameMsg" className={'nameMsg' + (done ? ' ok' : '')} role="status">{msg}</p>
  </section>
  <PasswordPanel loginId={acc.loginId} /></>;
}
