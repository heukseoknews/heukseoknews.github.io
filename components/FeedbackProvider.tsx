'use client';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AUTH_MODE } from '../lib/authConfig';
import { useChannel } from '../lib/channelContext';
import { EMPTY_FB, type FbSignal, type FeedbackStore, createFeedbackStore, feedbackEnabled } from '../lib/feedback';
import { useSyncUser } from '../lib/useAccount';

export type FeedbackApi = { signalOf: (id: string) => FbSignal | undefined; press: (id: string, s: FbSignal) => void };
const Ctx = createContext<FeedbackApi | null>(null);
/** 기사 카드가 쓰는 피드백 버튼 상태. 로그아웃·로그인 꺼진 빌드·채널 밖(마이페이지 등)이면 null → 버튼 없음 */
export const useFeedback = () => useContext(Ctx);

const noop = () => () => {};
/** 채널 화면 전체(app/[channel]/layout.tsx)에서 본인 피드백을 한 번에 읽어 두고 카드에 나눠 준다(기사마다 요청하지 않음).
 *  로그인해 비밀번호까지 바꾼 사용자에게만 연결 코드(lib/feedbackBackend.ts)를 불러온다. 실패하면 짧은 안내만 보이고 페이지는 그대로. */
export default function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { slug } = useChannel();
  const { uid } = useSyncUser(AUTH_MODE);
  const on = feedbackEnabled(AUTH_MODE, uid);
  const [store, setStore] = useState<FeedbackStore | null>(null);
  useEffect(() => {
    if (!on || !uid) { setStore(null); return; }
    let alive = true;
    import('../lib/feedbackBackend').then(({ supabaseFeedback }) => {
      if (!alive) return;
      const s = createFeedbackStore(slug, supabaseFeedback(uid));
      setStore(s);
      void s.load();
    }).catch(() => { /* 연결 코드를 못 불러오면 버튼 없이 */ });
    return () => { alive = false; };
  }, [on, uid, slug]);
  const state = useSyncExternalStore(store ? store.subscribe : noop, () => (store ? store.get() : EMPTY_FB), () => EMPTY_FB);
  useEffect(() => {
    if (!state.error || !store) return;
    const t = setTimeout(() => store.clearError(), 4000);
    return () => clearTimeout(t);
  }, [state.error, store]);
  const api = useMemo<FeedbackApi | null>(() => (store && on ? { signalOf: id => state.map[id], press: (id, s) => { void store.press(id, s); } } : null), [store, on, state.map]);
  return <Ctx.Provider value={api}>
    {children}
    {api && state.error && <div className="fbToast" role="status" aria-live="polite">{state.error}</div>}
  </Ctx.Provider>;
}
