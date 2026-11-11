'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Article } from './news';
import { addRead, pruneReads, removeRead } from './readState';
import { useChannel } from './channelContext';
import { userStateStore } from './storage';
import { EMPTY_STATE, type UserState } from './userState';

export type Saved = UserState;

/** 북마크·읽음·확인시각·선택한 보험사: 채널별 사용자 상태. 저장은 어댑터(lib/storage.ts, 지금은 localStorage)가 맡는다. */
export function useSaved() {
  const ch = useChannel();
  const [saved, setSaved] = useState<Saved>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  useEffect(() => { setSaved(userStateStore.load(ch.slug, ch.storage?.legacy_keys)); setReady(true); }, [ch]);
  const update = useCallback((fn: (s: Saved) => Saved) => {
    setSaved(s => { const n = fn(s); userStateStore.save(ch.slug, n); return n; });
  }, [ch.slug]);
  const toggleBookmark = useCallback((a: Article) => update(s => { const b = { ...s.bookmarks }; if (b[a.id]) delete b[a.id]; else b[a.id] = a; return { ...s, bookmarks: b }; }), [update]);
  const markRead = useCallback((id: string) => update(s => s.readAt[id] ? s : { ...s, readAt: pruneReads(addRead(s.readAt, id, new Date().toISOString()), s.lastConfirmed) }), [update]);
  const unmarkRead = useCallback((id: string) => update(s => ({ ...s, readAt: removeRead(s.readAt, id) })), [update]);
  const setCompanies = useCallback((v: string[]) => update(s => ({ ...s, companies: v })), [update]);
  const readSet = useMemo(() => new Set(Object.keys(saved.readAt)), [saved.readAt]);
  return { saved, ready, update, toggleBookmark, markRead, unmarkRead, setCompanies, readSet };
}
