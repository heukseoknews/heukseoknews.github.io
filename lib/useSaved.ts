'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Article } from './news';
import { addRead, pruneReads, removeRead } from './readState';
import { useChannel } from './channelContext';
import { userStateStore } from './storage';
import { EMPTY_STATE, type UserState } from './userState';
import { type Bookmark, type BookmarkPatch, type GroupKind, createGroup, deleteGroup, isLive, liveBookmarks, removeBookmark, renameGroup, restoreBookmark, toggleBookmark as toggleBm, updateBookmark } from './bookmarks';

export type Saved = UserState;
const now = () => new Date().toISOString();

/** 북마크·폴더·태그·읽음·확인시각·선택한 보험사: 채널별 사용자 상태. 저장은 어댑터(lib/storage.ts, 지금은 localStorage)가 맡는다. */
export function useSaved() {
  const ch = useChannel();
  const [saved, setSaved] = useState<Saved>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  useEffect(() => { setSaved(userStateStore.load(ch.slug, ch.storage?.legacy_keys)); setReady(true); }, [ch]);
  const update = useCallback((fn: (s: Saved) => Saved) => {
    setSaved(s => { const n = fn(s); if (n !== s) userStateStore.save(ch.slug, n); return n; });
  }, [ch.slug]);
  const toggleBookmark = useCallback((a: Article) => update(s => toggleBm(s, a, ch.slug, now())), [update, ch.slug]);
  const unbookmark = useCallback((id: string) => update(s => removeBookmark(s, id, now())), [update]);
  const restore = useCallback((b: Bookmark) => update(s => restoreBookmark(s, b, now())), [update]);
  const editBookmark = useCallback((id: string, p: BookmarkPatch) => update(s => updateBookmark(s, id, p, now())), [update]);
  /** 폴더·태그 만들기. 실패하면 Error(화면 문구)를 던진다. 성공하면 새 id. */
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
  const setCompanies = useCallback((v: string[]) => update(s => ({ ...s, companies: v })), [update]);
  const readSet = useMemo(() => new Set(Object.keys(saved.readAt)), [saved.readAt]);
  const bookmarkList = useMemo(() => liveBookmarks(saved), [saved]);
  const isBookmarked = useCallback((id: string) => isLive(saved.bookmarks[id]), [saved.bookmarks]);
  return { saved, ready, update, toggleBookmark, unbookmark, restore, editBookmark, addGroup, renameGroup: renameGroupFn, removeGroup,
    markRead, unmarkRead, setCompanies, readSet, bookmarkList, isBookmarked };
}
