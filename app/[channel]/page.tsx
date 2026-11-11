'use client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, Newspaper, Search, ShieldCheck, Clock3, AlertCircle, SlidersHorizontal, Filter, RotateCcw, X } from 'lucide-react';
import ArticleCard from '../../components/ArticleCard';
import DateBar, { DateFilter } from '../../components/DateBar';
import MultiFilter from '../../components/MultiFilter';
import { Article, isRelevant } from '../../lib/news';
import type { TabId } from '../../lib/channels';
import { useChannel } from '../../lib/channelContext';
import { facetOptions, matchesFacet } from '../../lib/facets';
import { type PanelFilters, onTabChange, panelChips, removeChip } from '../../lib/filterState';
import { addDays, countByDate, dayHeading, kstDate, shiftMonth, todayKst } from '../../lib/dates';
import { sourceOptions } from '../../lib/sources';
import { isNewArticle, isUnreadNew, visibleInNewTab } from '../../lib/newsFilter';
import { useNews } from '../../lib/useNews';
import { useSaved } from '../../lib/useSaved';

type Tab = TabId;
const TABS: Tab[] = ['new', 'all', 'press', 'bookmarks'];  // 표시 이름은 채널 channel.json 의 tabs
const PAGE = 50;

export default function Home() {
  const ch = useChannel();
  const { fmt, fmtShort } = ch;
  const L = ch.filters;   // 필터 라벨(언론사/보험사/유관기관)
  const [tab, setTab] = useState<Tab>('new');
  const [category, setCategory] = useState<string>('전체');
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [includeLow, setIncludeLow] = useState(false);       // 관련도 낮은 기사 포함(기본 꺼짐, 탭을 옮겨도 유지)
  const [sort, setSort] = useState<'latest' | 'important'>('latest');
  const [page, setPage] = useState(1);
  // 날짜 필터는 탭별로 보관한다. 전체 뉴스 탭만 처음에 '오늘'(KST)이 눌린 상태이고, '해제'한 선택은 새로고침 전까지 유지된다.
  const [dateFilters, setDateFilters] = useState<Partial<Record<Tab, DateFilter>>>({});
  const today = todayKst();
  const stored = dateFilters[tab];
  const dateFilter: DateFilter = stored !== undefined ? stored : tab === 'all' ? { from: today, to: today } : null;
  const setDateFilter = (f: DateFilter) => setDateFilters(s => ({ ...s, [tab]: f }));
  const [sources, setSources] = useState<string[]>([]);  // 선택한 언론사(비면 전체) — 탭 이동 시 초기화
  const [orgs, setOrgs] = useState<string[]>([]);          // 선택한 유관기관(비면 전체) — 탭 이동 시 초기화, 저장하지 않음
  const [filterOpen, setFilterOpen] = useState(false);     // [필터] 버튼으로 펼치는 패널
  const filterBtn = useRef<HTMLButtonElement>(null);
  const [calMonth, setCalMonth] = useState(todayKst().slice(0, 7));
  const [showRead, setShowRead] = useState(false);            // 새 뉴스 탭: 읽은 기사 다시 보기(기본 숨김)
  const [justRead, setJustRead] = useState<Set<string>>(new Set()); // 방금 읽어 곧 사라질 카드(짧은 페이드 후 제거)
  const timers = useRef<number[]>([]);
  const { saved, ready, update, toggleBookmark, markRead, unmarkRead, setCompanies, readSet } = useSaved();
  const companies = saved.companies;  // 선택한 보험사(비면 전체) — 사용자 상태에 저장(새로고침 후에도 유지)
  // 달력 월의 KST 날짜는 UTC 월 샤드 경계에 걸칠 수 있어 앞뒤 월도 함께 불러온다
  const { index, all, failure, loading, loadingMore } = useNews(ch.slug, search.trim() ? 'all' : [shiftMonth(calMonth, -1), calMonth, shiftMonth(calMonth, 1)]);
  const baseline = saved.lastConfirmed;
  const [undo, setUndo] = useState<{ id: string; n: number } | null>(null); // 읽음 버튼 직후 5초간 '되돌리기'(마지막 한 건만)
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { timers.current.forEach(clearTimeout); clearTimeout(undoTimer.current); }, []);
  // 제목 클릭·휠클릭·Enter 로 읽음 처리. 새 뉴스 탭에서는 클릭 이벤트가 끝난 직후(새 탭 열기가 시작된 뒤)에 카드를 제거한다.
  const handleRead = useCallback((id: string) => {
    markRead(id);
    if (tab !== 'new') return;
    setJustRead(s => new Set(s).add(id));
    timers.current.push(window.setTimeout(() => setJustRead(s => { const n = new Set(s); n.delete(id); return n; }), 250));
  }, [markRead, tab]);

  // 카드의 '읽음' 버튼: 링크를 열었을 때와 같은 읽음 처리(handleRead→markRead)를 재사용하고 되돌리기 안내를 띄운다
  const handleMarkRead = useCallback((id: string) => {
    handleRead(id);
    clearTimeout(undoTimer.current);
    setUndo(u => ({ id, n: (u?.n ?? 0) + 1 }));
    undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
  }, [handleRead]);
  const handleUndo = useCallback(() => {
    if (!undo) return;
    unmarkRead(undo.id);
    clearTimeout(undoTimer.current);
    setUndo(null);
  }, [undo, unmarkRead]);

  const relevantAll = useMemo(() => all.filter(isRelevant), [all]);  // 새 뉴스 건수·이번 주 핵심은 토글과 무관하게 관련 기사만 센다
  // 탭·카테고리·검색·안 읽은 것·관련도 조건을 적용한 기본 목록(최신순/중요도순 정렬 포함). 결과 0건 안내에서 조건 하나를 빼고 다시 계산하기 위해 함수로 둔다.
  const buildBase = (cat: string, searchText: string, unread: boolean, low: boolean): Article[] => {
    let r: Article[] = tab === 'bookmarks' ? Object.values(saved.bookmarks) : low ? all : relevantAll;
    if (tab === 'new') r = r.filter(a => visibleInNewTab(a, { baseline, read: readSet, showRead, justRead }));
    if (tab === 'press') r = r.filter(a => a.source_type === 'press');
    if (cat !== '전체') r = r.filter(a => a.category === cat); // '미분류'는 카테고리 버튼에 없고 '전체'에서만
    if (unread) r = r.filter(a => !readSet.has(a.id));
    const q = searchText.trim().toLowerCase();
    if (q) r = r.filter(a => [a.title, a.source, a.category, ...a.tags, ...(a.companies ?? []), ...(a.orgs ?? [])].join(' ').toLowerCase().includes(q));
    return [...r].sort((a, b) => sort === 'important' ? b.score - a.score || b.published_at.localeCompare(a.published_at) : b.published_at.localeCompare(a.published_at));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => buildBase(category, search, unreadOnly, includeLow), [tab, all, category, search, sort, baseline, saved.bookmarks, unreadOnly, readSet, showRead, justRead, includeLow, relevantAll]);
  const inDate = (a: Article) => !dateFilter || (kstDate(a.published_at) >= dateFilter.from && kstDate(a.published_at) <= dateFilter.to);
  type Skip = 'sources' | 'companies' | 'orgs' | 'date';
  const bySrc = (a: Article) => [a.source], byCo = (a: Article) => a.companies ?? [], byOrg = (a: Article) => a.orgs ?? [];
  // 모든 필터를 AND 로 적용. skip 으로 한 필터만 빼서(드롭다운 건수·'풀면 N건' 안내용) 계산한다.
  const pass = (a: Article, skip?: Skip) => (skip === 'sources' || matchesFacet(a, bySrc, sources)) && (skip === 'companies' || matchesFacet(a, byCo, companies))
    && (skip === 'orgs' || matchesFacet(a, byOrg, orgs)) && (skip === 'date' || inDate(a));
  /* eslint-disable react-hooks/exhaustive-deps */
  const rows = useMemo(() => base.filter(a => pass(a)), [base, dateFilter, sources, companies, orgs]);
  const dayCounts = useMemo(() => countByDate(base.filter(a => pass(a, 'date'))), [base, sources, companies, orgs]); // 달력 표시용(날짜 필터 제외)
  // 드롭다운 건수: 그 필터 자신만 뺀 나머지 조건(탭·날짜·카테고리·검색·안 읽은 것·다른 필터)에 맞춘 값
  const sourceOpts = useMemo(() => sourceOptions(base.filter(a => pass(a, 'sources')), sources), [base, dateFilter, sources, companies, orgs]);
  const companyOpts = useMemo(() => facetOptions(base.filter(a => pass(a, 'companies')), byCo, companies, n => ch.companyGroup[n]), [base, dateFilter, sources, companies, orgs]);
  const orgOpts = useMemo(() => facetOptions(base.filter(a => pass(a, 'orgs')), byOrg, orgs, n => ch.orgGroup[n]), [base, dateFilter, sources, companies, orgs]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const perDay = useMemo(() => countByDate(rows), [rows]);

  // 새 뉴스 건수(탭 배지): 마지막 확인 이후 수집 + 안 읽음. 읽은 기사는 빠진다(방금 읽어 사라지는 중인 카드는 이미 제외).
  const newCount = useMemo(() => relevantAll.filter(a => isUnreadNew(a, baseline, readSet)).length, [relevantAll, baseline, readSet]);
  const hiddenReadCount = useMemo(() => relevantAll.filter(a => isNewArticle(a, baseline) && readSet.has(a.id) && !justRead.has(a.id)).length, [relevantAll, baseline, readSet, justRead]);
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE));
  const curPage = Math.min(page, lastPage);  // 읽은 기사가 빠져 페이지 수가 줄어도 범위를 벗어나지 않게
  const pageRows = rows.slice((curPage - 1) * PAGE, curPage * PAGE);
  const listReady = ready && (tab === 'bookmarks' || !loading);
  const markDone = () => { update(s => ({ ...s, lastConfirmed: new Date().toISOString() })); setPage(1); };

  // 켜진 필터 목록: 배지 개수·'필터 초기화'·결과 0건 안내에 쓴다. hint = 그 필터만 풀었을 때 건수(조합 때문에 비었는지 알려 줌)
  const defaultDate: DateFilter = tab === 'all' ? { from: today, to: today } : null;
  const dateChanged = JSON.stringify(dateFilter) !== JSON.stringify(defaultDate);
  const emptyNow = !loading && rows.length === 0;  // 0건일 때만 '풀면 N건'을 계산한다(평소엔 비용 없음)
  const countWithout = (skip: Skip) => emptyNow ? base.filter(a => pass(a, skip)).length : undefined;
  const countBase = (cat: string, q: string, unread: boolean, low: boolean) => emptyNow ? buildBase(cat, q, unread, low).filter(a => pass(a)).length : undefined;
  type Active = { key: string; label: string; clear: () => void; hint?: number };
  const active: Active[] = [
    category !== '전체' && { key: 'category', label: `카테고리: ${category}`, clear: () => setCategory('전체'), hint: countBase('전체', search, unreadOnly, includeLow) },
    search.trim() && { key: 'search', label: `검색: ${search.trim()}`, clear: () => setSearch(''), hint: countBase(category, '', unreadOnly, includeLow) },
    sources.length > 0 && { key: 'sources', label: `${L.sources} ${sources.length}곳`, clear: () => setSources([]), hint: countWithout('sources') },
    companies.length > 0 && { key: 'companies', label: `${L.companies} ${companies.length}곳`, clear: () => setCompanies([]), hint: countWithout('companies') },
    orgs.length > 0 && { key: 'orgs', label: `${L.orgs} ${orgs.length}곳`, clear: () => setOrgs([]), hint: countWithout('orgs') },
    dateChanged && { key: 'date', label: `날짜: ${dateFilter ? (dateFilter.from === dateFilter.to ? dayHeading(dateFilter.from) : `${dayHeading(dateFilter.from)} ~ ${dayHeading(dateFilter.to)}`) : '전체'}`, clear: () => setDateFilters(s => { const n = { ...s }; delete n[tab]; return n; }), hint: countWithout('date') },
    unreadOnly && { key: 'unread', label: '안 읽은 것만', clear: () => setUnreadOnly(false), hint: countBase(category, search, false, includeLow) },
    includeLow && tab !== 'bookmarks' && { key: 'low', label: '관련도 낮은 기사 포함', clear: () => setIncludeLow(false) },
  ].filter(Boolean) as Active[];
  const activeCount = active.length;
  // 필터 패널(언론사·보험사·유관기관·체크 2개): 켜진 것은 칩으로, 칩에서 바로 해제(lib/filterState.ts)
  const panel: PanelFilters = { sources, companies, orgs, unreadOnly, includeLow };
  const setPanel = (n: PanelFilters) => {
    setSources(n.sources); setOrgs(n.orgs); setUnreadOnly(n.unreadOnly); setIncludeLow(n.includeLow);
    if (n.companies !== companies) setCompanies(n.companies);  // 보험사는 사용자 상태에 저장되므로 바뀔 때만
    setPage(1);
  };
  const chips = panelChips(panel, L, tab);
  // Esc: 패널 안 드롭다운이 열려 있으면 드롭다운만(MultiFilter 가 닫음), 아니면 패널을 닫고 [필터] 버튼으로 포커스
  const onFilterKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !filterOpen || document.querySelector('#filterPanel .sourcePanel')) return;
    setFilterOpen(false); filterBtn.current?.focus();
  };
  const resetFilters = () => {
    setCategory('전체'); setSearch(''); setSources([]); setOrgs([]); setCompanies([]); setUnreadOnly(false); setIncludeLow(false);
    setDateFilters(s => { const n = { ...s }; delete n[tab]; return n; }); setPage(1);
  };

  return <>
    <h1 className="srOnly">{ch.name} 뉴스</h1>
    <nav className="primary" aria-label="뉴스 보기">{TABS.map(t =>
      <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setCategory('전체'); setPanel(onTabChange(panel)); }}>
        {t === 'new' ? <Clock3 size={16} /> : t === 'press' ? <ShieldCheck size={16} /> : t === 'bookmarks' ? <Bookmark size={16} /> : <Newspaper size={16} />} {ch.tabs[t]}{t === 'new' && ready && !loading && <span className="count" aria-label={`안 읽은 새 뉴스 ${newCount}건`}>{newCount.toLocaleString()}</span>}
      </button>)}</nav>
    <div className="catOuter"><nav className="categories" aria-label="뉴스 카테고리">{['전체', ...ch.categories].map(c =>
      <button key={c} className={category === c ? 'chosen' : ''} onClick={() => { setCategory(c); setPage(1); }}>{c}</button>)}</nav></div>
    <div className="toolbar" onKeyDown={onFilterKey}>
      <div className="search"><Search size={16} /><input aria-label="뉴스 검색" placeholder={`기사 제목·${L.sources}·${L.companies} 검색`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      <button ref={filterBtn} type="button" className={'filterToggle' + (chips.length ? ' on' : '')} aria-expanded={filterOpen} aria-controls="filterPanel" onClick={() => setFilterOpen(o => !o)}><Filter size={15} aria-hidden="true" /> 필터{chips.length > 0 && <b aria-label={`켜진 필터 ${chips.length}개`}>{chips.length}</b>}</button>
      <label className="sort"><SlidersHorizontal size={15} /><select value={sort} onChange={e => { setSort(e.target.value as 'latest' | 'important'); setPage(1); }}><option value="latest">최신순</option><option value="important">중요도순</option></select></label>
    </div>
    <div id="filterPanel" className="filterPanel" role="group" aria-label="필터" hidden={!filterOpen} onKeyDown={onFilterKey}>
        <MultiFilter label={L.sources} options={sourceOpts} selected={sources} onChange={v => { setSources(v); setPage(1); }} />
        <MultiFilter label={L.companies} options={companyOpts} selected={companies} groups={ch.companyGroups} persistNote="다음 방문에도 유지됩니다." onChange={v => { setCompanies(v); setPage(1); }} />
        <MultiFilter label={L.orgs} options={orgOpts} selected={orgs} groups={ch.orgGroups} onChange={v => { setOrgs(v); setPage(1); }} />
        <label className="check" title="열어 본 기사는 읽음으로 표시됩니다."><input type="checkbox" checked={unreadOnly} onChange={e => { setUnreadOnly(e.target.checked); setPage(1); }} /> 안 읽은 것만</label>
        {tab !== 'bookmarks' && <label className="check" title="시장 속보·타 업종 기사 등"><input type="checkbox" checked={includeLow} onChange={e => { setIncludeLow(e.target.checked); setPage(1); }} /> 관련도 낮은 기사 포함</label>}
      <button type="button" className="filterReset" disabled={!activeCount} onClick={resetFilters}><RotateCcw size={14} aria-hidden="true" /> 필터 초기화{activeCount > 0 && <b>{activeCount}</b>}</button>
    </div>
    {chips.length > 0 && <div className="filterChips" role="group" aria-label="켜진 필터">
      {chips.map(c => <span key={c.key} className="chip">{c.kindLabel && <span className="chipKind">{c.kindLabel}</span>}{c.label}<button type="button" aria-label={`${c.kindLabel ? c.kindLabel + ' ' : ''}${c.label} 해제`} onClick={() => setPanel(removeChip(panel, c))}><X size={13} aria-hidden="true" /></button></span>)}
      <button type="button" className="chipClear" onClick={resetFilters}>필터 초기화</button>
    </div>}
    <DateBar filter={dateFilter} onChange={f => { setDateFilter(f); setPage(1); }} counts={dayCounts} month={calMonth} onMonth={setCalMonth} />
    {/* 목록 머리: 탭 이름·건수, 새 뉴스 탭은 읽은 기사 보기·마지막 확인·모두 확인. 불러오기 전에는 건수·확인 정보를 비워 둔다(정적 HTML 에 0건이 찍히지 않게). */}
    <div className="listHead">
      <h2>{ch.tabs[tab]}{listReady && <small>{rows.length.toLocaleString()}건</small>}</h2>
      {loadingMore && <span className="listNote">과거 기사 불러오는 중…</span>}
      {tab === 'new' && listReady && <div className="listActions">
        {(hiddenReadCount > 0 || showRead) && <button type="button" className="readToggle" aria-pressed={showRead} onClick={() => { setShowRead(v => !v); setPage(1); }}>{showRead ? '읽은 기사 숨기기' : `읽은 기사 ${hiddenReadCount.toLocaleString()}건 보기`}</button>}
        {baseline && <span className="lastConfirm" title={`마지막 확인 ${fmt(baseline)}`}>마지막 확인 {fmtShort(baseline)}</span>}
        <button type="button" className="confirm" onClick={markDone}><Check size={15} aria-hidden="true" /> 모두 확인</button>
      </div>}
    </div>
    {failure && <div className="error"><AlertCircle size={17} /> {failure}</div>}
    <section className="articles">{!ready || (loading && tab !== 'bookmarks') ? <div className="empty">뉴스를 불러오는 중입니다…</div> : pageRows.length === 0
      ? (active.length
        ? <div className="empty"><Newspaper size={27} /><b>조건에 맞는 기사가 없습니다</b><p>필터를 하나씩 해제해 보세요.</p>
            <ul className="emptyFilters">{active.map(f => <li key={f.key} className={f.hint ? 'fix' : ''}><span>{f.label}</span>{f.hint !== undefined && <small>{f.hint > 0 ? `해제하면 ${f.hint.toLocaleString()}건` : '해제해도 0건'}</small>}<button type="button" onClick={() => { f.clear(); setPage(1); }}><X size={13} aria-hidden="true" /> 해제</button></li>)}</ul>
            <button type="button" className="confirm" onClick={resetFilters}>필터 초기화</button></div>
        : tab === 'all' && dateFilter && dateFilter.from === today && dateFilter.to === today
        ? <div className="empty"><Newspaper size={27} /><b>오늘 올라온 기사가 아직 없습니다</b><p>매일 아침 갱신됩니다.</p><button type="button" className="confirm" onClick={() => { const y = addDays(today, -1); setDateFilter({ from: y, to: y }); setCalMonth(y.slice(0, 7)); setPage(1); }}>어제 보기</button></div>
        : <div className="empty"><Newspaper size={27} /><b>{tab === 'new' ? '새 기사가 없습니다.' : tab === 'bookmarks' ? '북마크한 기사가 없습니다.' : '기사가 없습니다.'}</b></div>)
      : pageRows.map((a, i) => { const d = kstDate(a.published_at); const head = sort === 'latest' && (i === 0 || d !== kstDate(pageRows[i - 1].published_at));
        return <Fragment key={a.id}>{head && <div className="dayhead">{dayHeading(d)}<small>· {perDay[d]}건</small></div>}
          <ArticleCard a={a} baseline={baseline} bookmarked={!!saved.bookmarks[a.id]} read={readSet.has(a.id)} dim={tab === 'new' || tab === 'all'} fading={justRead.has(a.id)} onBookmark={toggleBookmark} onRead={handleRead} onUnread={tab === 'new' && showRead ? unmarkRead : undefined} onMarkRead={tab === 'new' ? handleMarkRead : undefined} /></Fragment>; })}</section>
    {rows.length > PAGE && <div className="pagination"><button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {lastPage} 페이지</span><button disabled={curPage >= lastPage} onClick={() => setPage(curPage + 1)}>다음</button></div>}
    {undo && <div className="undoToast" role="status" aria-live="polite"><span>읽음 처리했습니다</span><button type="button" onClick={handleUndo}>되돌리기</button></div>}
  </>;
}
