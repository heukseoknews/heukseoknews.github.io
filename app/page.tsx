'use client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, Newspaper, Search, ShieldCheck, Clock3, AlertCircle, SlidersHorizontal, Filter, RotateCcw, X } from 'lucide-react';
import ArticleCard from '../components/ArticleCard';
import DateBar, { DateFilter } from '../components/DateBar';
import MultiFilter, { FilterChips } from '../components/MultiFilter';
import { Article, isRelevant } from '../lib/news';
import { CATEGORIES } from '../lib/categories';
import { COMPANY_GROUP, COMPANY_GROUPS, ORG_GROUP, ORG_GROUPS } from '../lib/entities';
import { facetOptions, matchesFacet, readList, writeList } from '../lib/facets';
import { addDays, countByDate, dayHeading, kstDate, shiftMonth, todayKst } from '../lib/dates';
import { sourceOptions } from '../lib/sources';
import { fmt } from '../lib/format';
import { isNewArticle, isUnreadNew, visibleInNewTab } from '../lib/newsFilter';
import { useNews } from '../lib/useNews';
import { useSaved } from '../lib/useSaved';

type Tab = '새 뉴스' | '전체 뉴스' | '감독당국 보도자료' | '북마크';
const TABS: Tab[] = ['새 뉴스', '전체 뉴스', '감독당국 보도자료', '북마크'];
const PAGE = 50;
const COMPANY_KEY = 'actuary-news-hub-companies-v1';  // 보험사 선택은 이 브라우저에 저장(새로고침 후에도 유지)

export default function Home() {
  const [tab, setTab] = useState<Tab>('새 뉴스');
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
  const dateFilter: DateFilter = stored !== undefined ? stored : tab === '전체 뉴스' ? { from: today, to: today } : null;
  const setDateFilter = (f: DateFilter) => setDateFilters(s => ({ ...s, [tab]: f }));
  const [sources, setSources] = useState<string[]>([]);  // 선택한 언론사(비면 전체) — 탭 이동 시 초기화
  const [orgs, setOrgs] = useState<string[]>([]);          // 선택한 유관기관(비면 전체) — 탭 이동 시 초기화, 저장하지 않음
  const [companies, setCompaniesState] = useState<string[]>([]);  // 선택한 보험사(비면 전체) — 브라우저에 저장
  useEffect(() => { setCompaniesState(readList(COMPANY_KEY)); }, []);
  const setCompanies = useCallback((v: string[]) => { setCompaniesState(v); writeList(COMPANY_KEY, v); }, []);
  const [sheetOpen, setSheetOpen] = useState(false);       // 모바일: 필터 시트 펼침
  const [calMonth, setCalMonth] = useState(todayKst().slice(0, 7));
  const [showRead, setShowRead] = useState(false);            // 새 뉴스 탭: 읽은 기사 다시 보기(기본 숨김)
  const [justRead, setJustRead] = useState<Set<string>>(new Set()); // 방금 읽어 곧 사라질 카드(짧은 페이드 후 제거)
  const timers = useRef<number[]>([]);
  const { saved, ready, update, toggleBookmark, markRead, unmarkRead, readSet } = useSaved();
  // 달력 월의 KST 날짜는 UTC 월 샤드 경계에 걸칠 수 있어 앞뒤 월도 함께 불러온다
  const { index, all, failure, loading, loadingMore } = useNews(search.trim() ? 'all' : [shiftMonth(calMonth, -1), calMonth, shiftMonth(calMonth, 1)]);
  const baseline = saved.lastConfirmed;
  const [undo, setUndo] = useState<{ id: string; n: number } | null>(null); // 읽음 버튼 직후 5초간 '되돌리기'(마지막 한 건만)
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { timers.current.forEach(clearTimeout); clearTimeout(undoTimer.current); }, []);
  // 제목 클릭·휠클릭·Enter 로 읽음 처리. 새 뉴스 탭에서는 클릭 이벤트가 끝난 직후(새 탭 열기가 시작된 뒤)에 카드를 제거한다.
  const handleRead = useCallback((id: string) => {
    markRead(id);
    if (tab !== '새 뉴스') return;
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
    let r: Article[] = tab === '북마크' ? Object.values(saved.bookmarks) : low ? all : relevantAll;
    if (tab === '새 뉴스') r = r.filter(a => visibleInNewTab(a, { baseline, read: readSet, showRead, justRead }));
    if (tab === '감독당국 보도자료') r = r.filter(a => a.source_type === 'press');
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
  const companyOpts = useMemo(() => facetOptions(base.filter(a => pass(a, 'companies')), byCo, companies, n => COMPANY_GROUP[n]), [base, dateFilter, sources, companies, orgs]);
  const orgOpts = useMemo(() => facetOptions(base.filter(a => pass(a, 'orgs')), byOrg, orgs, n => ORG_GROUP[n]), [base, dateFilter, sources, companies, orgs]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const perDay = useMemo(() => countByDate(rows), [rows]);

  // 새 뉴스 건수(탭 배지): 마지막 확인 이후 수집 + 안 읽음. 읽은 기사는 빠진다(방금 읽어 사라지는 중인 카드는 이미 제외).
  const newCount = useMemo(() => relevantAll.filter(a => isUnreadNew(a, baseline, readSet)).length, [relevantAll, baseline, readSet]);
  const hiddenReadCount = useMemo(() => relevantAll.filter(a => isNewArticle(a, baseline) && readSet.has(a.id) && !justRead.has(a.id)).length, [relevantAll, baseline, readSet, justRead]);
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE));
  const curPage = Math.min(page, lastPage);  // 읽은 기사가 빠져 페이지 수가 줄어도 범위를 벗어나지 않게
  const pageRows = rows.slice((curPage - 1) * PAGE, curPage * PAGE);
  const markDone = () => { update(s => ({ ...s, lastConfirmed: new Date().toISOString() })); setPage(1); };

  // 켜진 필터 목록: 배지 개수·'필터 초기화'·결과 0건 안내에 쓴다. hint = 그 필터만 풀었을 때 건수(조합 때문에 비었는지 알려 줌)
  const defaultDate: DateFilter = tab === '전체 뉴스' ? { from: today, to: today } : null;
  const dateChanged = JSON.stringify(dateFilter) !== JSON.stringify(defaultDate);
  const emptyNow = !loading && rows.length === 0;  // 0건일 때만 '풀면 N건'을 계산한다(평소엔 비용 없음)
  const countWithout = (skip: Skip) => emptyNow ? base.filter(a => pass(a, skip)).length : undefined;
  const countBase = (cat: string, q: string, unread: boolean, low: boolean) => emptyNow ? buildBase(cat, q, unread, low).filter(a => pass(a)).length : undefined;
  type Active = { key: string; label: string; clear: () => void; hint?: number };
  const active: Active[] = [
    category !== '전체' && { key: 'category', label: `카테고리: ${category}`, clear: () => setCategory('전체'), hint: countBase('전체', search, unreadOnly, includeLow) },
    search.trim() && { key: 'search', label: `검색: ${search.trim()}`, clear: () => setSearch(''), hint: countBase(category, '', unreadOnly, includeLow) },
    sources.length > 0 && { key: 'sources', label: `언론사 ${sources.length}곳`, clear: () => setSources([]), hint: countWithout('sources') },
    companies.length > 0 && { key: 'companies', label: `보험사 ${companies.length}곳`, clear: () => setCompanies([]), hint: countWithout('companies') },
    orgs.length > 0 && { key: 'orgs', label: `유관기관 ${orgs.length}곳`, clear: () => setOrgs([]), hint: countWithout('orgs') },
    dateChanged && { key: 'date', label: `날짜: ${dateFilter ? (dateFilter.from === dateFilter.to ? dateFilter.from : `${dateFilter.from}~${dateFilter.to}`) : '전체'}`, clear: () => setDateFilters(s => { const n = { ...s }; delete n[tab]; return n; }), hint: countWithout('date') },
    unreadOnly && { key: 'unread', label: '안 읽은 것만', clear: () => setUnreadOnly(false), hint: countBase(category, search, false, includeLow) },
    includeLow && tab !== '북마크' && { key: 'low', label: '관련도 낮은 기사 포함', clear: () => setIncludeLow(false) },
  ].filter(Boolean) as Active[];
  const activeCount = active.length;
  const resetFilters = () => {
    setCategory('전체'); setSearch(''); setSources([]); setOrgs([]); setCompanies([]); setUnreadOnly(false); setIncludeLow(false);
    setDateFilters(s => { const n = { ...s }; delete n[tab]; return n; }); setPage(1);
  };

  return <>
    <nav className="primary" aria-label="주요 메뉴">{TABS.map(t =>
      <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setCategory('전체'); setSources([]); setOrgs([]); setPage(1); }}>
        {t === '새 뉴스' ? <Clock3 size={16} /> : t === '감독당국 보도자료' ? <ShieldCheck size={16} /> : t === '북마크' ? <Bookmark size={16} /> : <Newspaper size={16} />} {t}{t === '새 뉴스' && ready && !loading && <span className="count" aria-label={`안 읽은 새 뉴스 ${newCount}건`}>{newCount.toLocaleString()}</span>}
      </button>)}</nav>
    <div className="catOuter"><nav className="categories" aria-label="뉴스 카테고리">{(['전체', ...CATEGORIES] as const).map(c =>
      <button key={c} className={category === c ? 'chosen' : ''} onClick={() => { setCategory(c); setPage(1); }}>{c}</button>)}</nav></div>
    <div className="toolbar">
      <div className="search"><Search size={16} /><input aria-label="뉴스 검색" placeholder="기사 제목·언론사·보험사 검색" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      <label className="sort"><SlidersHorizontal size={15} /><select value={sort} onChange={e => { setSort(e.target.value as 'latest' | 'important'); setPage(1); }}><option value="latest">최신순</option><option value="important">중요도순</option></select></label>
    </div>
    <div className="filterBar">
      <button type="button" className={'filterToggle' + (activeCount ? ' on' : '')} aria-expanded={sheetOpen} aria-controls="filterControls" onClick={() => setSheetOpen(o => !o)}><Filter size={15} aria-hidden="true" /> 필터{activeCount > 0 && <b aria-label={`켜진 필터 ${activeCount}개`}>{activeCount}</b>}</button>
      <div id="filterControls" className={'filterControls' + (sheetOpen ? ' open' : '')}>
        <MultiFilter label="언론사" options={sourceOpts} selected={sources} onChange={v => { setSources(v); setPage(1); }} />
        <MultiFilter label="보험사" options={companyOpts} selected={companies} groups={COMPANY_GROUPS} persistNote="선택한 보험사는 이 브라우저에 저장됩니다." onChange={v => { setCompanies(v); setPage(1); }} />
        <MultiFilter label="유관기관" options={orgOpts} selected={orgs} groups={ORG_GROUPS} onChange={v => { setOrgs(v); setPage(1); }} />
        <label className="check" title="제목을 클릭해 연 기사는 읽음으로 기록됩니다(새 뉴스 범위의 읽음 기록은 우선 보관)"><input type="checkbox" checked={unreadOnly} onChange={e => { setUnreadOnly(e.target.checked); setPage(1); }} /> 안 읽은 것만</label>
        {tab !== '북마크' && <label className="check" title="제목에 보험 관련 단어가 없는 기사(시장 속보·타 업종 등)입니다. 새 뉴스 건수와 이번 주 핵심에는 포함되지 않습니다."><input type="checkbox" checked={includeLow} onChange={e => { setIncludeLow(e.target.checked); setPage(1); }} /> 관련도 낮은 기사 포함</label>}
      </div>
      <button type="button" className="filterReset" disabled={!activeCount} onClick={resetFilters}><RotateCcw size={14} aria-hidden="true" /> 필터 초기화{activeCount > 0 && <b>{activeCount}</b>}</button>
    </div>
    <FilterChips label="보험사" selected={companies} onChange={v => { setCompanies(v); setPage(1); }} />
    <FilterChips label="유관기관" selected={orgs} onChange={v => { setOrgs(v); setPage(1); }} />
    <FilterChips label="언론사" selected={sources} onChange={v => { setSources(v); setPage(1); }} />
    <DateBar filter={dateFilter} onChange={f => { setDateFilter(f); setPage(1); }} counts={dayCounts} month={calMonth} onMonth={setCalMonth} />
    {tab === '새 뉴스' && <div className="notice"><div><b>마지막 확인 완료 이후 수집된 기사</b><p>{baseline ? `마지막 확인 완료: ${fmt(baseline)}` : '처음 접속했습니다. 보관 중인 뉴스를 모두 새 뉴스로 표시합니다.'} · 수집시각 기준(표시 시각은 발행시각)</p></div><button className="confirm" disabled={!ready} onClick={markDone}><Check size={15} /> 새 뉴스 확인 완료</button></div>}
    {tab === '새 뉴스' && (hiddenReadCount > 0 || showRead) && <div className="readToggleRow"><button type="button" className="readToggle" aria-pressed={showRead} onClick={() => { setShowRead(v => !v); setPage(1); }}>{showRead ? `읽은 기사 ${hiddenReadCount}건 표시 중 · 숨기기` : `읽은 기사 ${hiddenReadCount}건 숨김 · 다시 보기`}</button></div>}
    {tab === '감독당국 보도자료' && <div className="notice"><div><b>금융위원회 · 금융감독원 관련 자료</b><p>금융위는 공식 RSS와 검색으로 발견한 자료를 함께 보여주며, 금융감독원은 직접 수집이 아니라 검색으로 발견한 자료입니다. 누락될 수 있습니다.</p></div></div>}
    <div className="listHead"><h3>{tab} <small>{rows.length.toLocaleString()}건</small></h3><span>{loadingMore ? '과거 기사 불러오는 중…' : index?.updated_at ? `마지막 수집 ${fmt(index.updated_at)}` : '수집 이력 없음'}</span></div>
    {failure && <div className="error"><AlertCircle size={17} /> {failure}</div>}
    <section className="articles">{!ready || (loading && tab !== '북마크') ? <div className="empty">뉴스를 불러오는 중입니다…</div> : pageRows.length === 0
      ? (active.length
        ? <div className="empty"><Newspaper size={27} /><b>조건에 맞는 기사가 없습니다</b><p>아래 필터가 함께 적용되어 결과가 비었습니다. 하나씩 해제해 보세요.</p>
            <ul className="emptyFilters">{active.map(f => <li key={f.key} className={f.hint ? 'fix' : ''}><span>{f.label}</span>{f.hint !== undefined && <small>{f.hint > 0 ? `이 필터를 풀면 ${f.hint.toLocaleString()}건` : '풀어도 0건'}</small>}<button type="button" onClick={() => { f.clear(); setPage(1); }}><X size={13} aria-hidden="true" /> 해제</button></li>)}</ul>
            <button type="button" className="confirm" onClick={resetFilters}>필터 초기화</button></div>
        : tab === '전체 뉴스' && dateFilter && dateFilter.from === today && dateFilter.to === today
        ? <div className="empty"><Newspaper size={27} /><b>오늘 올라온 기사가 아직 없습니다</b><p>수집은 매일 아침 이뤄집니다. 어제 기사를 확인해 보세요.</p><button type="button" className="confirm" onClick={() => { const y = addDays(today, -1); setDateFilter({ from: y, to: y }); setCalMonth(y.slice(0, 7)); setPage(1); }}>어제 보기</button></div>
        : <div className="empty"><Newspaper size={27} /><b>표시할 기사가 없습니다.</b><p>새 뉴스 확인 여부, 검색어, 수집 실행 결과를 확인하세요.</p></div>)
      : pageRows.map((a, i) => { const d = kstDate(a.published_at); const head = sort === 'latest' && (i === 0 || d !== kstDate(pageRows[i - 1].published_at));
        return <Fragment key={a.id}>{head && <div className="dayhead">{dayHeading(d)}<small>· {perDay[d]}건</small></div>}
          <ArticleCard a={a} baseline={baseline} showDiscovery={tab === '감독당국 보도자료'} bookmarked={!!saved.bookmarks[a.id]} read={readSet.has(a.id)} dim={tab === '새 뉴스' || tab === '전체 뉴스'} fading={justRead.has(a.id)} onBookmark={toggleBookmark} onRead={handleRead} onUnread={tab === '새 뉴스' && showRead ? unmarkRead : undefined} onMarkRead={tab === '새 뉴스' ? handleMarkRead : undefined} /></Fragment>; })}</section>
    {rows.length > PAGE && <div className="pagination"><button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {lastPage} 페이지</span><button disabled={curPage >= lastPage} onClick={() => setPage(curPage + 1)}>다음</button></div>}
    {undo && <div className="undoToast" role="status" aria-live="polite"><span>읽음 처리했습니다</span><button type="button" onClick={handleUndo}>되돌리기</button></div>}
  </>;
}
