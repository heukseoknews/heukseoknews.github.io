'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Article } from './news';
import { ReadMap, addRead, migrateReads, pruneReads, removeRead } from './readState';

const KEY = 'actuary-news-hub-v3';
export type Saved = { bookmarks: Record<string, Article>; lastConfirmed: string | null; readAt: ReadMap };
const EMPTY: Saved = { bookmarks: {}, lastConfirmed: null, readAt: {} };
const read = (): Saved => {
  try {
    const r = localStorage.getItem(KEY);
    if (!r) return EMPTY;
    const j = JSON.parse(r);
    return { bookmarks: j.bookmarks ?? {}, lastConfirmed: j.lastConfirmed ?? null, readAt: migrateReads(j) };  // 예전 readIds 형식도 이전
  } catch { return EMPTY; }
};

/** 북마크·읽음·확인시각: 기기(브라우저)별 localStorage만 사용 */
export function useSaved() {
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [ready, setReady] = useState(false);
  useEffect(() => { setSaved(read()); setReady(true); }, []);
  const update = useCallback((fn: (s: Saved) => Saved) => {
    setSaved(s => { const n = fn(s); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; });
  }, []);
  const toggleBookmark = useCallback((a: Article) => update(s => { const b = { ...s.bookmarks }; if (b[a.id]) delete b[a.id]; else b[a.id] = a; return { ...s, bookmarks: b }; }), [update]);
  const markRead = useCallback((id: string) => update(s => s.readAt[id] ? s : { ...s, readAt: pruneReads(addRead(s.readAt, id, new Date().toISOString()), s.lastConfirmed) }), [update]);
  const unmarkRead = useCallback((id: string) => update(s => ({ ...s, readAt: removeRead(s.readAt, id) })), [update]);
  const readSet = useMemo(() => new Set(Object.keys(saved.readAt)), [saved.readAt]);
  return { saved, ready, update, toggleBookmark, markRead, unmarkRead, readSet };
}
