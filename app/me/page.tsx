'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bookmark as BookmarkIcon, ExternalLink, Filter, FolderClosed, Pencil, RotateCcw, Search, Settings2, SlidersHorizontal, X } from 'lucide-react';
import MultiFilter from '../../components/MultiFilter';
import GroupManager from '../../components/GroupManager';
import { useBookmarkFlow } from '../../components/BookmarkFlow';
import { type Bookmark, type GroupKind, fillMissing, folderOf, liveGroups, tagsOf, toArticle } from '../../lib/bookmarks';
import { channelHref } from '../../lib/channels';
import { useChannel } from '../../lib/channelContext';
import { facetOptions } from '../../lib/facets';
import { isSafeUrl, loadIndex, loadMonth } from '../../lib/news';
import { EMPTY_FILTERS, type MyFilters, PERIODS, type Period, type ReadFilter, type SortKey, activeCount, groupByCategory, matches, sortBookmarks } from '../../lib/myBookmarks';
import { useSaved } from '../../lib/useSaved';

const PAGE = 60;

/** 마이페이지 · 내 북마크: 카테고리 칩 → 검색·필터·정렬 → 폴더·태그 → 카테고리별 목록. 채널은 마이페이지 틀(MeShell)이 정한다. */
export default function MyBookmarksPage() {
  const ch = useChannel();
  const L = ch.filters;
  const api = useSaved();
  const { saved, ready, update, readSet, bookmarkList, markRead, addGroup, renameGroup, removeGroup } = api;
  const flow = useBookmarkFlow(api);
  const [f, setF] = useState<MyFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('saved');
  const [filterOpen, setFilterOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const panel = useRef<HTMLDivElement>(null);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const set = (p: Partial<MyFilters>) => { setF(x => ({ ...x, ...p })); setShown(PAGE); };
  useEffect(() => { if (filterOpen) panel.current?.querySelector<HTMLElement>('button, select, input')?.focus(); }, [filterOpen]);

  // 기사 정보가 없는 옛 북마크: 기사 데이터를 한 번 받아 채운다(못 찾으면 그대로 보존)
  const hasMissing = bookmarkList.some(b => b.missing);
  useEffect(() => {
    if (!hasMissing) return;
    let off = false;
    loadIndex(ch.slug).then(ix => Promise.all(ix.months.map(m => loadMonth(ch.slug, m.month).catch(() => []))))
      .then(ms => { if (!off) update(s => fillMissing(s, ms.flat())); }).catch(e => console.error('fill bookmarks', e));
    return () => { off = true; };
  }, [hasMissing, ch.slug, update]);

  const folders = useMemo(() => liveGroups(saved, 'folders'), [saved]);
  const tags = useMemo(() => liveGroups(saved, 'tags'), [saved]);
  const ctx = useMemo(() => ({ data: saved, read: readSet, now: Date.now() }), [saved, readSet]);
  const rows = useMemo(() => sortBookmarks(bookmarkList.filter(b => matches(b, f, ctx)), sort), [bookmarkList, f, ctx, sort]);
  const without = (skip: Parameters<typeof matches>[3]) => bookmarkList.filter(b => matches(b, f, ctx, skip));
  /* eslint-disable react-hooks/exhaustive-deps */
  const catCounts = useMemo(() => { const m = new Map<string, number>(); for (const b of without('category')) m.set(b.category || '미분류', (m.get(b.category || '미분류') ?? 0) + 1); return m; }, [bookmarkList, f, ctx]);
  const srcOpts = useMemo(() => facetOptions(without('sources'), b => [b.source].filter(Boolean), f.sources), [bookmarkList, f, ctx]);
  const coOpts = useMemo(() => facetOptions(without('companies'), b => b.companies, f.companies, n => ch.companyGroup[n]), [bookmarkList, f, ctx]);
  const orgOpts = useMemo(() => facetOptions(without('orgs'), b => b.orgs, f.orgs, n => ch.orgGroup[n]), [bookmarkList, f, ctx]);
  const folderCounts = useMemo(() => { const m = new Map<string, number>(); for (const b of without('folder')) { const k = folderOf(saved, b)?.id ?? 'none'; m.set(k, (m.get(k) ?? 0) + 1); } return m; }, [bookmarkList, f, ctx]);
  const tagCounts = useMemo(() => { const m = new Map<string, number>(); for (const b of without('tags')) for (const t of b.tags) m.set(t, (m.get(t) ?? 0) + 1); return m; }, [bookmarkList, f, ctx]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const usage = (kind: GroupKind, id: string) => bookmarkList.filter(b => (kind === 'folders' ? b.folderId === id : b.tags.includes(id))).length;
  const cats = ['전체', ...ch.categories.filter(c => catCounts.has(c)), ...[...catCounts.keys()].filter(c => !ch.categories.includes(c))];
  const groups = useMemo(() => groupByCategory(rows.slice(0, shown), f.category === '전체' ? ch.categories : []), [rows, shown, f.category, ch.categories]);
  const panelCount = activeCount(f);
  const anyFilter = panelCount > 0 || f.category !== '전체' || !!f.q.trim() || f.folder !== 'all' || f.tags.length > 0;
  const reset = () => { setF(EMPTY_FILTERS); setShown(PAGE); };
  const onFilterKey = (e: React.KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.sourcePanel')) { setFilterOpen(false); filterBtn.current?.focus(); } };

  const card = (b: Bookmark) => {
    const folder = folderOf(saved, b);
    const tg = tagsOf(saved, b);
    const read = readSet.has(b.id);
    return <article key={b.id} data-bm-id={b.id} className={'article myBm' + (b.missing ? ' missing' : '')}>
      <div className="articleMain">
        <div className="cardTop">
          {!b.missing && <span className={b.source_type === 'press' ? 'pill official' : 'pill'}>{b.category || '미분류'}</span>}
          {folder && <span className="bmFolder"><FolderClosed size={14} aria-hidden="true" />{folder.name}</span>}
        </div>
        <h3 className="cardTitle">{b.missing
          ? <span className="headline">기사 정보를 찾을 수 없음 <small>{b.id}</small></span>
          : isSafeUrl(b.url)
            ? <a className="headline" href={b.url} target="_blank" rel="noopener noreferrer" onClick={() => markRead(b.id)} onAuxClick={e => { if (e.button === 1) markRead(b.id); }}>{b.title}<ExternalLink size={15} aria-hidden="true" /></a>
            : <span className="headline">{b.title} <small>(링크 없음)</small></span>}</h3>
        <div className="meta">
          {b.source && <><span>{b.source}</span><span className="dot" aria-hidden="true">·</span></>}
          {b.published_at && <><time dateTime={b.published_at}>{ch.fmt(b.published_at)}</time><span className="dot" aria-hidden="true">·</span></>}
          <span>저장 {ch.fmtShort(b.savedAt)}</span>
          {read && <><span className="dot" aria-hidden="true">·</span><span className="read">읽음</span></>}
        </div>
        {tg.length > 0 && <div className="bmTagRow">{tg.map(t => <span key={t.id} className="bmTagChip">#{t.name}</span>)}</div>}
        {b.memo && <p className="bmMemo">{b.memo}</p>}
      </div>
      <div className="cardActions">
        <button type="button" className="readBtn" aria-label="정리(폴더·태그·메모)" title="정리" onClick={() => flow.openEditor(b.id)}><Pencil size={18} aria-hidden="true" /></button>
        <button type="button" className="bookmark" aria-label="북마크 해제" aria-pressed="true" onClick={() => flow.onBookmark(toArticle(b))}><BookmarkIcon size={20} className="saved" aria-hidden="true" /></button>
      </div>
    </article>;
  };

  return <>
    <h2 className="srOnly">내 북마크</h2>
    <div className="catOuter"><nav className="categories" aria-label="북마크 카테고리">{cats.map(c =>
      <button key={c} type="button" className={f.category === c ? 'chosen' : ''} aria-pressed={f.category === c} onClick={() => set({ category: c })}>
        {c}{c !== '전체' && <span className="catN">{(catCounts.get(c) ?? 0).toLocaleString()}</span>}</button>)}</nav></div>

    <div className="toolbar">
      <label className="search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="북마크 검색" placeholder="제목·메모 검색" value={f.q} onChange={e => set({ q: e.target.value })} /></label>
      <button ref={filterBtn} type="button" className={'filterToggle' + (panelCount ? ' on' : '')} aria-expanded={filterOpen} aria-controls="me-filter" onClick={() => setFilterOpen(o => !o)}>
        <Filter size={16} aria-hidden="true" /> 필터{panelCount > 0 && <b>{panelCount}</b>}</button>
      <label className="sort"><SlidersHorizontal size={16} aria-hidden="true" /><select aria-label="정렬" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
        <option value="saved">저장순</option><option value="published">발행순</option></select></label>
    </div>
    <div id="me-filter" ref={panel} className="filterPanel" hidden={!filterOpen} role="group" aria-label="필터" onKeyDown={onFilterKey}>
      <MultiFilter label={L.sources} options={srcOpts} selected={f.sources} onChange={v => set({ sources: v })} />
      <MultiFilter label={L.companies} options={coOpts} selected={f.companies} groups={ch.companyGroups} onChange={v => set({ companies: v })} />
      <MultiFilter label={L.orgs} options={orgOpts} selected={f.orgs} groups={ch.orgGroups} onChange={v => set({ orgs: v })} />
      <label className="sort meSelect" title="발행일 기준"><span>기간</span><select aria-label="기간(발행일 기준)" value={f.period} onChange={e => set({ period: e.target.value as Period })}>
        {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className="sort meSelect"><span>읽음</span><select aria-label="읽음 여부" value={f.read} onChange={e => set({ read: e.target.value as ReadFilter })}>
        <option value="all">전체</option><option value="unread">안 읽은 것</option><option value="read">읽은 것</option></select></label>
      <button type="button" className="filterReset" disabled={!panelCount} onClick={() => set({ sources: [], companies: [], orgs: [], period: 'all', read: 'all' })}><RotateCcw size={14} aria-hidden="true" /> 필터 초기화{panelCount > 0 && <b>{panelCount}</b>}</button>
    </div>

    <div className="meGroups">
      <div className="meGroupRow" role="group" aria-label="폴더">
        <span className="meGroupLabel">폴더</span>
        {(['all', 'none'] as const).map(k => <button key={k} type="button" className={'meChip' + (f.folder === k ? ' on' : '')} aria-pressed={f.folder === k} onClick={() => set({ folder: k })}>
          {k === 'all' ? '전체' : '폴더 없음'}{k === 'none' && <span className="catN">{(folderCounts.get('none') ?? 0).toLocaleString()}</span>}</button>)}
        {folders.map(g => <button key={g.id} type="button" className={'meChip' + (f.folder === g.id ? ' on' : '')} aria-pressed={f.folder === g.id} onClick={() => set({ folder: f.folder === g.id ? 'all' : g.id })}>
          <FolderClosed size={14} aria-hidden="true" />{g.name}<span className="catN">{(folderCounts.get(g.id) ?? 0).toLocaleString()}</span></button>)}
      </div>
      {tags.length > 0 && <div className="meGroupRow" role="group" aria-label="태그">
        <span className="meGroupLabel">태그</span>
        {tags.map(g => { const on = f.tags.includes(g.id); return <button key={g.id} type="button" className={'meChip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => set({ tags: on ? f.tags.filter(t => t !== g.id) : [...f.tags, g.id] })}>
          #{g.name}<span className="catN">{(tagCounts.get(g.id) ?? 0).toLocaleString()}</span></button>; })}
      </div>}
      <button type="button" className="readToggle meManage" aria-expanded={manageOpen} aria-controls="me-manage" onClick={() => setManageOpen(o => !o)}><Settings2 size={14} aria-hidden="true" /> 폴더·태그 관리</button>
    </div>
    {manageOpen && <div id="me-manage" className="articles dataPanel">
      <GroupManager folders={folders} tags={tags} usage={usage} onCreate={addGroup} onRename={renameGroup} onDelete={removeGroup} />
    </div>}

    <div className="listHead">
      <h2>{ch.name} 북마크{ready && <small>{rows.length.toLocaleString()}건</small>}</h2>
      {anyFilter && <div className="listActions"><button type="button" className="readToggle" onClick={reset}><X size={13} aria-hidden="true" /> 조건 모두 해제</button></div>}
    </div>
    <section className="articles">{!ready ? <div className="empty">불러오는 중입니다…</div>
      : bookmarkList.length === 0
        ? <div className="empty"><BookmarkIcon size={27} aria-hidden="true" /><b>북마크한 기사가 없습니다.</b><Link className="confirm" href={channelHref(ch.slug)}>{ch.name} 뉴스 보기</Link></div>
        : rows.length === 0
          ? <div className="empty"><b>조건에 맞는 북마크가 없습니다.</b><button type="button" className="confirm" onClick={reset}>조건 모두 해제</button></div>
          : groups.map(g => <Fragment key={g.category}>
            <div className="dayhead">{g.category}<small>· {(f.category === '전체' ? rows.filter(b => (b.category || '미분류') === g.category).length : rows.length).toLocaleString()}건</small></div>
            {g.items.map(card)}
          </Fragment>)}</section>
    {rows.length > shown && <div className="pagination"><button type="button" onClick={() => setShown(n => n + PAGE)}>더 보기 ({(rows.length - shown).toLocaleString()}건 남음)</button></div>}
    {flow.toastNode}{flow.editorNode}
  </>;
}
