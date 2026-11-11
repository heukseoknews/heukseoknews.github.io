'use client';
import { useMemo, useState } from 'react';
import { AlertCircle, Newspaper } from 'lucide-react';
import ArticleCard from '../../components/ArticleCard';
import { addDays, dayHeading, todayKst } from '../../lib/dates';
import { weeklyHighlights } from '../../lib/highlights';
import { CATEGORIES } from '../../lib/categories';
import { useNews } from '../../lib/useNews';
import { useSaved } from '../../lib/useSaved';

const LIMIT = 20;

export default function WeekPage() {
  const [category, setCategory] = useState('전체');
  const { saved, ready, toggleBookmark, markRead, readSet } = useSaved();
  const { all, failure, loading } = useNews(); // 최근 2개월이면 7일 범위를 충분히 포함
  const today = todayKst();
  const rows = useMemo(() => weeklyHighlights(all, today, LIMIT, category), [all, today, category]);
  return <>
    <div className="notice"><div><b>이번 주 핵심 기사 (최근 7일, 최대 {LIMIT}건)</b><p>{dayHeading(addDays(today, -6))} ~ {dayHeading(today)} 발행 기사를 중요도 높은 순으로 보여줍니다. 중요도는 제목 키워드로 계산한 값이라 동점이 많고 정확하지 않을 수 있습니다.</p></div></div>
    <div className="catOuter"><nav className="categories" aria-label="뉴스 카테고리">{(['전체', ...CATEGORIES] as const).map(c =>
      <button key={c} className={category === c ? 'chosen' : ''} onClick={() => setCategory(c)}>{c}</button>)}</nav></div>
    {failure && <div className="error"><AlertCircle size={17} /> {failure}</div>}
    <section className="articles">{loading || !ready ? <div className="empty">뉴스를 불러오는 중입니다…</div> : rows.length === 0
      ? <div className="empty"><Newspaper size={27} /><b>최근 7일 기사가 없습니다.</b><p>수집을 실행했는지, 카테고리를 확인하세요.</p></div>
      : rows.map((a, i) => <ArticleCard key={a.id} a={a} rank={i + 1} baseline={saved.lastConfirmed} bookmarked={!!saved.bookmarks[a.id]} read={readSet.has(a.id)} onBookmark={toggleBookmark} onRead={markRead} />)}</section>
  </>;
}
