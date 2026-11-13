'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Article } from './news';
import { addRead, pruneReads, removeRead } from './readState';
import { addDismissed, pruneDismissed, removeDismissed } from './dismissed';
import { useChannel } from './channelContext';
import { storeFor } from './storage';
import { AUTH_MODE } from './authConfig';
import { useSyncUser } from './useAccount';
import { SYNC_EVENT } from './sync';
import { EMPTY_STATE, type UserState } from './userState';
import { type Bookmark, type BookmarkPatch, type GroupKind, createGroup, deleteGroup, isLive, liveBookmarks, removeBookmark, renameGroup, restoreBookmark, toggleBookmark as toggleBm, updateBookmark } from './bookmarks';

export type Saved = UserState;
const now = () => new Date().toISOString();
/** 사용자 상태를 저장하면 같은 탭에 알린다(마이페이지 채널 탭 건수). 다른 탭은 storage 이벤트. */
export const USER_STATE_EVENT = 'heukseok:user-state';

/** 로그인 중 첫 동기화 응답을 기다리는 최대 시간. 넘으면(서버가 느림) 기기 사본으로 보여 준다 */
const SETTLE_MAX_MS = 6000;

/** 동기화 실행기(로그인을 켠 빌드에서만 처음 쓸 때 불러온다 — 꺼진 빌드의 번들에는 들어가지 않음) */
const manager = (uid: string) => import('./syncManager').then(m => m.syncFor(uid));

/** 북마크·목록·태그·읽음·치운 기사·확인시각·선택한 보험사: 채널별 사용자 상태.
 *  저장: 로그인 전·로그인 꺼진 빌드는 기기 저장(heukseok-v2:<채널>) 그대로, 로그인(비밀번호 변경 끝남) 중에는 계정 사본(…@<사용자 id>)을 읽고 쓰고
 *  서버와는 뒤에서 맞춘다(lib/syncManager.ts). 서버가 멈춰도 화면은 기기 사본으로 그대로 동작한다.
 *  settled: 로그인 중이면 이 채널의 첫 동기화 응답(성공·실패)이 온 뒤, 아니면 ready 와 같다. 새 뉴스 건수·목록은 이것을 기다린다. */
export function useSaved() {
  const ch = useChannel();
  const { uid, waiting } = useSyncUser(AUTH_MODE);   // waiting: 로그인 상태를 알기 전에는 어느 저장소도 읽지 않는다(잘못된 쪽을 잠깐 보이지 않게)
  const store = useMemo(() => storeFor(uid), [uid]);
  const [saved, setSaved] = useState<Saved>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [synced, setSynced] = useState(false);
  useEffect(() => { if (waiting) return; setSaved(store.load(ch.slug, ch.storage?.legacy_keys)); setReady(true); }, [ch, store, waiting]);
  // 다른 탭이 같은 채널 상태를 저장하면 다시 읽는다(옛 상태로 덮어쓰지 않게)
  useEffect(() => {
    if (waiting) return;
    const key = store.key(ch.slug);
    const onStorage = (e: StorageEvent) => { if (e.key === key) setSaved(store.load(ch.slug, ch.storage?.legacy_keys)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ch, store, waiting]);
  // 로그인 중: 화면을 열 때 서버와 맞추고, 서버 내용이 들어오면 다시 읽는다
  useEffect(() => {
    if (!uid) return;
    let off = false, unsub = () => { /* 아직 구독 전 */ };
    setSynced(false);
    const giveUp = window.setTimeout(() => setSynced(true), SETTLE_MAX_MS);
    manager(uid).then(m => {
      if (off) return;
      const check = () => { const st = m.get(ch.slug).state; if (st === 'ok' || st === 'error') setSynced(true); };
      unsub = m.subscribe(check);
      m.start(ch.slug);
    }).catch(e => { setSynced(true); console.error('[sync] load', (e as Error)?.name ?? ''); });
    const onSync = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.userId === uid && d?.channel === ch.slug) { setSaved(store.load(ch.slug, ch.storage?.legacy_keys)); window.dispatchEvent(new Event(USER_STATE_EVENT)); } };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => { off = true; unsub(); clearTimeout(giveUp); window.removeEventListener(SYNC_EVENT, onSync); };
  }, [uid, ch.slug, store]);
  /** 상태 바꾸기. pushNow: 서버에 2초 모으지 않고 바로 올린다('모두 확인') */
  const update = useCallback((fn: (s: Saved) => Saved, opt?: { pushNow?: boolean }) => {
    setSaved(s => {
      const n = fn(s);
      if (n === s) return s;
      const wrote = store.save(ch.slug, n);   // 저장된 확인 시각이 더 늦으면 그 값을 지킨 상태
      setTimeout(() => window.dispatchEvent(new Event(USER_STATE_EVENT)), 0);
      if (uid) manager(uid).then(m => m.changed(ch.slug, opt?.pushNow ? 0 : undefined)).catch(() => { /* 다음 기회에 보낸다(보낼 것 있음은 해시로 판단) */ });
      return wrote;
    });
  }, [ch.slug, store, uid]);
  const toggleBookmark = useCallback((a: Article) => update(s => toggleBm(s, a, ch.slug, now())), [update, ch.slug]);
  const unbookmark = useCallback((id: string) => update(s => removeBookmark(s, id, now())), [update]);
  const restore = useCallback((b: Bookmark) => update(s => restoreBookmark(s, b, now())), [update]);
  const editBookmark = useCallback((id: string, p: BookmarkPatch) => update(s => updateBookmark(s, id, p, now())), [update]);
  /** 목록·태그 만들기. 실패하면 Error(화면 문구)를 던진다. 성공하면 새 id. */
  const addGroup = useCallback((kind: GroupKind, name: string): string => {
    const { id } = createGroup(saved, kind, name, now());  // 검사는 지금 상태로 먼저(오류를 바로 보여 주기 위해)
    update(s => { try { return createGroup(s, kind, name, now(), id).state; } catch { return s; } });
    return id;
  }, [saved, update]);
  const renameGroupFn = useCallback((kind: GroupKind, id: string, name: string) => {
    renameGroup(saved, kind, id, name, now());  // 이름 검사(오류면 던짐)
    update(s => { try { return renameGroup(s, kind, id, name, now()); } catch { return s; } });
  }, [saved, update]);
  const removeGroup = useCallback((kind: GroupKind, id: string) => update(s => deleteGroup(s, kind, id, now())), [update]);
  const markRead = useCallback((id: string) => update(s => s.readAt[id] ? s : { ...s, readAt: pruneReads(addRead(s.readAt, id, now()), s.lastConfirmed) }), [update]);
  const unmarkRead = useCallback((id: string) => update(s => ({ ...s, readAt: removeRead(s.readAt, id) })), [update]);
  // 새 뉴스 탭 '치우기'(읽음과 별개). 같은 사건의 여러 기사를 한 번에 치우고 되돌린다
  const dismiss = useCallback((ids: string[]) => update(s => { const t = now(); const d = addDismissed(s.dismissed, ids, t); return d === s.dismissed ? s : { ...s, dismissed: pruneDismissed(d, t, s.lastConfirmed) }; }), [update]);
  const undismiss = useCallback((ids: string[]) => update(s => { const d = removeDismissed(s.dismissed, ids); return d === s.dismissed ? s : { ...s, dismissed: d }; }), [update]);
  const setCompanies = useCallback((v: string[]) => update(s => ({ ...s, companies: v })), [update]);
  const readSet = useMemo(() => new Set(Object.keys(saved.readAt)), [saved.readAt]);
  const dismissedSet = useMemo(() => new Set(saved.dismissed.map(e => e.id)), [saved.dismissed]);
  const bookmarkList = useMemo(() => liveBookmarks(saved), [saved]);
  const isBookmarked = useCallback((id: string) => isLive(saved.bookmarks[id]), [saved.bookmarks]);
  const settled = ready && (!uid || synced);
  return { saved, ready, settled, update, toggleBookmark, unbookmark, restore, editBookmark, addGroup, renameGroup: renameGroupFn, removeGroup,
    markRead, unmarkRead, dismiss, undismiss, dismissedSet, setCompanies, readSet, bookmarkList, isBookmarked, userId: uid };
}
