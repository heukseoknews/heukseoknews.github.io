'use client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, Newspaper, Search, ShieldCheck, Clock3, AlertCircle, SlidersHorizontal, Filter, RotateCcw, X } from 'lucide-react';
import ArticleCard, { type CardGroup } from '../../components/ArticleCard';
import { clusterIndex, collapse, countLabel, single, sortItems } from '../../lib/clusters';
import { stars } from '../../lib/stars';
import { EMPTY_TEXT, emptyKind } from '../../lib/emptyState';
import DateBar, { DateFilter } from '../../components/DateBar';
import MultiFilter from '../../components/MultiFilter';
import { Article, isRelevant } from '../../lib/news';
import type { TabId } from '../../lib/channels';
import { useChannel } from '../../lib/channelContext';
import { facetOptions, matchesFacet } from '../../lib/facets';
import { type PanelFilters, badgeCount, dateChip, dateChipLabel, dateState, defaultDate, onTabChange, panelChips, removeChip } from '../../lib/filterState';
import { addDays, countByDate, dayHeading, kstDate, shiftMonth, todayKst } from '../../lib/dates';
import { dataBounds, monthsBetween, nextOlder } from '../../lib/datePick';
import { sourceOptions } from '../../lib/sources';
import { isNewArticle, isPendingNew, visibleInNewTab } from '../../lib/newsFilter';
import { useNews } from '../../lib/useNews';
import { useSaved } from '../../lib/useSaved';
import { fillMissing, toArticle } from '../../lib/bookmarks';
import { useBookmarkFlow } from '../../components/BookmarkFlow';

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
  // 기간은 탭별로 보관한다(다른 필터와 같이 화면 상태 — 새로고침하면 기본으로). 기본은 모든 탭이 '기간 제한 없음'.
  const [dateFilters, setDateFilters] = useState<Partial<Record<Tab, DateFilter>>>({});
  const today = todayKst();
  const stored = dateFilters[tab];
  const dateFilter: DateFilter = stored !== undefined ? stored : defaultDate(tab, today);  // 기본: 기간 제한 없음(null)
  const setDateFilter = (f: DateFilter) => setDateFilters(s => ({ ...s, [tab]: f }));
  const [sources, setSources] = useState<string[]>([]);  // 선택한 언론사(비면 전체) — 탭 이동 시 초기화
  const [orgs, setOrgs] = useState<string[]>([]);          // 선택한 유관기관(비면 전체) — 탭 이동 시 초기화, 저장하지 않음
  const [filterOpen, setFilterOpen] = useState(false);     // [필터] 버튼으로 펼치는 패널
  const filterBtn = useRef<HTMLButtonElement>(null);
  const filterPanel = useRef<HTMLDivElement>(null);
  // 패널을 열면 첫 항목(언론사)으로 포커스. 닫을 때(Esc)는 onFilterKey 가 [필터] 버튼으로 돌려보낸다
  useEffect(() => { if (filterOpen) filterPanel.current?.querySelector<HTMLElement>('button, input')?.focus(); }, [filterOpen]);
  const [calMonth, setCalMonth] = useState(todayKst().slice(0, 7));
  const [includeDismissed, setIncludeDismissed] = useState(false); // 새 뉴스 탭: 치운 기사 포함(기본 꺼짐 = 숨김)
  const [leaving, setLeaving] = useState<Set<string>>(new Set());    // 방금 치워 곧 사라질 카드(짧은 페이드 후 제거)
  const timers = useRef<number[]>([]);
  const savedApi = useSaved();
  const { saved, ready, update, markRead, dismiss, undismiss, dismissedSet, setCompanies, readSet, bookmarkList, isBookmarked } = savedApi;
  // 기사 정보가 없는 옛 북마크(v1 이전분)는 기사 데이터를 불러오면 채운다. 채우기 전에는 북마크 탭에서 빼고 마이페이지에서만 보인다
  const bookmarkArticles = useMemo(() => bookmarkList.filter(b => !b.missing).map(toArticle), [bookmarkList]);
  const companies = saved.companies;  // 선택한 보험사(비면 전체) — 사용자 상태에 저장(새로고침 후에도 유지)
  // 불러올 월: 최근 2개월(useNews 기본) + 달력이 보는 달과 앞뒤 달(KST/UTC 월 경계) + 고른 기간에 걸친 달 + '기간 제한 없음'일 때 과거 달을 최근부터 순서대로(older 개).
  // 검색은 전체 월. 과거 달은 합계 3MB 안이면 자동으로, 넘으면 목록 끝 페이지에 닿을 때 한 달씩(lib/datePick.ts nextOlder).
  const [older, setOlder] = useState(0);
  const [indexMonths, setIndexMonths] = useState<{ month: string; bytes: number }[]>([]);
  const extraMonths = [shiftMonth(calMonth, -1), calMonth, shiftMonth(calMonth, 1), ...(dateFilter ? monthsBetween(dateFilter) : []), ...indexMonths.slice(2, 2 + older).map(m => m.month)];
  const { index, all, loaded, failure, loading, loadingMore } = useNews(ch.slug, search.trim() ? 'all' : extraMonths);
  useEffect(() => { if (index) setIndexMonths(index.months); }, [index]);
  const baseline = saved.lastConfirmed;
  useEffect(() => { if (all.length && bookmarkList.some(b => b.missing)) update(s => fillMissing(s, all)); }, [all, bookmarkList, update]);
  const [undo, setUndo] = useState<{ ids: string[]; n: number } | null>(null); // 치우기 직후 5초간 '되돌리기'(마지막 한 번만)
  // 새 뉴스 탭에서 카드 하나 = 사건 하나: 카드를 치우면 같은 사건의 아직 치우지 않은 새 기사도 함께 치운다(되돌리기는 치운 것 전부). 아래 목록 계산 뒤에 채움
  const eventIds = useRef<(id: string, dismissed: boolean) => string[]>(id => [id]);
  const undoTimer = useRef<number | undefined>(undefined);
  // 북마크: 저장하면 '정리'(폴더·태그·메모), 해제하면 '되돌리기' 안내. 안내는 한 번에 하나만(치우기 안내와 서로 닫음)
  const closeReadUndo = useCallback(() => { clearTimeout(undoTimer.current); setUndo(null); }, []);
  const bmFlow = useBookmarkFlow(savedApi, closeReadUndo);
  useEffect(() => () => { timers.current.forEach(clearTimeout); clearTimeout(undoTimer.current); }, []);
  // 제목 클릭·휠클릭·Enter: 읽음 표시만(제목이 흐려짐). 목록에서 치우지 않으므로 읽은 뒤에도 북마크할 수 있다.
  const handleRead = markRead;

  // 카드의 [치우기](새 뉴스 탭): 짧게 흐려진 뒤 목록에서 빠지고 '치웠습니다 [되돌리기]' 안내. 북마크·읽음과는 별개.
  // 키보드로 치웠으면 카드가 빠진 뒤 다음 카드의 [치우기]로(마지막이면 앞 카드로) 포커스를 옮겨 이어서 쓸 수 있게 한다.
  const handleDismiss = useCallback((id: string) => {
    const ids = eventIds.current(id, false);
    const card = document.querySelector<HTMLElement>(`article[data-bm-id="${CSS.escape(id)}"]`);
    const hadFocus = !!card && card.contains(document.activeElement);
    const near = (card?.nextElementSibling?.matches('.dayhead') ? card.nextElementSibling.nextElementSibling : card?.nextElementSibling) as HTMLElement | null;
    const prev = (card?.previousElementSibling?.matches('.dayhead') ? card.previousElementSibling.previousElementSibling : card?.previousElementSibling) as HTMLElement | null;
    const nextId = (near?.matches('article') ? near : prev?.matches('article') ? prev : null)?.dataset.bmId;
    dismiss(ids);
    setLeaving(s => { const n = new Set(s); ids.forEach(x => n.add(x)); return n; });
    timers.current.push(window.setTimeout(() => {
      setLeaving(s => { const n = new Set(s); ids.forEach(x => n.delete(x)); return n; });
      if (hadFocus && nextId) requestAnimationFrame(() => document.querySelector<HTMLElement>(`article[data-bm-id="${CSS.escape(nextId)}"] .dismissBtn`)?.focus());
    }, 250));
    bmFlow.clearToast();
    clearTimeout(undoTimer.current);
    setUndo(u => ({ ids, n: (u?.n ?? 0) + 1 }));
    undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
  }, [dismiss, bmFlow.clearToast]);
  const handleUndo = useCallback(() => {
    if (!undo) return;
    undismiss(undo.ids);
    clearTimeout(undoTimer.current);
    setUndo(null);
  }, [undo, undismiss]);
  // '치운 기사 포함'에서 흐린 카드의 [되돌리기]: 같은 사건의 치운 기사를 함께 되살린다
  const handleRestore = useCallback((id: string) => undismiss(eventIds.current(id, true)), [undismiss]);

  const relevantAll = useMemo(() => all.filter(isRelevant), [all]);  // 새 뉴스 건수·이번 주 핵심은 토글과 무관하게 관련 기사만 센다
  // 탭·카테고리·검색·안 읽은 것·관련도 조건을 적용한 기본 목록(최신순/중요도순 정렬 포함). 결과 0건 안내에서 조건 하나를 빼고 다시 계산하기 위해 함수로 둔다.
  const buildBase = (cat: string, searchText: string, unread: boolean, low: boolean): Article[] => {
    let r: Article[] = tab === 'bookmarks' ? bookmarkArticles : low ? all : relevantAll;
    if (tab === 'new') r = r.filter(a => visibleInNewTab(a, { baseline, dismissed: dismissedSet, includeDismissed, leaving }));
    if (tab === 'press') r = r.filter(a => a.source_type === 'press');
    if (cat !== '전체') r = r.filter(a => a.category === cat); // '미분류'는 카테고리 버튼에 없고 '전체'에서만
    if (unread) r = r.filter(a => !readSet.has(a.id));
    const q = searchText.trim().toLowerCase();
    if (q) r = r.filter(a => [a.title, a.source, a.category, ...a.tags, ...(a.companies ?? []), ...(a.orgs ?? [])].join(' ').toLowerCase().includes(q));
    return [...r].sort((a, b) => sort === 'important' ? stars(b) - stars(a) || b.published_at.localeCompare(a.published_at) : b.published_at.localeCompare(a.published_at));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => buildBase(category, search, unreadOnly, includeLow), [tab, all, category, search, sort, baseline, bookmarkArticles, unreadOnly, readSet, dismissedSet, includeDismissed, leaving, includeLow, relevantAll]);
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
  // 같은 사건 묶음: 탭·관련도 조건만 적용한 기사(pool)에서 묶음을 찾고, 필터·검색에 맞은 기사(rows)가 하나라도 있는 묶음을 대표 카드 하나로 보인다.
  // 북마크 탭은 묶지 않는다(저장한 기사 그대로). 건수: 카드 수(items)와 기사 수(rows)를 함께 보인다.
  const pool = useMemo(() => {
    let r = includeLow ? all : relevantAll;
    if (tab === 'new') r = r.filter(a => visibleInNewTab(a, { baseline, dismissed: dismissedSet, includeDismissed, leaving }));
    if (tab === 'press') r = r.filter(a => a.source_type === 'press');
    return r;
  }, [tab, all, relevantAll, includeLow, baseline, dismissedSet, includeDismissed, leaving]);
  const clusterIdx = useMemo(() => clusterIndex(pool), [pool]);
  const items = useMemo(() => tab === 'bookmarks' ? single(rows) : sortItems(collapse(rows, clusterIdx), sort), [tab, rows, clusterIdx, sort]);
  eventIds.current = (id: string, dismissed: boolean) => {   // dismissed=false: 치울 것(아직 안 치운 새 기사), true: 되돌릴 것(치운 기사)
    const a = pool.find(x => x.id === id);
    const members = a?.cluster_id ? clusterIdx.get(a.cluster_id) ?? [] : [];
    return [id, ...members.filter(m => m.id !== id && isNewArticle(m, baseline) && dismissedSet.has(m.id) === dismissed).map(m => m.id)];
  };
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());  // 펼친 묶음(이번 방문 동안만, 기본 접힘)
  const toggleGroup = useCallback((cid: string) => setOpenGroups(s => { const n = new Set(s); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; }), []);
  const perDay = useMemo(() => countByDate(items.map(it => it.lead)), [items]);

  // 새 뉴스 건수(탭 배지): 마지막 확인 이후 수집 + 치우지 않음(읽기만 한 기사는 남는다). 사건 단위(같은 사건 묶음은 1건), 묶음이 없는 채널은 기사 수와 같다
  const newCount = useMemo(() => { const seen = new Set<string>(); for (const a of relevantAll) if (isPendingNew(a, baseline, dismissedSet)) seen.add(a.cluster_id ?? a.id); return seen.size; }, [relevantAll, baseline, dismissedSet]);
  const lastPage = Math.max(1, Math.ceil(items.length / PAGE));
  const curPage = Math.min(page, lastPage);  // 치운 기사가 빠져 페이지 수가 줄어도 범위를 벗어나지 않게
  // '전체 뉴스'·기간 제한 없음: 과거 달을 한 달씩 이어서 불러온다(앞 달을 다 받은 뒤 다음 달)
  useEffect(() => {
    if (tab !== 'all' || dateFilter || search.trim() || loading || loadingMore || !indexMonths.length) return;
    const n = nextOlder(indexMonths, older, curPage >= lastPage);
    if (n !== older) setOlder(n);
  }, [tab, dateFilter, search, loading, loadingMore, indexMonths, older, curPage, lastPage]);
  // 달력: 데이터가 있는 날짜 범위(첫 기사~마지막 기사) 밖은 누를 수 없다
  const bounds = useMemo(() => dataBounds(all, indexMonths.map(m => m.month), loaded, today), [all, indexMonths, loaded, today]);
  const pageItems = items.slice((curPage - 1) * PAGE, curPage * PAGE);
  const listReady = ready && (tab === 'bookmarks' || !loading);
  const markDone = () => { update(s => ({ ...s, lastConfirmed: new Date().toISOString() })); setPage(1); };

  // 켜진 필터 목록: 필터 배지 개수·'필터 초기화'·빈 화면 판단에 쓴다
  const dState = dateState(dateFilter, tab, today);  // 기본 날짜(최근 3일)는 배지·초기화 숫자·빈 화면 판단에서 필터로 세지 않는다
  type Active = { key: string; label: string; clear: () => void };
  const active: Active[] = [
    category !== '전체' && { key: 'category', label: `카테고리: ${category}`, clear: () => setCategory('전체') },
    search.trim() && { key: 'search', label: `검색: ${search.trim()}`, clear: () => setSearch('') },
    sources.length > 0 && { key: 'sources', label: `${L.sources} ${sources.length}곳`, clear: () => setSources([]) },
    companies.length > 0 && { key: 'companies', label: `${L.companies} ${companies.length}곳`, clear: () => setCompanies([]) },
    orgs.length > 0 && { key: 'orgs', label: `${L.orgs} ${orgs.length}곳`, clear: () => setOrgs([]) },
    dState !== 'default' && dateFilter && { key: 'date', label: `기간: ${dateChipLabel(dateFilter, today)}`, clear: () => setDateFilter(null) },
    unreadOnly && { key: 'unread', label: '안 읽은 것만', clear: () => setUnreadOnly(false) },
    includeLow && tab !== 'bookmarks' && { key: 'low', label: '관련도 낮은 기사 포함', clear: () => setIncludeLow(false) },
    includeDismissed && tab === 'new' && { key: 'dismissed', label: '치운 기사 포함', clear: () => setIncludeDismissed(false) },
  ].filter(Boolean) as Active[];
  const activeCount = active.length;
  const filtering = active.length > 0 || !!dateFilter;  // 필터·검색·날짜가 걸려 있으면 펼친 묶음에서 맞은 기사를 구분해 보인다
  // 빈 화면: 필터·검색이 있으면 한 줄 + [필터 초기화], 없으면 원인별 한 줄(lib/emptyState.ts)
  // 기본은 기간 제한 없음이라 숨은 날짜 조건이 없다. '오늘'을 직접 고르고 0건이면 + [어제 보기]
  const empty = emptyKind({ filtered: active.some(f => f.key !== 'date'), date: dState, tab, channelArticles: all.length });
  // 필터 패널(언론사·보험사·유관기관·체크 2개, 새 뉴스 탭은 '치운 기사 포함'까지 3개): 켜진 것은 칩으로, 칩에서 바로 해제(lib/filterState.ts)
  const panel: PanelFilters = { sources, companies, orgs, unreadOnly, includeLow, includeDismissed };
  const setPanel = (n: PanelFilters) => {
    setSources(n.sources); setOrgs(n.orgs); setUnreadOnly(n.unreadOnly); setIncludeLow(n.includeLow); setIncludeDismissed(!!n.includeDismissed);
    if (n.companies !== companies) setCompanies(n.companies);  // 보험사는 사용자 상태에 저장되므로 바뀔 때만
    setPage(1);
  };
  const dChip = dateChip(dateFilter, today, tab);
  const chips = [...(dChip ? [dChip] : []), ...panelChips(panel, L, tab)];  // 기간 칩 맨 앞(기간을 골랐을 때만)
  const filterBadge = badgeCount(chips, dState);  // 필터 버튼 배지: 기간을 고르면 1
  // Esc: 패널 안 드롭다운이 열려 있으면 드롭다운만(MultiFilter 가 닫음), 아니면 패널을 닫고 [필터] 버튼으로 포커스
  const onFilterKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !filterOpen || document.querySelector('#filterPanel .sourcePanel')) return;
    setFilterOpen(false); filterBtn.current?.focus();
  };
  const resetFilters = () => {
    setCategory('전체'); setSearch(''); setSources([]); setOrgs([]); setCompanies([]); setUnreadOnly(false); setIncludeLow(false); setIncludeDismissed(false);
    setDateFilters(s => { const n = { ...s }; delete n[tab]; return n; }); setPage(1);
  };

  return <>
    <h1 className="srOnly">{ch.name} 뉴스</h1>
    <nav className="primary" aria-label="뉴스 보기">{TABS.map(t =>
      <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setCategory('전체'); setPanel(onTabChange(panel)); }}>
        {t === 'new' ? <Clock3 size={16} /> : t === 'press' ? <ShieldCheck size={16} /> : t === 'bookmarks' ? <Bookmark size={16} /> : <Newspaper size={16} />} {ch.tabs[t]}{t === 'new' && (ready && !loading
          ? <span className="count" aria-label={`새 뉴스 ${newCount}건`}>{newCount.toLocaleString()}</span>
          : <span className="count pending" aria-hidden="true" />)}  {/* 불러오기 전에도 자리를 잡아 탭 위치가 바뀌지 않게 */}
      </button>)}</nav>
    <div className="catOuter"><nav className="categories" aria-label="뉴스 카테고리">{['전체', ...ch.categories].map(c =>
      <button key={c} className={category === c ? 'chosen' : ''} onClick={() => { setCategory(c); setPage(1); }}>{c}</button>)}</nav></div>
    <div className="toolbar" onKeyDown={onFilterKey}>
      <div className="search"><Search size={16} /><input aria-label="뉴스 검색" placeholder={`기사 제목·${L.sources}·${L.companies} 검색`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      <button ref={filterBtn} type="button" className={'filterToggle' + (filterBadge ? ' on' : '')} aria-expanded={filterOpen} aria-controls="filterPanel" onClick={() => setFilterOpen(o => !o)}><Filter size={15} aria-hidden="true" /> 필터{filterBadge > 0 && <b aria-label={`켜진 필터 ${filterBadge}개`}>{filterBadge}</b>}</button>
      <label className="sort"><SlidersHorizontal size={15} /><select value={sort} onChange={e => { setSort(e.target.value as 'latest' | 'important'); setPage(1); }}><option value="latest">최신순</option><option value="important">중요도순</option></select></label>
    </div>
    <div ref={filterPanel} id="filterPanel" className="filterPanel" role="group" aria-label="필터" hidden={!filterOpen} onKeyDown={onFilterKey}>
        <MultiFilter label={L.sources} options={sourceOpts} selected={sources} onChange={v => { setSources(v); setPage(1); }} />
        <MultiFilter label={L.companies} options={companyOpts} selected={companies} groups={ch.companyGroups} persistNote="다음 방문에도 유지됩니다." onChange={v => { setCompanies(v); setPage(1); }} />
        <MultiFilter label={L.orgs} options={orgOpts} selected={orgs} groups={ch.orgGroups} onChange={v => { setOrgs(v); setPage(1); }} />
        <label className="check" title="열어 본 기사는 읽음으로 표시됩니다."><input type="checkbox" checked={unreadOnly} onChange={e => { setUnreadOnly(e.target.checked); setPage(1); }} /> 안 읽은 것만</label>
        {tab !== 'bookmarks' && <label className="check" title="시장 속보·타 업종 기사 등"><input type="checkbox" checked={includeLow} onChange={e => { setIncludeLow(e.target.checked); setPage(1); }} /> 관련도 낮은 기사 포함</label>}
        {tab === 'new' && <label className="check"><input type="checkbox" checked={includeDismissed} onChange={e => { setIncludeDismissed(e.target.checked); setPage(1); }} /> 치운 기사 포함</label>}
      <button type="button" className="filterReset" disabled={!activeCount} onClick={resetFilters}><RotateCcw size={14} aria-hidden="true" /> 필터 초기화{activeCount > 0 && <b>{activeCount}</b>}</button>
    </div>
    {chips.length > 0 && <div className="filterChips" role="group" aria-label="켜진 필터">
      {chips.map(c => <span key={c.key} className="chip">{c.kindLabel && <span className="chipKind">{c.kindLabel}</span>}{c.label}<button type="button" aria-label={`${c.kindLabel ? c.kindLabel + ' ' : ''}${c.label} 해제`} onClick={() => { if (c.kind === 'date') { setDateFilter(null); setPage(1); } else setPanel(removeChip(panel, c)); }}><X size={13} aria-hidden="true" /></button></span>)}
      {activeCount > 0 && <button type="button" className="chipClear" onClick={resetFilters}>필터 초기화</button>}
    </div>}
    <DateBar filter={dateFilter} onChange={f => { setDateFilter(f); setPage(1); }} counts={dayCounts} month={calMonth} onMonth={setCalMonth} bounds={bounds} />
    {/* 목록 머리: 탭 이름·건수, 새 뉴스 탭은 마지막 확인·모두 확인(치운 기사는 필터의 '치운 기사 포함'). 불러오기 전에는 건수·확인 정보를 비워 둔다(정적 HTML 에 0건이 찍히지 않게). */}
    <div className="listHead">
      <h2>{ch.tabs[tab]}{listReady && <small>{countLabel(items.length, rows.length)}</small>}</h2>
      {loadingMore && <span className="listNote">과거 기사 불러오는 중…</span>}
      {tab === 'new' && listReady && <div className="listActions">
        {baseline && <span className="lastConfirm" title={`마지막 확인 ${fmt(baseline)}`}>마지막 확인 {fmtShort(baseline)}</span>}
        <button type="button" className="confirm" onClick={markDone}><Check size={15} aria-hidden="true" /> 모두 확인</button>
      </div>}
    </div>
    {failure && <div className="error"><AlertCircle size={17} /> {failure}</div>}
    <section className="articles">{!ready || (loading && tab !== 'bookmarks') ? <div className="empty">뉴스를 불러오는 중입니다…</div> : pageItems.length === 0
      ? <div className="empty" data-empty={empty}>{empty === 'noBookmarks' ? <Bookmark size={27} aria-hidden="true" /> : <Newspaper size={27} aria-hidden="true" />}<b>{EMPTY_TEXT[empty]}</b>
          {empty === 'filtered' && <button type="button" className="confirm" onClick={resetFilters}>필터 초기화</button>}
          {empty === 'noToday' && <button type="button" className="confirm" onClick={() => { const y = addDays(today, -1); setDateFilter({ from: y, to: y }); setCalMonth(y.slice(0, 7)); setPage(1); }}>어제 보기</button>}</div>
      : pageItems.map((it, i) => { const a = it.lead; const d = kstDate(a.published_at); const head = sort === 'latest' && (i === 0 || d !== kstDate(pageItems[i - 1].lead.published_at));
        const group: CardGroup | undefined = it.clusterId ? { others: it.others, size: it.size, sources: it.sources, matched: it.matched, showMatch: filtering && it.matched.size < it.others.length + 1,  /* 모두 맞으면 구분할 필요 없음 */ open: openGroups.has(it.clusterId), onToggle: () => toggleGroup(it.clusterId!), isBookmarked, isRead: id => readSet.has(id) } : undefined;
        return <Fragment key={a.id}>{head && <div className="dayhead">{dayHeading(d)}<small>· {perDay[d]}건</small></div>}
          <ArticleCard a={a} group={group} bookmarked={isBookmarked(a.id)} read={readSet.has(a.id)} fading={leaving.has(a.id)} onBookmark={bmFlow.onBookmark} onRead={handleRead}
            dismiss={tab === 'new' ? { dismissed: dismissedSet.has(a.id) && !leaving.has(a.id), onDismiss: handleDismiss, onRestore: handleRestore } : undefined} /></Fragment>; })}</section>
    {items.length > PAGE && <div className="pagination"><button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {lastPage} 페이지</span><button disabled={curPage >= lastPage} onClick={() => setPage(curPage + 1)}>다음</button></div>}
    {bmFlow.toastNode}{bmFlow.editorNode}
    {undo && <div className="undoToast" role="status" aria-live="polite"><span>치웠습니다</span><button type="button" onClick={handleUndo}>되돌리기</button></div>}
  </>;
}
