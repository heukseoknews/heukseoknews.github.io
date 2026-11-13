'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AUTH_MODE } from '../lib/authConfig';
import { browserKV, changeHref, decideGate, isAuthPath, loginHref, readAccount, refreshAccount, sessionUser } from '../lib/auth';
import { supabaseBackend } from '../lib/authBackend';
import { notifyAuth } from '../lib/useAccount';
import ClaimPrompt from './ClaimPrompt';

const here = () => location.pathname + location.search + location.hash;
const go = (to: string) => { document.documentElement.setAttribute('data-auth', 'leaving'); location.replace(to); };

/** 장벽(로그인을 켠 빌드에서만 app/layout 이 씌운다). 첫 판정은 <head> 인라인 스크립트(lib/auth.ts gateScript)가 화면을 그리기 전에 한다.
 *  여기서는 (1) 사이트 안 이동 때 같은 판정을 다시 하고 (2) 뒤에서 서버의 계정 상태를 다시 읽어 '변경 필요'가 되면 변경 화면으로,
 *  (3) 서버가 세션을 끝내면 로그인 화면으로 보낸다. 서버가 안 되면 마지막으로 알려진 상태 그대로 둔다(튕기지 않음). */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  useEffect(() => {
    if (isAuthPath(path)) return;
    const userId = sessionUser(browserKV);
    const g = decideGate({ mode: AUTH_MODE, path, userId, account: userId ? readAccount(browserKV, userId) : null });
    if (g === 'login') { go(loginHref(here())); return; }
    if (g === 'change') { go(changeHref(here())); return; }
    let alive = true;
    if (userId) refreshAccount(supabaseBackend, browserKV, { mode: AUTH_MODE, path }).then(r => {
      if (!alive) return;
      notifyAuth();
      if (r === 'change') go(changeHref(here()));
    });
    const off = supabaseBackend.onSignedOut(() => {
      notifyAuth();
      if (AUTH_MODE === 'required' && !isAuthPath(location.pathname)) go(loginHref(here()));
    });
    return () => { alive = false; off(); };
  }, [path]);
  return <>{children}<ClaimPrompt /></>;   // ClaimPrompt: 처음 로그인하면 이 기기 북마크를 합칠지 묻기
}
