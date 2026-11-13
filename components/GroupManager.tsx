'use client';
import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { type Group, type GroupKind, KIND_TEXT, LIMITS } from '../lib/bookmarks';

type Props = {
  folders: Group[]; tags: Group[];
  usage: (kind: GroupKind, id: string) => number;
  onCreate: (kind: GroupKind, name: string) => string;
  onRename: (kind: GroupKind, id: string, name: string) => void;
  onDelete: (kind: GroupKind, id: string) => void;
};
const LABEL: Record<GroupKind, string> = { folders: KIND_TEXT.folders.name, tags: KIND_TEXT.tags.name };

/** 목록·태그 관리: 만들기·이름 바꾸기·지우기. 지워도 북마크는 남는다(기본 '북마크'에). 직접 만든 목록은 3개까지(이미 넘으면 만들기만 막음). */
export default function GroupManager({ folders, tags, usage, onCreate, onRename, onDelete }: Props) {
  const [error, setError] = useState('');
  const [names, setNames] = useState<Record<GroupKind, string>>({ folders: '', tags: '' });
  const [editing, setEditing] = useState<{ kind: GroupKind; id: string; name: string } | null>(null);
  const run = (fn: () => void) => { try { fn(); setError(''); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } };
  const create = (kind: GroupKind) => { if (run(() => onCreate(kind, names[kind]))) setNames(n => ({ ...n, [kind]: '' })); };
  const saveRename = () => { if (editing && run(() => onRename(editing.kind, editing.id, editing.name))) setEditing(null); };
  const remove = (kind: GroupKind, g: Group) => {
    const n = usage(kind, g.id);
    if (window.confirm(`${LABEL[kind]} '${g.name}'을(를) 지울까요?${n ? ` 담긴 북마크 ${n}건은 기본 '북마크'에 그대로 남습니다.` : ''}`)) onDelete(kind, g.id);
  };
  const enter = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); fn(); } if (e.key === 'Escape') setEditing(null); };

  const block = (kind: GroupKind, list: Group[]) => <section className="gmBlock" aria-labelledby={`gm-${kind}`}>
    <h3 id={`gm-${kind}`}>{LABEL[kind]} <small>{list.length}/{LIMITS[kind]}</small></h3>
    {list.length === 0 ? <p className="gmEmpty">{KIND_TEXT[kind].i} 없습니다.</p> : <ul>{list.map(g => <li key={g.id}>
      {editing?.kind === kind && editing.id === g.id
        ? <><input type="text" aria-label={`${LABEL[kind]} 이름`} maxLength={LIMITS.groupName} value={editing.name} autoFocus onChange={e => setEditing({ ...editing, name: e.target.value })} onKeyDown={enter(saveRename)} />
          <button type="button" className="iconBtn" aria-label="이름 저장" onClick={saveRename}><Check size={16} aria-hidden="true" /></button>
          <button type="button" className="iconBtn" aria-label="취소" onClick={() => setEditing(null)}><X size={16} aria-hidden="true" /></button></>
        : <><span className="gmName">{kind === 'tags' ? '#' : ''}{g.name}</span><span className="gmCount">{usage(kind, g.id).toLocaleString()}건</span>
          <button type="button" className="iconBtn" aria-label={`${g.name} 이름 바꾸기`} onClick={() => { setEditing({ kind, id: g.id, name: g.name }); setError(''); }}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" className="iconBtn" aria-label={`${g.name} 지우기`} onClick={() => remove(kind, g)}><Trash2 size={15} aria-hidden="true" /></button></>}
    </li>)}</ul>}
    {list.length < LIMITS[kind] && <div className="bmNew">
      <input type="text" aria-label={`새 ${LABEL[kind]} 이름`} placeholder={`새 ${LABEL[kind]}`} maxLength={LIMITS.groupName} value={names[kind]} onChange={e => setNames(n => ({ ...n, [kind]: e.target.value }))} onKeyDown={enter(() => create(kind))} />
      <button type="button" className="readToggle" disabled={!names[kind].trim()} onClick={() => create(kind)}><Plus size={14} aria-hidden="true" /> 만들기</button>
    </div>}
  </section>;

  return <div className="groupManager">
    {block('folders', folders)}
    {block('tags', tags)}
    {error && <p className="bmError" role="alert">{error}</p>}
  </div>;
}
