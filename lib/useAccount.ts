'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { accountKey, browserKV, readAccount, sessionUser, shownName } from './auth';

/** 로그인 상태가 바뀌었음을 같은 탭의 화면(헤더 등)에 알리는 이벤트. 다른 탭은 storage 이벤트로 */
export const AUTH_EVENT = 'heukseok-auth-change';
export const notifyAuth = () => { try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch { /* 서버 렌더 */ } };

const subscribe = (cb: () => void) => {
  window.addEventListener(AUTH_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(AUTH_EVENT, cb); window.removeEventListener('storage', cb); };
};
// 저장된 세션 사용자와 계정 사본 원문을 한 문자열로(같은 값이면 같은 문자열 → 다시 그리지 않음)
const snapshot = () => { const u = sessionUser(browserKV); return u ? `${u}\n${browserKV.get(accountKey(u)) ?? ''}` : ''; };

export type AccountView = { state: 'unknown' } | { state: 'out' } | { state: 'in'; userId: string; loginId: string; name: string };

/** 헤더용 로그인 상태(서버에 묻지 않음, 저장된 세션·계정 사본만). 정적 HTML·첫 렌더에서는 unknown */
export function useAccount(): AccountView {
  const snap = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => {
    if (snap === null) return { state: 'unknown' };
    if (!snap) return { state: 'out' };
    const userId = snap.split('\n')[0];
    const a = readAccount(browserKV, userId);
    if (!a) return { state: 'in', userId, loginId: '', name: '' };
    return { state: 'in', userId, loginId: a.loginId, name: shownName(a) };
  }, [snap]);
}

/** 계정 사본·동기화를 쓸 사용자: 로그인을 켠 빌드 + 로그인 + 비밀번호 변경 끝남. waiting: 아직 상태를 모름(첫 렌더) */
export function useSyncUser(mode: 'off' | 'optional' | 'required'): { uid: string | null; waiting: boolean } {
  const acct = useAccount();
  return useMemo(() => {
    if (mode === 'off') return { uid: null, waiting: false };
    if (acct.state === 'unknown') return { uid: null, waiting: true };
    if (acct.state !== 'in') return { uid: null, waiting: false };
    return { uid: readAccount(browserKV, acct.userId)?.mustChange === false ? acct.userId : null, waiting: false };
  }, [acct, mode]);
}
