'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article } from '../lib/news';
import { type Bookmark, isLive, liveGroups } from '../lib/bookmarks';
import type { useSaved } from '../lib/useSaved';
import BookmarkEditor from './BookmarkEditor';

type Api = ReturnType<typeof useSaved>;
type Toast = { kind: 'added'; id: string; n: number } | { kind: 'removed'; prev: Bookmark; n: number };
const TOAST_MS = 5000;

/** 북마크 버튼 공통 흐름: 누르면 저장(스냅샷)하고 짧은 안내에 '정리'(폴더·태그·메모)를, 해제하면 '되돌리기'를 둔다.
 *  onToast: 이 안내가 뜰 때 화면의 다른 안내(읽음 되돌리기)를 닫는 데 쓴다. */
export function useBookmarkFlow(api: Api, onToast?: () => void) {
  const { saved, toggleBookmark, restore, editBookmark, addGroup } = api;
  const [toast, setToast] = useState<Toast | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback((t: Toast) => {
    onToast?.();
    clearTimeout(timer.current);
    setToast(t);
    timer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, [onToast]);
  const clear = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);

  const onBookmark = useCallback((a: Article) => {
    const cur = saved.bookmarks[a.id];
    toggleBookmark(a);
    if (isLive(cur)) show({ kind: 'removed', prev: cur, n: Date.now() });
    else show({ kind: 'added', id: a.id, n: Date.now() });
  }, [saved.bookmarks, toggleBookmark, show]);

  const openEditor = useCallback((id: string) => { clear(); setEditing(id); }, [clear]);
  const editingBm = editing ? saved.bookmarks[editing] : undefined;

  const toastNode = toast && <div className="undoToast" role="status" aria-live="polite" key={toast.n}>
    {toast.kind === 'added'
      ? <><span>북마크에 저장했습니다</span><button type="button" onClick={() => openEditor(toast.id)}>정리</button></>
      : <><span>북마크를 해제했습니다</span><button type="button" onClick={() => { restore(toast.prev); clear(); }}>되돌리기</button></>}
  </div>;

  const editorNode = isLive(editingBm) && <BookmarkEditor key={editingBm.id} bookmark={editingBm}
    folders={liveGroups(saved, 'folders')} tags={liveGroups(saved, 'tags')}
    onCreate={addGroup} onSave={p => editBookmark(editingBm.id, p)} onClose={() => setEditing(null)} />;

  return { onBookmark, openEditor, clearToast: clear, toastNode, editorNode };
}
