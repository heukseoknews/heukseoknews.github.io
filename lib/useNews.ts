'use client';
import { useEffect, useMemo, useState } from 'react';
import { Article, DataIndex, loadIndex, loadMonth } from './news';

/** index.json + 월 파일 지연 로딩. extra: 추가로 불러올 월 목록 또는 'all'. 기본은 최근 2개월. */
export function useNews(extra: string[] | 'all' = []) {
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [byMonth, setByMonth] = useState<Record<string, Article[]>>({});
  const [failure, setFailure] = useState('');
  useEffect(() => { loadIndex().then(setIndex).catch(e => setFailure(`데이터 인덱스를 읽지 못했습니다: ${e.message}`)); }, []);
  const extraKey = extra === 'all' ? 'all' : extra.join(',');
  const wanted = useMemo(() => {
    const m = index?.months.map(x => x.month) ?? [];
    const set = new Set(m.slice(0, 2));
    if (extra === 'all') m.forEach(x => set.add(x)); else extra.forEach(x => m.includes(x) && set.add(x));
    return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, extraKey]);
  useEffect(() => {
    wanted.filter(m => !(m in byMonth)).forEach(m => {
      loadMonth(m).then(rows => setByMonth(p => ({ ...p, [m]: rows })))
        .catch(e => { setByMonth(p => ({ ...p, [m]: [] })); setFailure(`${m} 데이터를 읽지 못했습니다: ${e.message}`); });
    });
  }, [wanted, byMonth]);
  const all = useMemo(() => Object.values(byMonth).flat(), [byMonth]);
  // loading: 최초 표시에 필요한 최근 2개월이 모두 끝날 때까지(성공/실패 무관). 이전에는 index만 오면 끝난 것으로 보여 '기사 없음'이 깜빡였다.
  const baseMonths = index?.months.slice(0, 2).map(x => x.month) ?? [];
  const loading = !failure && (!index || baseMonths.some(m => !(m in byMonth)));
  const loadingMore = !loading && wanted.some(m => !(m in byMonth)); // 검색·달력 이동으로 과거 월을 추가로 읽는 중
  return { index, all, failure, loading, loadingMore };
}
