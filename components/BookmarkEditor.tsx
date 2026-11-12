'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { type Bookmark, type BookmarkPatch, type Group, type GroupKind, LIMITS } from '../lib/bookmarks';

type Props = {
  bookmark: Bookmark;
  folders: Group[];
  tags: Group[];
  /** 폴더·태그 만들기(실패하면 Error 를 던진다). 새 id 를 돌려준다. */
  onCreate: (kind: GroupKind, name: string) => string;
  onSave: (patch: BookmarkPatch) => void;
  onClose: () => void;
};

const len = (s: string) => [...s].length;

/** 북마크 정리 창: 폴더 하나, 태그 여러 개, 메모(200자). 모달 dialog(포커스 가둠·Esc 닫기는 브라우저 기본). 저장을 눌러야 반영된다. */
export default function BookmarkEditor({ bookmark, folders, tags, onCreate, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [folderId, setFolderId] = useState(bookmark.folderId && folders.some(f => f.id === bookmark.folderId) ? bookmark.folderId : '');
  const [picked, setPicked] = useState<string[]>(bookmark.tags.filter(t => tags.some(g => g.id === t)));
  const [memo, setMemo] = useState(bookmark.memo);
  const [newFolder, setNewFolder] = useState('');
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);

  const create = (kind: GroupKind, name: string, done: (id: string) => void) => {
    try { done(onCreate(kind, name)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const addFolder = () => create('folders', newFolder, id => { setFolderId(id); setNewFolder(''); });
  const addTag = () => {
    if (picked.length >= LIMITS.tagsPerBookmark) { setError(`태그는 북마크 하나에 ${LIMITS.tagsPerBookmark}개까지입니다.`); return; }
    create('tags', newTag, id => { setPicked(p => [...p, id]); setNewTag(''); });
  };
  const toggleTag = (id: string) => {
    if (picked.includes(id)) { setPicked(picked.filter(x => x !== id)); setError(''); return; }
    if (picked.length >= LIMITS.tagsPerBookmark) { setError(`태그는 북마크 하나에 ${LIMITS.tagsPerBookmark}개까지입니다.`); return; }
    setPicked([...picked, id]);
  };
  const save = () => { onSave({ folderId: folderId || null, tags: picked, memo }); onClose(); };
  const enter = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); fn(); } };

  return <dialog ref={ref} className="bmDialog" aria-labelledby={`${uid}-t`} onClose={onClose} onCancel={onClose}>
    <form method="dialog" onSubmit={e => { e.preventDefault(); save(); }}>
      <div className="bmDialogHead">
        <h2 id={`${uid}-t`}>북마크 정리</h2>
        <button type="button" className="iconBtn" aria-label="닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <p className="bmDialogTitle">{bookmark.missing ? '기사 정보를 찾을 수 없음' : bookmark.title}</p>

      <fieldset className="bmField">
        <legend>폴더</legend>
        <select aria-label="폴더" value={folderId} onChange={e => setFolderId(e.target.value)}>
          <option value="">폴더 없음</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {folders.length < LIMITS.folders && <div className="bmNew">
          <input type="text" aria-label="새 폴더 이름" placeholder="새 폴더" maxLength={LIMITS.groupName} value={newFolder} onChange={e => setNewFolder(e.target.value)} onKeyDown={enter(addFolder)} />
          <button type="button" className="readToggle" disabled={!newFolder.trim()} onClick={addFolder}><Plus size={14} aria-hidden="true" /> 만들기</button>
        </div>}
      </fieldset>

      <fieldset className="bmField">
        <legend>태그 <small>{picked.length}/{LIMITS.tagsPerBookmark}</small></legend>
        {tags.length > 0 && <div className="bmTags">{tags.map(t => <label key={t.id} className={'bmTag' + (picked.includes(t.id) ? ' on' : '')}>
          <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggleTag(t.id)} />#{t.name}</label>)}</div>}
        {tags.length < LIMITS.tags && <div className="bmNew">
          <input type="text" aria-label="새 태그 이름" placeholder="새 태그" maxLength={LIMITS.groupName} value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={enter(addTag)} />
          <button type="button" className="readToggle" disabled={!newTag.trim()} onClick={addTag}><Plus size={14} aria-hidden="true" /> 만들기</button>
        </div>}
      </fieldset>

      <div className="bmField">
        <label htmlFor={`${uid}-m`} className="bmLabel">메모 <small>{len(memo)}/{LIMITS.memo}</small></label>
        <textarea id={`${uid}-m`} rows={3} value={memo} onChange={e => setMemo([...e.target.value].slice(0, LIMITS.memo).join(''))} />
      </div>

      {error && <p className="bmError" role="alert">{error}</p>}
      <div className="bmDialogActions">
        <button type="button" className="readToggle" onClick={onClose}>취소</button>
        <button type="submit" className="confirm">저장</button>
      </div>
    </form>
  </dialog>;
}
