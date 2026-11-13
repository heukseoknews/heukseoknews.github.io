'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { CHANNELS, getChannel } from '../lib/channels';
import { ME_CHANNEL_KEY, meChannels, pickChannel } from '../lib/me';
import { storeFor } from '../lib/storage';
import { DEFAULT_LIST_NAME, liveBookmarks, liveGroups } from '../lib/bookmarks';
import { type ChatArticle, articleDate, articleRefOf } from '../lib/chat';
import { channelColors } from './channelLook';

const LIST = meChannels(CHANNELS.map(c => c.slug));
const SHOW = 60;

/** [기사 첨부] → '내 북마크'에서 한 건 고르기. 이 기기의 계정 사본(로그인 중 동기화되는 북마크)을 읽기만 한다.
 *  고른 기사 한 건의 공개 필드(lib/chat.ts articleRefOf)만 첨부되고, 목록 이름·메모·태그는 어디에도 보내지 않는다. */
export default function ChatAttach({ uid, onPick, onClose }: { uid: string; onPick: (a: ChatArticle) => void; onClose: () => void }) {
  const [slug, setSlug] = useState(() => { let r: string | null = null; try { r = localStorage.getItem(ME_CHANNEL_KEY); } catch { /* 저장소 접근 불가 */ } return pickChannel(null, r, LIST); });
  const [folder, setFolder] = useState('all');
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const data = useMemo(() => {
    const out: Record<string, ReturnType<ReturnType<typeof storeFor>['load']>> = {};
    for (const s of LIST) out[s] = storeFor(uid).load(s, getChannel(s)?.storage?.legacy_keys);
    return out;
  }, [uid]);
  const state = data[slug];
  const lists = useMemo(() => liveGroups(state, 'folders'), [state]);
  const all = useMemo(() => liveBookmarks(state).filter(b => !b.missing).sort((a, b) => b.savedAt.localeCompare(a.savedAt)), [state]);
  const word = q.trim().toLowerCase();
  const rows = all.filter(b => (folder === 'all' || b.lists.includes(folder)) && (!word || b.title.toLowerCase().includes(word)));
  useEffect(() => { box.current?.querySelector<HTMLElement>('button.on, button')?.focus(); }, []);
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };

  return <div className="chatPick" ref={box} role="dialog" aria-label="내 북마크에서 기사 고르기" onKeyDown={onKey}>
    <div className="chatPickHead"><b>내 북마크</b><button type="button" className="iconBtn" aria-label="닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    {LIST.length > 1 && <div className="chatPickCh" role="group" aria-label="채널">{LIST.map(s => {
      const n = liveBookmarks(data[s]).filter(b => !b.missing).length;
      return <button key={s} type="button" className={'meCh' + (s === slug ? ' on' : '')} aria-pressed={s === slug} onClick={() => { setSlug(s); setFolder('all'); }}>{getChannel(s)!.name}<span className="count">{n.toLocaleString()}</span></button>;
    })}</div>}
    <div className="chatPickTools">
      <select aria-label="목록" value={folder} onChange={e => setFolder(e.target.value)}>
        <option value="all">{DEFAULT_LIST_NAME}(전체)</option>
        {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <label className="msSearch"><Search size={15} aria-hidden="true" /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="제목 검색" aria-label="제목 검색" /></label>
    </div>
    {rows.length
      ? <ul className="chatPickList">{rows.slice(0, SHOW).map(b => {
          const ref = articleRefOf(b, slug);
          return <li key={b.id}><button type="button" disabled={!ref} onClick={() => ref && onPick(ref)} style={channelColors(slug)}>
            <span className="pickTitle">{b.title}</span>
            <span className="pickMeta">{[b.source, articleDate(b.published_at)].filter(Boolean).join(' · ')}{!ref && ' · 링크 없음'}</span>
          </button></li>;
        })}{rows.length > SHOW && <li className="msNote">최근 저장한 {SHOW}건만 보입니다. 검색으로 좁혀 주세요.</li>}</ul>
      : <p className="msNone">{all.length ? '맞는 기사가 없습니다.' : '북마크한 기사가 없습니다.'}</p>}
  </div>;
}
