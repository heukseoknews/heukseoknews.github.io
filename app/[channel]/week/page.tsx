'use client';
import { useMemo, useState } from 'react';
import { AlertCircle, Newspaper } from 'lucide-react';
import ArticleCard from '../../../components/ArticleCard';
import { addDays, dayHeading, todayKst } from '../../../lib/dates';
import { weeklyHighlights } from '../../../lib/highlights';
import { useChannel } from '../../../lib/channelContext';
import { useNews } from '../../../lib/useNews';
import { useSaved } from '../../../lib/useSaved';

const LIMIT = 20;

export default function WeekPage() {
  const ch = useChannel();
  const [category, setCategory] = useState('전체');
  const { saved, ready, toggleBookmark, markRead, readSet, isBookmarked } = useSaved();
  const { all, failure, loading } = useNews(ch.slug); // 최근 2개월이면 7일 범위를 충분히 포함
  const today = todayKst();
  const rows = useMemo(() => weeklyHighlights(all, today, LIMIT, category), [all, today, category]);
  return <>
    <h1 className="srOnly">이번 주 핵심</h1>
    <div className="notice"><div><b>이번 주 핵심</b><p>{dayHeading(addDays(today, -6))} ~ {dayHeading(today)} · 중요도순</p></div></div>
    <div className="catOuter"><nav className="categories" aria-label="뉴스 카테고리">{['전체', ...ch.categories].map(c =>
      <button key={c} className={category === c ? 'chosen' : ''} onClick={() => setCategory(c)}>{c}</button>)}</nav></div>
    {failure && <div className="error"><AlertCircle size={17} /> {failure}</div>}
    <section className="articles">{loading || !ready ? <div className="empty">뉴스를 불러오는 중입니다…</div> : rows.length === 0
      ? <div className="empty"><Newspaper size={27} /><b>최근 7일 기사가 없습니다.</b></div>
      : rows.map((a, i) => <ArticleCard key={a.id} a={a} rank={i + 1} baseline={saved.lastConfirmed} bookmarked={isBookmarked(a.id)} read={readSet.has(a.id)} onBookmark={toggleBookmark} onRead={markRead} />)}</section>
  </>;
}
